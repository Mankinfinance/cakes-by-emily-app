// Supabase adapter. Runs only on the server with the service role key, after
// the website has done its own checks (order link token or admin login).

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Allergen,
  Automation,
  AutomationKey,
  BoxOrder,
  CakeConfig,
  CatalogueItem,
  Category,
  DietaryFilter,
  Order,
  OrderUpdate,
  Payment,
  PriceMode,
  SeasonalBox,
  Settings,
  Stage,
  Voucher,
  WaitlistEntry,
} from "../domain/types";
import { PAYMENT_HOLD_MINUTES, type OrderPatch, type Repository } from "./repository";
import { SAMPLE_SETTINGS } from "./sample-data";
import { settingsSchema } from "../validation";

const BUCKET = "order-media";

let client: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}

type Row = Record<string, unknown>;

function toItem(r: Row): CatalogueItem {
  return {
    id: r.id as string,
    category: r.category as Category,
    name: r.name as string,
    description: (r.description as string) ?? "",
    priceCents: r.price_cents as number,
    priceMode: r.price_mode as PriceMode,
    tiers: r.tiers as number,
    hex: (r.hex as string | null) ?? null,
    allergens: (r.allergens as Allergen[]) ?? [],
    visible: r.visible as boolean,
    sort: r.sort as number,
  };
}

function toOrder(r: Row, items: Row[] = []): Order {
  return {
    id: r.id as string,
    reference: r.reference as string,
    tokenHash: r.token_hash as string,
    stage: r.stage as Stage,
    customerName: r.customer_name as string,
    email: r.email as string,
    phone: r.phone as string,
    marketingOptIn: r.marketing_opt_in as boolean,
    pickupDate: r.pickup_date as string,
    pickupSlot: r.pickup_slot as string,
    config: r.config as CakeConfig,
    allergyNotes: r.allergy_notes as string,
    notes: r.notes as string,
    inspirationPath: (r.inspiration_path as string | null) ?? null,
    items: items.map((i) => ({
      itemId: (i.item_id as string | null) ?? null,
      category: i.category as string,
      name: i.name as string,
      amountCents: i.amount_cents as number,
    })),
    subtotalCents: r.subtotal_cents as number,
    rushFeeCents: r.rush_fee_cents as number,
    peakSurchargeCents: r.peak_surcharge_cents as number,
    totalCents: r.total_cents as number,
    depositCents: r.deposit_cents as number,
    amountPaidCents: r.amount_paid_cents as number,
    isRush: r.is_rush as boolean,
    termsAcceptedAt: r.terms_accepted_at as string,
    createdAt: r.created_at as string,
    remindersSent: (r.reminders_sent as string[]) ?? [],
    dietary: ((r.dietary as string[]) ?? []) as DietaryFilter[],
    remindNextYear: (r.remind_next_year as boolean) ?? false,
    dateChangesUsed: (r.date_changes_used as number) ?? 0,
    designChangesUsed: (r.design_changes_used as number) ?? 0,
    approvedAt: (r.approved_at as string | null) ?? null,
    voucherId: (r.voucher_id as string | null) ?? null,
    voucherAppliedCents: (r.voucher_applied_cents as number) ?? 0,
    waitlistId: (r.waitlist_id as string | null) ?? null,
    kitchenDone: (r.kitchen_done as boolean) ?? false,
    cancellation: (r.cancellation as Order["cancellation"]) ?? null,
  };
}

const ORDER_PATCH_COLUMNS: Record<keyof OrderPatch, string> = {
  pickupDate: "pickup_date",
  pickupSlot: "pickup_slot",
  dateChangesUsed: "date_changes_used",
  designChangesUsed: "design_changes_used",
  approvedAt: "approved_at",
  kitchenDone: "kitchen_done",
  cancellation: "cancellation",
  stage: "stage",
};

function toWaitlist(r: Row): WaitlistEntry {
  return {
    id: r.id as string,
    date: r.date as string,
    customerName: r.customer_name as string,
    email: r.email as string,
    phone: r.phone as string,
    config: r.config as CakeConfig,
    dietary: ((r.dietary as string[]) ?? []) as DietaryFilter[],
    status: r.status as WaitlistEntry["status"],
    offerTokenHash: (r.offer_token_hash as string | null) ?? null,
    offeredAt: (r.offered_at as string | null) ?? null,
    offerExpiresAt: (r.offer_expires_at as string | null) ?? null,
    orderId: (r.order_id as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

function toBox(r: Row): SeasonalBox {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? "",
    priceCents: r.price_cents as number,
    cap: r.cap as number,
    sold: r.sold as number,
    opensOn: r.opens_on as string,
    closesOn: r.closes_on as string,
    pickupFrom: r.pickup_from as string,
    pickupTo: r.pickup_to as string,
    photoPath: (r.photo_path as string | null) ?? null,
    visible: r.visible as boolean,
    sort: r.sort as number,
  };
}

const BOX_COLUMNS: Record<string, string> = {
  name: "name",
  description: "description",
  priceCents: "price_cents",
  cap: "cap",
  opensOn: "opens_on",
  closesOn: "closes_on",
  pickupFrom: "pickup_from",
  pickupTo: "pickup_to",
  photoPath: "photo_path",
  visible: "visible",
  sort: "sort",
};

function toBoxOrder(r: Row): BoxOrder {
  return {
    id: r.id as string,
    reference: r.reference as string,
    tokenHash: r.token_hash as string,
    boxId: r.box_id as string,
    boxName: r.box_name as string,
    quantity: r.quantity as number,
    unitPriceCents: r.unit_price_cents as number,
    totalCents: r.total_cents as number,
    amountPaidCents: r.amount_paid_cents as number,
    customerName: r.customer_name as string,
    email: r.email as string,
    phone: r.phone as string,
    marketingOptIn: r.marketing_opt_in as boolean,
    pickupDate: r.pickup_date as string,
    pickupSlot: r.pickup_slot as string,
    status: r.status as BoxOrder["status"],
    kitchenDone: r.kitchen_done as boolean,
    createdAt: r.created_at as string,
  };
}

function toVoucher(r: Row): Voucher {
  return {
    id: r.id as string,
    kind: r.kind as Voucher["kind"],
    codeHash: r.code_hash as string,
    codeLast4: r.code_last4 as string,
    amountCents: r.amount_cents as number,
    balanceCents: r.balance_cents as number,
    status: r.status as Voucher["status"],
    buyerName: (r.buyer_name as string) ?? "",
    buyerEmail: r.buyer_email as string,
    recipientName: (r.recipient_name as string) ?? "",
    recipientEmail: (r.recipient_email as string) ?? "",
    message: (r.message as string) ?? "",
    expiresOn: r.expires_on as string,
    sourceOrderId: (r.source_order_id as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

/** Postgres unique violation, e.g. a second live waitlist offer for the same date. */
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

async function withItems(rows: Row[]): Promise<Order[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id as string);
  const items = check(await db().from("order_items").select("*").in("order_id", ids).order("id")) as Row[];
  return rows.map((r) => toOrder(r, items.filter((i) => i.order_id === r.id)));
}

const ITEM_PATCH_COLUMNS: Record<string, string> = {
  name: "name",
  description: "description",
  priceCents: "price_cents",
  priceMode: "price_mode",
  tiers: "tiers",
  hex: "hex",
  allergens: "allergens",
  visible: "visible",
  sort: "sort",
};

export const supabaseRepository: Repository = {
  async listCatalogue() {
    const rows = check(await db().from("catalogue_items").select("*").order("sort")) as Row[];
    return rows.map(toItem);
  },
  async updateCatalogueItem(id, patch) {
    const row: Row = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(patch)) {
      const col = ITEM_PATCH_COLUMNS[k];
      if (col) row[col] = v;
    }
    check(await db().from("catalogue_items").update(row).eq("id", id));
  },
  async createCatalogueItem(item) {
    check(
      await db().from("catalogue_items").insert({
        id: item.id,
        category: item.category,
        name: item.name,
        description: item.description,
        price_cents: item.priceCents,
        price_mode: item.priceMode,
        tiers: item.tiers,
        hex: item.hex,
        allergens: item.allergens,
        visible: item.visible,
        sort: item.sort,
      }),
    );
  },
  async getSettings(): Promise<Settings> {
    const row = check(await db().from("settings").select("data").eq("id", 1).maybeSingle()) as Row | null;
    const parsed = settingsSchema.safeParse({ ...SAMPLE_SETTINGS, ...((row?.data as object) ?? {}) });
    return parsed.success ? parsed.data : SAMPLE_SETTINGS;
  },
  async saveSettings(settings) {
    check(await db().from("settings").upsert({ id: 1, data: settings, updated_at: new Date().toISOString() }));
  },
  async listDaysOff() {
    const rows = check(await db().from("days_off").select("*").order("date")) as Row[];
    return rows.map((r) => ({ date: r.date as string, note: r.note as string }));
  },
  async addDayOff(day) {
    check(await db().from("days_off").upsert({ date: day.date, note: day.note }));
  },
  async removeDayOff(date) {
    check(await db().from("days_off").delete().eq("date", date));
  },
  async listPeakDates() {
    const rows = check(await db().from("peak_dates").select("*").order("date")) as Row[];
    return rows.map((r) => ({
      date: r.date as string,
      label: r.label as string,
      surchargeCents: r.surcharge_cents as number,
    }));
  },
  async upsertPeakDate(peak) {
    check(
      await db()
        .from("peak_dates")
        .upsert({ date: peak.date, label: peak.label, surcharge_cents: peak.surchargeCents }),
    );
  },
  async removePeakDate(date) {
    check(await db().from("peak_dates").delete().eq("date", date));
  },

  async listActiveBookings(fromDate, toDate, query) {
    const nowIso = new Date().toISOString();
    const holdSince = new Date(Date.now() - PAYMENT_HOLD_MINUTES * 60_000).toISOString();
    const [orderRows, offerRows] = await Promise.all([
      db()
        .from("orders")
        .select("id,pickup_date,pickup_slot,stage,created_at")
        .gte("pickup_date", fromDate)
        .lte("pickup_date", toDate)
        .neq("stage", "cancelled"),
      db()
        .from("waitlist")
        .select("id,date")
        .eq("status", "offered")
        .gt("offer_expires_at", nowIso)
        .gte("date", fromDate)
        .lte("date", toDate),
    ]);
    const orders = (check(orderRows) as Row[])
      .filter((r) => r.id !== query?.excludeOrderId)
      .filter((r) => r.stage !== "awaiting_payment" || (r.created_at as string) >= holdSince)
      .map((r) => ({ pickupDate: r.pickup_date as string, pickupSlot: r.pickup_slot as string }));
    const offers = (check(offerRows) as Row[])
      .filter((r) => r.id !== query?.excludeWaitlistId)
      .map((r) => ({ pickupDate: r.date as string, pickupSlot: "" }));
    return [...orders, ...offers];
  },
  async createOrder(o) {
    const row = check(
      await db()
        .from("orders")
        .insert({
          id: o.id,
          reference: o.reference,
          token_hash: o.tokenHash,
          stage: o.stage,
          customer_name: o.customerName,
          email: o.email,
          phone: o.phone,
          marketing_opt_in: o.marketingOptIn,
          pickup_date: o.pickupDate,
          pickup_slot: o.pickupSlot,
          config: o.config,
          allergy_notes: o.allergyNotes,
          notes: o.notes,
          inspiration_path: o.inspirationPath,
          subtotal_cents: o.subtotalCents,
          rush_fee_cents: o.rushFeeCents,
          peak_surcharge_cents: o.peakSurchargeCents,
          total_cents: o.totalCents,
          deposit_cents: o.depositCents,
          is_rush: o.isRush,
          terms_accepted_at: o.termsAcceptedAt,
          dietary: o.dietary,
          remind_next_year: o.remindNextYear,
          waitlist_id: o.waitlistId,
        })
        .select("*")
        .single(),
    ) as Row;
    if (o.items.length) {
      check(
        await db()
          .from("order_items")
          .insert(
            o.items.map((i) => ({
              order_id: row.id,
              item_id: i.itemId,
              category: i.category,
              name: i.name,
              amount_cents: i.amountCents,
            })),
          ),
      );
    }
    const [order] = await withItems([row]);
    return order;
  },
  async getOrderById(id) {
    const row = check(await db().from("orders").select("*").eq("id", id).maybeSingle()) as Row | null;
    return row ? (await withItems([row]))[0] : null;
  },
  async getOrderByTokenHash(tokenHash) {
    const row = check(
      await db().from("orders").select("*").eq("token_hash", tokenHash).maybeSingle(),
    ) as Row | null;
    return row ? (await withItems([row]))[0] : null;
  },
  async listOrders(opts) {
    let q = db().from("orders").select("*").order("pickup_date").order("pickup_slot").limit(500);
    if (!opts?.includeUnpaid) q = q.neq("stage", "awaiting_payment");
    return withItems(check(await q) as Row[]);
  },
  async listStaleUnpaidOrders(before) {
    const rows = check(
      await db().from("orders").select("*").eq("stage", "awaiting_payment").lt("created_at", before).limit(200),
    ) as Row[];
    return withItems(rows);
  },
  async setStage(id, stage) {
    check(await db().from("orders").update({ stage }).eq("id", id));
  },
  async updateOrder(id, patch) {
    const row: Row = {};
    for (const [k, v] of Object.entries(patch)) {
      const col = ORDER_PATCH_COLUMNS[k as keyof OrderPatch];
      if (col) row[col] = v;
    }
    if (Object.keys(row).length) check(await db().from("orders").update(row).eq("id", id));
  },
  async cancelOrderOnce(id, record, onlyUnpaid) {
    let q = db().from("orders").update({ stage: "cancelled", cancellation: record }).eq("id", id);
    q = onlyUnpaid ? q.eq("stage", "awaiting_payment") : q.not("stage", "in", "(cancelled,collected)");
    const rows = check(await q.select("id")) as Row[];
    return rows.length === 1;
  },
  async markReminderSent(id, key) {
    const row = check(await db().from("orders").select("reminders_sent").eq("id", id).single()) as Row;
    const sent = new Set((row.reminders_sent as string[]) ?? []);
    sent.add(key);
    check(await db().from("orders").update({ reminders_sent: [...sent] }).eq("id", id));
  },

  async createPayment(p) {
    const row = check(
      await db()
        .from("payments")
        .insert({
          order_id: p.orderId,
          box_order_id: p.boxOrderId,
          voucher_id: p.voucherId,
          kind: p.kind,
          amount_cents: p.amountCents,
          stripe_session_id: p.stripeSessionId,
        })
        .select("*")
        .single(),
    ) as Row;
    return toPayment(row);
  },
  async getPaymentBySession(sessionId) {
    const row = check(
      await db().from("payments").select("*").eq("stripe_session_id", sessionId).maybeSingle(),
    ) as Row | null;
    return row ? toPayment(row) : null;
  },
  async recordPaymentOnce(eventId, sessionId) {
    const res = await db().rpc("record_payment_once", { p_event_id: eventId, p_session_id: sessionId });
    return check(res) as boolean;
  },

  async addUpdate(u) {
    const row = check(
      await db()
        .from("order_updates")
        .insert({ order_id: u.orderId, kind: u.kind, caption: u.caption, media_path: u.mediaPath })
        .select("*")
        .single(),
    ) as Row;
    return toUpdate(row);
  },
  async listUpdates(orderId) {
    const rows = check(
      await db().from("order_updates").select("*").eq("order_id", orderId).order("created_at", { ascending: false }),
    ) as Row[];
    return rows.map(toUpdate);
  },
  async uploadMedia(path, file) {
    const { error } = await db().storage.from(BUCKET).upload(path, file.bytes, {
      contentType: file.contentType,
      upsert: false,
    });
    if (error) throw new Error(`Upload failed: ${error.message}`);
  },
  async mediaUrl(path) {
    const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, 60 * 60);
    if (error) return null;
    return data.signedUrl;
  },
  async createUploadTarget(path) {
    const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw new Error(`Could not start upload: ${error.message}`);
    return { kind: "supabase", bucket: BUCKET, path: data.path, token: data.token };
  },
  async readMediaHead(path, length) {
    const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, 60);
    if (error || !data) return null;
    const res = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${length - 1}` } });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer()).slice(0, length);
    return { bytes, contentType: res.headers.get("content-type") ?? "" };
  },
  async deleteMedia(path) {
    await db().storage.from(BUCKET).remove([path]);
  },

  async listAutomations() {
    const rows = check(await db().from("automations").select("*")) as Row[];
    return rows.map((r) => ({ key: r.key as AutomationKey, enabled: r.enabled as boolean, days: r.days as number }));
  },
  async saveAutomation(a: Automation) {
    check(await db().from("automations").upsert({ key: a.key, enabled: a.enabled, days: a.days }));
  },
  async claimMessage(orderId, key) {
    const { error } = await db().from("message_log").insert({ order_id: orderId, key });
    if (!error) return true;
    if (isUniqueViolation(error)) return false;
    throw new Error(`Database error: ${error.message}`);
  },
  async releaseMessage(orderId, key) {
    check(await db().from("message_log").delete().eq("order_id", orderId).eq("key", key));
  },
  async listMessages(orderId) {
    const rows = check(await db().from("message_log").select("*").eq("order_id", orderId)) as Row[];
    return rows.map((r) => ({ orderId: r.order_id as string, key: r.key as string, sentAt: r.sent_at as string }));
  },

  async addWaitlist(e) {
    const row = check(
      await db()
        .from("waitlist")
        .insert({
          date: e.date,
          customer_name: e.customerName,
          email: e.email,
          phone: e.phone,
          config: e.config,
          dietary: e.dietary,
        })
        .select("*")
        .single(),
    ) as Row;
    return toWaitlist(row);
  },
  async listWaitlist(opts) {
    let q = db().from("waitlist").select("*").order("date").order("created_at").limit(1000);
    if (opts?.date) q = q.eq("date", opts.date);
    if (opts?.fromDate) q = q.gte("date", opts.fromDate);
    return (check(await q) as Row[]).map(toWaitlist);
  },
  async getWaitlistById(id) {
    const row = check(await db().from("waitlist").select("*").eq("id", id).maybeSingle()) as Row | null;
    return row ? toWaitlist(row) : null;
  },
  async getWaitlistByOfferHash(hash) {
    const row = check(await db().from("waitlist").select("*").eq("offer_token_hash", hash).maybeSingle()) as Row | null;
    return row ? toWaitlist(row) : null;
  },
  async offerWaitlist(id, tokenHash, offeredAt, expiresAt) {
    const { data, error } = await db()
      .from("waitlist")
      .update({ status: "offered", offer_token_hash: tokenHash, offered_at: offeredAt, offer_expires_at: expiresAt })
      .eq("id", id)
      .eq("status", "waiting")
      .select("id");
    if (isUniqueViolation(error)) return false;
    if (error) throw new Error(`Database error: ${error.message}`);
    return (data ?? []).length === 1;
  },
  async claimWaitlist(id, orderId, now) {
    const rows = check(
      await db()
        .from("waitlist")
        .update({ status: "claimed", order_id: orderId })
        .eq("id", id)
        .eq("status", "offered")
        .gt("offer_expires_at", now)
        .select("id"),
    ) as Row[];
    return rows.length === 1;
  },
  async setWaitlistStatus(id, status) {
    check(await db().from("waitlist").update({ status }).eq("id", id));
  },

  async listBoxes() {
    return (check(await db().from("seasonal_boxes").select("*").order("sort")) as Row[]).map(toBox);
  },
  async getBox(id) {
    const row = check(await db().from("seasonal_boxes").select("*").eq("id", id).maybeSingle()) as Row | null;
    return row ? toBox(row) : null;
  },
  async createBox(b) {
    check(
      await db().from("seasonal_boxes").insert({
        id: b.id,
        name: b.name,
        description: b.description,
        price_cents: b.priceCents,
        cap: b.cap,
        sold: b.sold,
        opens_on: b.opensOn,
        closes_on: b.closesOn,
        pickup_from: b.pickupFrom,
        pickup_to: b.pickupTo,
        photo_path: b.photoPath,
        visible: b.visible,
        sort: b.sort,
      }),
    );
  },
  async updateBox(id, patch) {
    const row: Row = {};
    for (const [k, v] of Object.entries(patch)) if (BOX_COLUMNS[k]) row[BOX_COLUMNS[k]] = v;
    if (Object.keys(row).length) check(await db().from("seasonal_boxes").update(row).eq("id", id));
  },
  async reserveBoxStock(boxId, quantity, today) {
    return check(await db().rpc("reserve_box_stock", { p_box_id: boxId, p_qty: quantity, p_today: today })) as boolean;
  },
  async createBoxOrder(o) {
    const row = check(
      await db()
        .from("box_orders")
        .insert({
          id: o.id,
          reference: o.reference,
          token_hash: o.tokenHash,
          box_id: o.boxId,
          box_name: o.boxName,
          quantity: o.quantity,
          unit_price_cents: o.unitPriceCents,
          total_cents: o.totalCents,
          customer_name: o.customerName,
          email: o.email,
          phone: o.phone,
          marketing_opt_in: o.marketingOptIn,
          pickup_date: o.pickupDate,
          pickup_slot: o.pickupSlot,
        })
        .select("*")
        .single(),
    ) as Row;
    return toBoxOrder(row);
  },
  async getBoxOrderById(id) {
    const row = check(await db().from("box_orders").select("*").eq("id", id).maybeSingle()) as Row | null;
    return row ? toBoxOrder(row) : null;
  },
  async getBoxOrderByTokenHash(tokenHash) {
    const row = check(await db().from("box_orders").select("*").eq("token_hash", tokenHash).maybeSingle()) as Row | null;
    return row ? toBoxOrder(row) : null;
  },
  async listBoxOrders(opts) {
    let q = db().from("box_orders").select("*").order("pickup_date").order("pickup_slot").limit(1000);
    if (!opts?.includeUnpaid) q = q.neq("status", "awaiting_payment");
    return (check(await q) as Row[]).map(toBoxOrder);
  },
  async listStaleUnpaidBoxOrders(before) {
    const rows = check(
      await db().from("box_orders").select("*").eq("status", "awaiting_payment").lt("created_at", before).limit(200),
    ) as Row[];
    return rows.map(toBoxOrder);
  },
  async cancelBoxOrder(id, onlyUnpaid) {
    return check(await db().rpc("cancel_box_order", { p_box_order_id: id, p_only_unpaid: onlyUnpaid })) as boolean;
  },
  async updateBoxOrder(id, patch) {
    const row: Row = {};
    if (patch.kitchenDone !== undefined) row.kitchen_done = patch.kitchenDone;
    if (patch.status !== undefined) row.status = patch.status;
    if (Object.keys(row).length) check(await db().from("box_orders").update(row).eq("id", id));
  },

  async createVoucher(v) {
    const row = check(
      await db()
        .from("vouchers")
        .insert({
          id: v.id,
          kind: v.kind,
          code_hash: v.codeHash,
          code_last4: v.codeLast4,
          amount_cents: v.amountCents,
          balance_cents: v.balanceCents,
          status: v.status,
          buyer_name: v.buyerName,
          buyer_email: v.buyerEmail,
          recipient_name: v.recipientName,
          recipient_email: v.recipientEmail,
          message: v.message,
          expires_on: v.expiresOn,
          source_order_id: v.sourceOrderId,
        })
        .select("*")
        .single(),
    ) as Row;
    return toVoucher(row);
  },
  async getVoucherById(id) {
    const row = check(await db().from("vouchers").select("*").eq("id", id).maybeSingle()) as Row | null;
    return row ? toVoucher(row) : null;
  },
  async getVoucherByCodeHash(hash) {
    const row = check(await db().from("vouchers").select("*").eq("code_hash", hash).maybeSingle()) as Row | null;
    return row ? toVoucher(row) : null;
  },
  async listVouchers() {
    return (check(await db().from("vouchers").select("*").order("created_at", { ascending: false }).limit(1000)) as Row[]).map(toVoucher);
  },
  async setVoucherStatus(id, status) {
    check(await db().from("vouchers").update({ status }).eq("id", id));
  },
  async redeemVoucher(codeHash, orderId, maxCents, today) {
    return check(
      await db().rpc("redeem_voucher", { p_code_hash: codeHash, p_order_id: orderId, p_max_cents: maxCents, p_today: today }),
    ) as number;
  },
  async returnVoucher(orderId, today) {
    const rows = check(await db().rpc("return_voucher", { p_order_id: orderId, p_today: today })) as Row[];
    const r = rows?.[0];
    return { amount: (r?.amount as number) ?? 0, toVoucher: (r?.to_voucher as boolean) ?? false };
  },
};

function toPayment(r: Row): Payment {
  return {
    id: r.id as string,
    orderId: (r.order_id as string | null) ?? null,
    boxOrderId: (r.box_order_id as string | null) ?? null,
    voucherId: (r.voucher_id as string | null) ?? null,
    kind: r.kind as Payment["kind"],
    amountCents: r.amount_cents as number,
    stripeSessionId: r.stripe_session_id as string,
    status: r.status as Payment["status"],
    createdAt: r.created_at as string,
  };
}

function toUpdate(r: Row): OrderUpdate {
  return {
    id: r.id as string,
    orderId: r.order_id as string,
    kind: r.kind as OrderUpdate["kind"],
    caption: r.caption as string,
    mediaPath: (r.media_path as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}
