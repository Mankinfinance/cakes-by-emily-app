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
      "automations",
      "box_orders",
      "catalogue_items",
      "days_off",
      "message_log",
      "order_items",
      "order_updates",
      "orders",
      "payments",
      "peak_dates",
      "seasonal_boxes",
      "settings",
      "stripe_events",
      "voucher_redemptions",
      "vouchers",
      "waitlist",
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

describe("phase 2 migration", () => {
  const BOX = "b0000000-0000-4000-8000-000000000001";

  async function insertVoucher(id: string, hash: string, balance: number, expires = "2027-12-31", status = "active") {
    await db.query(
      `insert into vouchers (id, kind, code_hash, code_last4, amount_cents, balance_cents, status, buyer_email, expires_on)
       values ($1, 'gift', $2, 'WXYZ', $3, $3, $4, 'kim@example.com', $5)`,
      [id, hash, balance, status, expires],
    );
  }

  it("seeds default automations and the sample boxes", async () => {
    const a = await db.query<{ n: number }>("select count(*)::int as n from automations");
    expect(a.rows[0].n).toBe(6);
    const b = await db.query<{ n: number }>("select count(*)::int as n from seasonal_boxes");
    expect(b.rows[0].n).toBe(3);
  });

  it("blocks customers (anon) from every new table", async () => {
    await db.exec("set role anon");
    for (const t of ["automations", "message_log", "waitlist", "seasonal_boxes", "box_orders", "vouchers", "voucher_redemptions"]) {
      const res = await db.query(`select * from ${t}`);
      expect(res.rows, t).toHaveLength(0);
    }
    await db.exec("reset role");
  });

  it("never oversells a box, even with many buyers at once", async () => {
    // PGlite runs one query at a time, so these are serialised; the function's
    // guarded update (and the sold <= cap check constraint) is what keeps it
    // safe under real concurrency on Supabase, where the row lock applies.
    await db.query("update seasonal_boxes set cap = 5, sold = 0 where id = $1", [BOX]);
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () => db.query<{ ok: boolean }>("select reserve_box_stock($1, 1, '2026-11-08') as ok", [BOX])),
    );
    expect(attempts.filter((r) => r.rows[0].ok)).toHaveLength(5);
    const sold = await db.query<{ sold: number }>("select sold from seasonal_boxes where id = $1", [BOX]);
    expect(sold.rows[0].sold).toBe(5);
    await expect(db.query("update seasonal_boxes set sold = 6 where id = $1", [BOX])).rejects.toThrow();
    // Not open yet, or closed: refused.
    expect((await db.query<{ ok: boolean }>("select reserve_box_stock($1, 1, '2026-10-01') as ok", [BOX])).rows[0].ok).toBe(false);
  });

  it("cancelling a box order puts the stock back once", async () => {
    await db.query("update seasonal_boxes set cap = 10, sold = 2 where id = $1", [BOX]);
    await db.query(
      `insert into box_orders (id, reference, token_hash, box_id, box_name, quantity, unit_price_cents, total_cents, customer_name, email, phone, pickup_date, pickup_slot)
       values ('44444444-4444-4444-4444-444444444444', 'BOX-AAAAA', 'hash-box', $1, 'Christmas', 2, 4500, 9000, 'Kim', 'kim@example.com', '0400000000', '2026-12-20', '10:00')`,
      [BOX],
    );
    const cancel = async () => (await db.query<{ ok: boolean }>("select cancel_box_order('44444444-4444-4444-4444-444444444444', true) as ok")).rows[0].ok;
    expect(await cancel()).toBe(true);
    expect(await cancel()).toBe(false);
    expect((await db.query<{ sold: number }>("select sold from seasonal_boxes where id = $1", [BOX])).rows[0].sold).toBe(0);
  });

  it("redeems a voucher partially, once per order, and gives it back once", async () => {
    const order = "55555555-5555-5555-5555-555555555555";
    await insertOrder(order, "hash-voucher-order");
    await insertVoucher("66666666-6666-6666-6666-666666666666", "hash-code-1", 5000);
    const redeem = async (max: number) => (await db.query<{ n: number }>("select redeem_voucher('hash-code-1', $1, $2, '2026-11-08') as n", [order, max])).rows[0].n;
    expect(await redeem(3000)).toBe(3000);
    expect(await redeem(3000)).toBe(0); // the order already used a voucher
    const bal = async () => (await db.query<{ b: number }>("select balance_cents as b from vouchers where code_hash = 'hash-code-1'")).rows[0].b;
    expect(await bal()).toBe(2000);
    const back = await db.query<{ amount: number; to_voucher: boolean }>("select * from return_voucher($1, '2026-11-08')", [order]);
    expect(back.rows[0]).toEqual({ amount: 3000, to_voucher: true });
    expect(await bal()).toBe(5000);
    const again = await db.query<{ amount: number }>("select * from return_voucher($1, '2026-11-08')", [order]);
    expect(again.rows[0].amount).toBe(0);
  });

  it("refuses expired, unpaid and empty vouchers, and returns expired ones as new credit", async () => {
    const order = "77777777-7777-7777-7777-777777777777";
    await insertOrder(order, "hash-voucher-order-2");
    await insertVoucher("88888888-8888-8888-8888-888888888888", "hash-old", 5000, "2026-01-01");
    await insertVoucher("99999999-9999-9999-9999-999999999999", "hash-unpaid", 5000, "2027-12-31", "pending");
    const try_ = async (hash: string) => (await db.query<{ n: number }>("select redeem_voucher($1, $2, 1000, '2026-11-08') as n", [hash, order])).rows[0].n;
    expect(await try_("hash-old")).toBe(0);
    expect(await try_("hash-unpaid")).toBe(0);
    expect(await try_("hash-missing")).toBe(0);
    // Use a valid one, then let it expire before the order is cancelled.
    await insertVoucher("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "hash-soon", 4000, "2026-11-30");
    expect(await try_("hash-soon")).toBe(1000);
    const back = await db.query<{ amount: number; to_voucher: boolean }>("select * from return_voucher($1, '2026-12-05')", [order]);
    expect(back.rows[0]).toEqual({ amount: 1000, to_voucher: false });
  });

  it("records box and voucher payments exactly once", async () => {
    await insertVoucher("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "hash-pending", 2500, "2027-12-31", "pending");
    await db.query(
      `insert into payments (voucher_id, kind, amount_cents, stripe_session_id) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'voucher', 2500, 'cs_v1')`,
    );
    expect((await db.query<{ ok: boolean }>("select record_payment_once('evt_v1', 'cs_v1') as ok")).rows[0].ok).toBe(true);
    expect((await db.query<{ ok: boolean }>("select record_payment_once('evt_v2', 'cs_v1') as ok")).rows[0].ok).toBe(false);
    const v = await db.query<{ status: string; balance_cents: number }>("select status, balance_cents from vouchers where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'");
    expect(v.rows[0]).toEqual({ status: "active", balance_cents: 2500 });
    // A payment must point at exactly one thing.
    await expect(db.query(`insert into payments (kind, amount_cents, stripe_session_id) values ('box', 100, 'cs_none')`)).rejects.toThrow();
  });

  it("allows only one live waitlist offer per date and one message per order and key", async () => {
    const add = (id: string) =>
      db.query(
        `insert into waitlist (id, date, customer_name, email, phone, config) values ($1, '2026-12-05', 'Ann Lee', 'ann@example.com', '0400000000', '{}')`,
        [id],
      );
    await add("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    await add("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    await db.query("update waitlist set status = 'offered' where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'");
    await expect(db.query("update waitlist set status = 'offered' where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'")).rejects.toThrow();
    const order = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await insertOrder(order, "hash-msg");
    await db.query("insert into message_log (order_id, key) values ($1, 'thank_you')", [order]);
    await expect(db.query("insert into message_log (order_id, key) values ($1, 'thank_you')", [order])).rejects.toThrow();
  });

  it("accepts the new stage and update kinds", async () => {
    const order = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await insertOrder(order, "hash-stage");
    await db.query("update orders set stage = 'awaiting_approval' where id = $1", [order]);
    await db.query("insert into order_updates (order_id, kind) values ($1, 'sketch')", [order]);
    await expect(db.query("update orders set stage = 'nonsense' where id = $1", [order])).rejects.toThrow();
  });
});
