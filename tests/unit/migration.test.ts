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
      "booking_message_log",
      "box_orders",
      "catalogue_items",
      "class_bookings",
      "class_passes",
      "class_photos",
      "class_sessions",
      "class_types",
      "corporate_orders",
      "corporate_packages",
      "days_off",
      "message_log",
      "order_items",
      "order_updates",
      "orders",
      "pass_redemptions",
      "payments",
      "peak_dates",
      "private_guests",
      "private_requests",
      "referral_codes",
      "referrals",
      "refunds",
      "reviews",
      "seasonal_boxes",
      "settings",
      "stamp_rewards",
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
    expect(a.rows[0].n).toBe(9);
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

describe("phase 3 migration", () => {
  const T = "class-florals";

  async function insertSession(id: string, seats = 8) {
    await db.query("insert into class_sessions (id, class_type_id, date, start_time, seats) values ($1, $2, '2026-12-05', '14:00', $3)", [id, T, seats]);
  }

  it("seeds corporate packages, class types, add-ons and the new automations", async () => {
    const n = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n;
    expect(await n("select count(*)::int as n from corporate_packages")).toBe(6);
    expect(await n("select count(*)::int as n from class_types")).toBe(3);
    expect(await n("select count(*)::int as n from catalogue_items where category = 'addon'")).toBe(4);
    expect(await n("select bond_cents as n from catalogue_items where id = 'add-stand-hire'")).toBe(2000);
    expect(await n("select count(*)::int as n from automations where key in ('stand_return','class_reminder','class_thank_you')")).toBe(3);
  });

  it("blocks customers (anon) from every new table", async () => {
    await db.exec("set role anon");
    for (const t of ["corporate_packages", "corporate_orders", "reviews", "referral_codes", "referrals", "class_types", "class_sessions", "class_bookings", "booking_message_log", "private_requests"]) {
      const res = await db.query(`select * from ${t}`);
      expect(res.rows, t).toHaveLength(0);
    }
    await db.exec("reset role");
  });

  it("never overbooks a class, even with many bookers at once", async () => {
    // As with boxes: PGlite serialises these, so this proves the guarded update
    // and the booked <= seats constraint; on Supabase the row lock applies.
    const id = "10000000-0000-4000-8000-000000000001";
    await insertSession(id, 8);
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () => db.query<{ ok: boolean }>("select reserve_class_seats($1, 3) as ok", [id])),
    );
    expect(attempts.filter((r) => r.rows[0].ok)).toHaveLength(2);
    expect((await db.query<{ booked: number }>("select booked from class_sessions where id = $1", [id])).rows[0].booked).toBe(6);
    await expect(db.query("update class_sessions set booked = 9 where id = $1", [id])).rejects.toThrow();
    await db.query("update class_sessions set status = 'cancelled' where id = $1", [id]);
    expect((await db.query<{ ok: boolean }>("select reserve_class_seats($1, 1) as ok", [id])).rows[0].ok).toBe(false);
  });

  it("cancels a class booking once and gives the seats back", async () => {
    const s = "10000000-0000-4000-8000-000000000002";
    const b = "20000000-0000-4000-8000-000000000001";
    await insertSession(s, 8);
    await db.query("select reserve_class_seats($1, 2)", [s]);
    await db.query(
      `insert into class_bookings (id, reference, token_hash, session_id, seats, guests, contact_name, email, phone, unit_price_cents, total_cents, terms_accepted_at)
       values ($1, 'CLS-AAAAA', 'hash-cls', $2, 2, '[]', 'Ann', 'ann@example.com', '0400000000', 9500, 19000, now())`,
      [b, s],
    );
    const cancel = async () => (await db.query<{ ok: boolean }>(`select cancel_class_booking($1, false, '{"by":"emily"}') as ok`, [b])).rows[0].ok;
    expect(await cancel()).toBe(true);
    expect(await cancel()).toBe(false);
    expect((await db.query<{ booked: number }>("select booked from class_sessions where id = $1", [s])).rows[0].booked).toBe(0);
  });

  it("only publishes reviews with consent, one per order", async () => {
    const order = "30000000-0000-4000-8000-000000000001";
    await insertOrder(order, "hash-review");
    await db.query("insert into reviews (order_id, rating, display_name, consent_to_publish) values ($1, 5, 'Sam T.', false)", [order]);
    await expect(db.query("update reviews set status = 'approved' where order_id = $1", [order])).rejects.toThrow();
    await expect(db.query("insert into reviews (order_id, rating, display_name) values ($1, 4, 'Sam T.')", [order])).rejects.toThrow();
    await expect(db.query("insert into reviews (order_id, rating, display_name) values ($1, 6, 'X')", ["30000000-0000-4000-8000-000000000009"])).rejects.toThrow();
  });

  it("refuses self-referrals and referring the same customer twice", async () => {
    await db.query("insert into referral_codes (code, email) values ('KIM-ABCD', 'kim@example.com')");
    const o1 = "41000000-0000-4000-8000-000000000001";
    const o2 = "42000000-0000-4000-8000-000000000002";
    await insertOrder(o1, "hash-ref-1");
    await insertOrder(o2, "hash-ref-2");
    await expect(
      db.query("insert into referrals (code, referrer_email, referred_email, order_id) values ('KIM-ABCD', 'kim@example.com', 'KIM@example.com', $1)", [o1]),
    ).rejects.toThrow();
    await db.query("insert into referrals (code, referrer_email, referred_email, order_id) values ('KIM-ABCD', 'kim@example.com', 'sam@example.com', $1)", [o1]);
    await expect(
      db.query("insert into referrals (code, referrer_email, referred_email, order_id) values ('KIM-ABCD', 'kim@example.com', 'Sam@Example.com', $1)", [o2]),
    ).rejects.toThrow();
    // Once the first is void (never paid), the customer can be referred again.
    await db.query("update referrals set status = 'void' where order_id = $1", [o1]);
    await db.query("insert into referrals (code, referrer_email, referred_email, order_id) values ('KIM-ABCD', 'kim@example.com', 'sam@example.com', $1)", [o2]);
  });

  it("records corporate, class and private deposit payments exactly once", async () => {
    await db.query(
      `insert into corporate_orders (id, reference, token_hash, package_id, package_name, quantity, total_cents, deposit_cents, company_name, contact_name, email, phone, pickup_date, pickup_slot, terms_accepted_at)
       values ('50000000-0000-4000-8000-000000000001', 'CORP-AAAAA', 'hash-corp', 'corp-cookies-24', 'Logo cookies x 24', 24, 18000, 9000, 'Acme', 'Pat', 'p@example.com', '0400000000', '2026-12-01', '10:00', now())`,
    );
    await db.query(
      `insert into payments (corporate_order_id, kind, amount_cents, stripe_session_id) values ('50000000-0000-4000-8000-000000000001', 'corporate_deposit', 9000, 'cs_corp')`,
    );
    const pay = async (evt: string, cs: string) => (await db.query<{ ok: boolean }>("select record_payment_once($1, $2) as ok", [evt, cs])).rows[0].ok;
    expect(await pay("evt_corp", "cs_corp")).toBe(true);
    expect(await pay("evt_corp2", "cs_corp")).toBe(false);
    const c = await db.query<{ status: string; amount_paid_cents: number }>("select status, amount_paid_cents from corporate_orders where reference = 'CORP-AAAAA'");
    expect(c.rows[0]).toEqual({ status: "confirmed", amount_paid_cents: 9000 });

    await db.query(
      `insert into private_requests (id, reference, package_key, package_name, guests, per_person_cents, deposit_cents, estimate_cents, preferred_date, preferred_time, contact_name, email, phone, status)
       values ('60000000-0000-4000-8000-000000000001', 'PVT-AAAAA', 'classic', 'Classic', 8, 9000, 15000, 72000, '2026-12-12', '14:00', 'Jo', 'jo@example.com', '0400000000', 'accepted')`,
    );
    await db.query(`insert into payments (private_request_id, kind, amount_cents, stripe_session_id) values ('60000000-0000-4000-8000-000000000001', 'private_deposit', 15000, 'cs_pvt')`);
    expect(await pay("evt_pvt", "cs_pvt")).toBe(true);
    expect((await db.query<{ status: string }>("select status from private_requests where reference = 'PVT-AAAAA'")).rows[0].status).toBe("paid");
  });

  it("works out the sales summary in SQL the same way as the app does", async () => {
    const { summarise } = await import("@/lib/domain/snapshot");
    // Fresh orders in March 2027, booked at different Sydney times.
    const rows = [
      { id: "70000000-0000-4000-8000-000000000001", created: "2027-03-01T00:30:00Z", total: 20000, flavour: "Vanilla bean", stage: "received" },
      { id: "70000000-0000-4000-8000-000000000002", created: "2027-03-10T05:00:00Z", total: 10000, flavour: "Chocolate mud", stage: "collected" },
      { id: "70000000-0000-4000-8000-000000000003", created: "2027-03-31T13:30:00Z", total: 50000, flavour: "Vanilla bean", stage: "received" }, // 12:30am 1 Apr in Sydney (AEDT)
      { id: "70000000-0000-4000-8000-000000000004", created: "2027-03-12T05:00:00Z", total: 99900, flavour: "Red velvet", stage: "cancelled" },
    ];
    for (const r of rows) {
      await db.query(
        `insert into orders (id, reference, token_hash, stage, customer_name, email, phone, pickup_date, pickup_slot, config, subtotal_cents, total_cents, deposit_cents, terms_accepted_at, created_at)
         values ($1, $2, $3, $4, 'X', 'x@example.com', '0400000000', '2027-04-20', '10:00', '{}', $5, $5, 0, now(), $6)`,
        [r.id, `CBE-${r.id.slice(-5)}`, `hash-${r.id}`, r.stage, r.total, r.created],
      );
      await db.query("insert into order_items (order_id, category, name, amount_cents) values ($1, 'flavour', $2, 0), ($1, 'occasion', 'Birthday', 0)", [r.id, r.flavour]);
    }
    await db.query(`insert into payments (order_id, kind, amount_cents, stripe_session_id, status, created_at) values ($1, 'deposit', 10000, 'cs_snap_1', 'paid', '2027-03-01T00:30:00Z')`, [rows[0].id]);

    const sql = (await db.query<{ s: Record<string, unknown> }>("select sales_summary('2027-03-01', '2027-03-31') as s")).rows[0].s;
    const sydney = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date(iso));
    const app = summarise(
      rows.map((r) => ({
        stage: r.stage,
        createdAt: r.created,
        totalCents: r.total,
        items: [
          { itemId: null, category: "flavour", name: r.flavour, amountCents: 0 },
          { itemId: null, category: "occasion", name: "Birthday", amountCents: 0 },
        ],
      })) as never,
      [{ status: "paid", kind: "deposit", amountCents: 10000, createdAt: "2027-03-01T00:30:00Z" }] as never,
      "2027-03-01",
      "2027-03-31",
      sydney,
    );
    expect(sql).toEqual({
      orders: app.orders,
      revenueCents: app.revenueCents,
      depositsCents: app.depositsCents,
      topFlavours: app.topFlavours,
      topFinishes: app.topFinishes,
      topOccasions: app.topOccasions,
    });
    expect(app).toMatchObject({ orders: 2, revenueCents: 30000, depositsCents: 10000 });
  });
});

describe("phase 4 migration", () => {
  const REQ = "80000000-0000-4000-8000-000000000001";

  async function privateRequest(id = REQ, status = "paid") {
    await db.query(
      `insert into private_requests (id, reference, package_key, package_name, guests, per_person_cents, deposit_cents, estimate_cents, preferred_date, preferred_time, contact_name, email, phone, status)
       values ($1, $2, 'deluxe', 'Deluxe', 3, 12000, 15000, 36000, '2027-01-16', '14:00', 'Jo', 'jo@example.com', '0400000000', $3)`,
      [id, `PVT-${id.slice(-5)}`, status],
    );
    for (const [slot, cents] of [[1, 7000], [2, 7000], [3, 7000]]) {
      await db.query("insert into private_guests (request_id, slot, share_cents) values ($1, $2, $3)", [id, slot, cents]);
    }
  }
  const guestIds = async (id = REQ) => (await db.query<{ id: string }>("select id from private_guests where request_id = $1 order by slot", [id])).rows.map((r) => r.id);

  it("blocks customers (anon) from every new table", async () => {
    await db.exec("set role anon");
    for (const t of ["private_guests", "class_photos", "class_passes", "pass_redemptions", "refunds", "stamp_rewards"]) {
      const res = await db.query(`select * from ${t}`);
      expect(res.rows, t).toHaveLength(0);
    }
    await db.exec("reset role");
  });

  it("gives each guest their own place, until every place is taken", async () => {
    await privateRequest();
    const claim = async (name: string) =>
      (await db.query<{ id: string | null }>("select claim_guest_slot($1, $2, 'g@example.com', 'Nuts', '{}', false) as id", [REQ, name])).rows[0].id;
    const results = await Promise.all(["Ann", "Bo", "Cy", "Di"].map(claim));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(new Set(results.filter(Boolean)).size).toBe(3);
  });

  it("never lets two checkouts hold the same share", async () => {
    const id = "80000000-0000-4000-8000-000000000002";
    await privateRequest(id);
    const [a, b, c] = await guestIds(id);
    const hold = async (ids: string[], key: string) =>
      (await db.query<{ ok: boolean }>("select hold_shares($1::uuid[], $2, now() + interval '30 minutes') as ok", [ids, key])).rows[0].ok;
    const results = await Promise.all([
      hold([a], "90000000-0000-4000-8000-000000000001"),
      hold([a, b, c], "90000000-0000-4000-8000-000000000002"),
      hold([a], "90000000-0000-4000-8000-000000000003"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    // An expired hold can be taken over.
    await db.query("update private_guests set hold_until = now() - interval '1 minute' where request_id = $1", [id]);
    expect(await hold([b], "90000000-0000-4000-8000-000000000004")).toBe(true);
  });

  it("marks the held shares paid exactly once when the payment arrives", async () => {
    const id = "80000000-0000-4000-8000-000000000003";
    await privateRequest(id);
    const [a, b] = await guestIds(id);
    const key = "90000000-0000-4000-8000-000000000010";
    await db.query("select hold_shares($1::uuid[], $2, now() + interval '30 minutes')", [[a, b], key]);
    await db.query(`insert into payments (private_request_id, kind, amount_cents, stripe_session_id, share_hold_key) values ($1, 'private_share', 14000, 'cs_share_1', $2)`, [id, key]);
    expect((await db.query<{ ok: boolean }>("select record_payment_once('evt_share_1', 'cs_share_1') as ok")).rows[0].ok).toBe(true);
    expect((await db.query<{ ok: boolean }>("select record_payment_once('evt_share_2', 'cs_share_1') as ok")).rows[0].ok).toBe(false);
    const rows = await db.query<{ status: string }>("select status from private_guests where request_id = $1 order by slot", [id]);
    expect(rows.rows.map((r) => r.status)).toEqual(["paid", "paid", "open"]);
    const r = await db.query<{ status: string; amount_paid_cents: number }>("select status, amount_paid_cents from private_requests where id = $1", [id]);
    expect(r.rows[0]).toEqual({ status: "paid", amount_paid_cents: 14000 });
  });

  it("uses class pass credits atomically and gives them back once", async () => {
    await db.query("insert into class_sessions (id, class_type_id, date, start_time, seats) values ('a1000000-0000-4000-8000-000000000001', 'class-florals', '2027-01-09', '14:00', 8)");
    const book = async (id: string) =>
      db.query(
        `insert into class_bookings (id, reference, token_hash, session_id, seats, guests, contact_name, email, phone, unit_price_cents, total_cents, terms_accepted_at)
         values ($1, $2, $3, 'a1000000-0000-4000-8000-000000000001', 2, '[]', 'Ann', 'ann@example.com', '0400000000', 9500, 19000, now())`,
        [id, `CLS-${id.slice(-5)}`, `hash-${id}`],
      );
    const b1 = "a2000000-0000-4000-8000-000000000001";
    const b2 = "a2000000-0000-4000-8000-000000000002";
    await book(b1);
    await book(b2);
    await db.query(
      `insert into class_passes (id, code_hash, code_last4, credits_total, credits_left, status, buyer_email, expires_on) values ('a3000000-0000-4000-8000-000000000001', 'hash-pass', 'ABCD', 3, 3, 'active', 'ann@example.com', '2027-11-01')`,
    );
    const redeem = async (b: string) => (await db.query<{ n: number }>("select redeem_pass('hash-pass', $1, 2, '2026-11-08') as n", [b])).rows[0].n;
    const [n1, n2] = await Promise.all([redeem(b1), redeem(b2)]);
    expect(n1 + n2).toBe(3);
    expect(await redeem(b1)).toBe(0); // once per booking
    const left = async () => (await db.query<{ n: number }>("select credits_left as n from class_passes where code_hash = 'hash-pass'")).rows[0].n;
    expect(await left()).toBe(0);
    expect((await db.query<{ n: number }>("select return_pass($1, '2026-11-08') as n", [b1])).rows[0].n).toBe(n1);
    expect((await db.query<{ n: number }>("select return_pass($1, '2026-11-08') as n", [b1])).rows[0].n).toBe(0);
    expect(await left()).toBe(n1);
    await expect(db.query("update class_passes set credits_left = 4 where code_hash = 'hash-pass'")).rejects.toThrow();
  });

  it("redeems vouchers on boxes, corporate orders and bookings, once each, and returns them once", async () => {
    await db.query(
      `insert into vouchers (id, kind, code_hash, code_last4, amount_cents, balance_cents, status, buyer_email, expires_on) values ('a4000000-0000-4000-8000-000000000001', 'gift', 'hash-v-everywhere', 'WXYZ', 10000, 10000, 'active', 'k@example.com', '2027-11-01')`,
    );
    await db.query("update seasonal_boxes set cap = 50 where id = 'b0000000-0000-4000-8000-000000000001'");
    await db.query(
      `insert into box_orders (id, reference, token_hash, box_id, box_name, quantity, unit_price_cents, total_cents, customer_name, email, phone, pickup_date, pickup_slot)
       values ('a5000000-0000-4000-8000-000000000001', 'BOX-VVVVV', 'hash-box-v', 'b0000000-0000-4000-8000-000000000001', 'Christmas', 1, 4500, 4500, 'Kim', 'k@example.com', '0400000000', '2026-12-20', '10:00')`,
    );
    const redeem = async (kind: string, id: string, max: number) =>
      (await db.query<{ n: number }>("select redeem_voucher_for($1, 'hash-v-everywhere', $2, $3, '2026-11-08') as n", [kind, id, max])).rows[0].n;
    expect(await redeem("box", "a5000000-0000-4000-8000-000000000001", 4500)).toBe(4500);
    expect(await redeem("box", "a5000000-0000-4000-8000-000000000001", 4500)).toBe(0);
    expect(await redeem("nonsense", "a5000000-0000-4000-8000-000000000001", 4500)).toBe(0);
    const bal = async () => (await db.query<{ b: number }>("select balance_cents as b from vouchers where code_hash = 'hash-v-everywhere'")).rows[0].b;
    expect(await bal()).toBe(5500);
    const back = await db.query<{ amount: number; to_voucher: boolean }>("select * from return_voucher_for('box', 'a5000000-0000-4000-8000-000000000001', '2026-11-08')");
    expect(back.rows[0]).toEqual({ amount: 4500, to_voucher: true });
    expect((await db.query<{ amount: number }>("select * from return_voucher_for('box', 'a5000000-0000-4000-8000-000000000001', '2026-11-08')")).rows[0].amount).toBe(0);
    expect(await bal()).toBe(10000);
  });

  it("records refunds from Stripe's charge.refunded once, never above the payment", async () => {
    const order = "a6000000-0000-4000-8000-000000000001";
    await insertOrder(order, "hash-refund-order");
    await db.query(`insert into payments (order_id, kind, amount_cents, stripe_session_id, stripe_payment_intent, status) values ($1, 'deposit', 6500, 'cs_ref_1', 'pi_ref_1', 'paid')`, [order]);
    const call = async (evt: string, amount: number) => (await db.query<{ ok: boolean }>("select record_charge_refunded($1, 'pi_ref_1', $2) as ok", [evt, amount])).rows[0].ok;
    expect(await call("evt_r1", 2000)).toBe(true);
    expect(await call("evt_r1", 9000)).toBe(false);
    expect(await call("evt_r2", 99999)).toBe(true);
    expect((await db.query<{ n: number }>("select refunded_cents as n from payments where stripe_session_id = 'cs_ref_1'")).rows[0].n).toBe(6500);
    await expect(db.query("update payments set refunded_cents = 7000 where stripe_session_id = 'cs_ref_1'")).rejects.toThrow();
  });

  it("lets only one order claim each stamp card reward", async () => {
    const claim = (order: string) => db.query<{ n: number }>("select claim_stamp_reward('Sam@Example.com', 1, $1) as n", [order]);
    const results = await Promise.all([claim("a7000000-0000-4000-8000-000000000001"), claim("a7000000-0000-4000-8000-000000000002")]);
    expect(results.map((r) => r.rows[0].n).sort()).toEqual([0, 1]);
    expect((await db.query<{ email: string }>("select email from stamp_rewards")).rows[0].email).toBe("sam@example.com");
    // Two rewards earned: the second order can now claim reward 2.
    expect((await db.query<{ n: number }>("select claim_stamp_reward('sam@example.com', 2, 'a7000000-0000-4000-8000-000000000003') as n")).rows[0].n).toBe(2);
  });

  it("only accepts class photo paths in the private class folder", async () => {
    await expect(
      db.query("insert into class_photos (session_id, path) values ('a1000000-0000-4000-8000-000000000001', '../../etc/passwd')"),
    ).rejects.toThrow();
    await db.query(
      "insert into class_photos (session_id, path) values ('a1000000-0000-4000-8000-000000000001', 'classes/a1000000-0000-4000-8000-000000000001/photo-a8000000-0000-4000-8000-000000000001.jpg')",
    );
  });
});
