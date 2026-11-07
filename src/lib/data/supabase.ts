// Supabase adapter. Runs only on the server with the service role key, after
// the website has done its own checks (order link token or admin login).

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Allergen,
  CakeConfig,
  CatalogueItem,
  Category,
  Order,
  OrderUpdate,
  Payment,
  PriceMode,
  Settings,
  Stage,
} from "../domain/types";
import { PAYMENT_HOLD_MINUTES, type Repository } from "./repository";
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
  };
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

  async listActiveBookings(fromDate, toDate) {
    const holdSince = new Date(Date.now() - PAYMENT_HOLD_MINUTES * 60_000).toISOString();
    const rows = check(
      await db()
        .from("orders")
        .select("pickup_date,pickup_slot,stage,created_at")
        .gte("pickup_date", fromDate)
        .lte("pickup_date", toDate)
        .neq("stage", "cancelled"),
    ) as Row[];
    return rows
      .filter((r) => r.stage !== "awaiting_payment" || (r.created_at as string) >= holdSince)
      .map((r) => ({ pickupDate: r.pickup_date as string, pickupSlot: r.pickup_slot as string }));
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
  async setStage(id, stage) {
    check(await db().from("orders").update({ stage }).eq("id", id));
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
};

function toPayment(r: Row): Payment {
  return {
    id: r.id as string,
    orderId: r.order_id as string,
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
