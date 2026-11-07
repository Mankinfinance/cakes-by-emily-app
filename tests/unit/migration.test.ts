// Runs the real SQL migration and seed on PGlite (Postgres compiled to
// WebAssembly) with small stand-ins for Supabase's auth and storage schemas.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { SAMPLE_CATALOGUE } from "@/lib/data/sample-data";
import { buildSeedSql } from "../../scripts/seed-sql";

const root = path.resolve(import.meta.dirname, "../..");

const SUPABASE_STUBS = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create role anon nologin;
  create role authenticated nologin;
`;

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const dir = path.join(root, "supabase/migrations");
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(path.join(dir, f), "utf8"));
  await db.exec(readFileSync(path.join(root, "supabase/seed.sql"), "utf8"));
  await db.exec("grant usage on schema public to anon, authenticated; grant select on all tables in schema public to anon, authenticated;");
});

async function insertOrder(id: string, tokenHash: string) {
  await db.query(
    `insert into orders (id, reference, token_hash, customer_name, email, phone, pickup_date, pickup_slot, config,
       subtotal_cents, total_cents, deposit_cents, terms_accepted_at)
     values ($1, $2, $3, 'Sam', 'sam@example.com', '0400000000', '2026-11-20', '10:00', '{}', 13000, 13000, 6500, now())`,
    [id, `CBE-${id.slice(0, 5)}`, tokenHash],
  );
}

describe("database migration", () => {
  it("creates every table with row level security on", async () => {
    const res = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by relname`,
    );
    const tables = res.rows.map((r) => r.relname);
    expect(tables).toEqual([
      "admins",
      "catalogue_items",
      "days_off",
      "order_items",
      "order_updates",
      "orders",
      "payments",
      "peak_dates",
      "settings",
      "stripe_events",
    ]);
    expect(res.rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("keeps the committed seed in sync with the sample data", () => {
    expect(readFileSync(path.join(root, "supabase/seed.sql"), "utf8")).toBe(buildSeedSql());
  });

  it("seeds the sample catalogue and settings", async () => {
    const items = await db.query<{ n: number }>("select count(*)::int as n from catalogue_items");
    expect(items.rows[0].n).toBe(SAMPLE_CATALOGUE.length);
    const s = await db.query<{ data: { depositPercent: number } }>("select data from settings where id = 1");
    expect(s.rows[0].data.depositPercent).toBe(50);
  });

  it("blocks customers (anon) from reading orders", async () => {
    await insertOrder("11111111-1111-1111-1111-111111111111", "hash-anon");
    await db.exec("set role anon");
    const res = await db.query("select * from orders");
    await db.exec("reset role");
    expect(res.rows).toHaveLength(0);
  });

  it("lets an admin read orders only with two-factor (aal2)", async () => {
    const uid = "22222222-2222-2222-2222-222222222222";
    await db.query("insert into auth.users (id) values ($1)", [uid]);
    await db.query("insert into admins (user_id) values ($1)", [uid]);
    await db.exec(`set test.uid = '${uid}'`);
    await db.exec(`set role authenticated`);
    await db.exec(`set test.jwt = '{"aal":"aal1"}'`);
    const without = await db.query("select * from orders");
    await db.exec(`set test.jwt = '{"aal":"aal2"}'`);
    const withMfa = await db.query("select * from orders");
    await db.exec("reset role");
    await db.exec("set test.uid = ''; set test.jwt = ''");
    expect(without.rows).toHaveLength(0);
    expect(withMfa.rows.length).toBeGreaterThan(0);
  });

  it("records a Stripe payment exactly once", async () => {
    const orderId = "33333333-3333-3333-3333-333333333333";
    await insertOrder(orderId, "hash-pay");
    await db.query(
      `insert into payments (order_id, kind, amount_cents, stripe_session_id) values ($1, 'deposit', 6500, 'cs_test_1')`,
      [orderId],
    );
    const call = async (evt: string) =>
      (await db.query<{ ok: boolean }>("select record_payment_once($1, 'cs_test_1') as ok", [evt])).rows[0].ok;
    expect(await call("evt_a")).toBe(true);
    expect(await call("evt_a")).toBe(false);
    expect(await call("evt_b")).toBe(false);
    const o = await db.query<{ amount_paid_cents: number; stage: string }>(
      "select amount_paid_cents, stage from orders where id = $1",
      [orderId],
    );
    expect(o.rows[0]).toEqual({ amount_paid_cents: 6500, stage: "received" });
  });

  it("rejects invalid data at the database too", async () => {
    await expect(
      db.query(`insert into catalogue_items (id, category, name, price_cents) values ('bad', 'size', 'Bad', -1)`),
    ).rejects.toThrow();
    await expect(
      db.query(`insert into catalogue_items (id, category, name) values ('bad2', 'nonsense', 'Bad')`),
    ).rejects.toThrow();
  });
});
