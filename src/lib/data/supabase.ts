// Supabase adapter. Runs only on the server with the service role key, after
// the website has done its own checks (order link token or admin login).

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SalesSummary } from "../domain/snapshot";
import type {
  Allergen,
  Automation,
  AutomationKey,
  BoxOrder,
  ClassBooking,
  ClassPass,
  ClassPhoto,
  ClassSession,
  ClassType,
  CorporateOrder,
  CorporatePackage,
  PrivateGuest,
  PrivateRequest,
  RefundRecord,
  Referral,
  Review,
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
    bondCents: (r.bond_cents as number) ?? 0,
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
    referralCode: (r.referral_code as string | null) ?? null,
    stampReward: (r.stamp_reward as boolean) ?? false,
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
    sessionId: (r.session_id as string | null) ?? null,
    seats: (r.seats as number) ?? 1,
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
    voucherId: (r.voucher_id as string | null) ?? null,
    voucherAppliedCents: (r.voucher_applied_cents as number) ?? 0,
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

function toCorporate(r: Row): CorporateOrder {
  return {
    id: r.id as string,
    reference: r.reference as string,
    tokenHash: r.token_hash as string,
    packageId: r.package_id as string,
    packageName: r.package_name as string,
    quantity: r.quantity as number,
    totalCents: r.total_cents as number,
    depositCents: r.deposit_cents as number,
    amountPaidCents: r.amount_paid_cents as number,
    companyName: r.company_name as string,
    abn: (r.abn as string) ?? "",
    contactName: r.contact_name as string,
    email: r.email as string,
    phone: r.phone as string,
    logoPath: (r.logo_path as string | null) ?? null,
    notes: (r.notes as string) ?? "",
    pickupDate: r.pickup_date as string,
    pickupSlot: r.pickup_slot as string,
    status: r.status as CorporateOrder["status"],
    kitchenDone: r.kitchen_done as boolean,
    termsAcceptedAt: r.terms_accepted_at as string,
    createdAt: r.created_at as string,
    voucherId: (r.voucher_id as string | null) ?? null,
    voucherAppliedCents: (r.voucher_applied_cents as number) ?? 0,
  };
}

function toReview(r: Row): Review {
  return {
    id: r.id as string,
    orderId: r.order_id as string,
    rating: r.rating as number,
    text: (r.text as string) ?? "",
    photoPath: (r.photo_path as string | null) ?? null,
    consentToPublish: r.consent_to_publish as boolean,
    displayName: r.display_name as string,
    status: r.status as Review["status"],
    createdAt: r.created_at as string,
  };
}

function toReferral(r: Row): Referral {
  return {
    id: r.id as string,
    code: r.code as string,
    referrerEmail: r.referrer_email as string,
    referredEmail: r.referred_email as string,
    orderId: r.order_id as string,
    status: r.status as Referral["status"],
    createdAt: r.created_at as string,
  };
}

function toClassType(r: Row): ClassType {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? "",
    level: (r.level as string) ?? "",
    priceCents: r.price_cents as number,
    durationMinutes: r.duration_minutes as number,
    defaultSeats: r.default_seats as number,
    minGuests: r.min_guests as number,
    isSip: r.is_sip as boolean,
    ageNote: (r.age_note as string) ?? "",
    visible: r.visible as boolean,
    sort: r.sort as number,
  };
}

function toSession(r: Row): ClassSession {
  return {
    id: r.id as string,
    classTypeId: r.class_type_id as string,
    date: r.date as string,
    startTime: r.start_time as string,
    seats: r.seats as number,
    booked: r.booked as number,
    status: r.status as ClassSession["status"],
    seriesId: (r.series_id as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

function toBooking(r: Row): ClassBooking {
  return {
    id: r.id as string,
    reference: r.reference as string,
    tokenHash: r.token_hash as string,
    sessionId: r.session_id as string,
    seats: r.seats as number,
    guests: (r.guests as ClassBooking["guests"]) ?? [],
    contactName: r.contact_name as string,
    email: r.email as string,
    phone: r.phone as string,
    unitPriceCents: r.unit_price_cents as number,
    discountCents: r.discount_cents as number,
    totalCents: r.total_cents as number,
    amountPaidCents: r.amount_paid_cents as number,
    status: r.status as ClassBooking["status"],
    adultConfirmed: r.adult_confirmed as boolean,
    marketingOptIn: r.marketing_opt_in as boolean,
    waitlistId: (r.waitlist_id as string | null) ?? null,
    cancellation: (r.cancellation as ClassBooking["cancellation"]) ?? null,
    termsAcceptedAt: r.terms_accepted_at as string,
    createdAt: r.created_at as string,
    passId: (r.pass_id as string | null) ?? null,
    passCredits: (r.pass_credits as number) ?? 0,
    voucherId: (r.voucher_id as string | null) ?? null,
    voucherAppliedCents: (r.voucher_applied_cents as number) ?? 0,
  };
}

function toPrivate(r: Row): PrivateRequest {
  return {
    id: r.id as string,
    reference: r.reference as string,
    packageKey: r.package_key as string,
    packageName: r.package_name as string,
    guests: r.guests as number,
    perPersonCents: r.per_person_cents as number,
    depositCents: r.deposit_cents as number,
    estimateCents: r.estimate_cents as number,
    preferredDate: r.preferred_date as string,
    preferredTime: r.preferred_time as string,
    occasion: (r.occasion as string) ?? "",
    contactName: r.contact_name as string,
    email: r.email as string,
    phone: r.phone as string,
    notes: (r.notes as string) ?? "",
    status: r.status as PrivateRequest["status"],
    payTokenHash: (r.pay_token_hash as string | null) ?? null,
    amountPaidCents: r.amount_paid_cents as number,
    createdAt: r.created_at as string,
    shareTokenHash: (r.share_token_hash as string | null) ?? null,
    lastNudgeAt: (r.last_nudge_at as string | null) ?? null,
    cancellation: (r.cancellation as PrivateRequest["cancellation"]) ?? null,
  };
}

function toGuest(r: Row): PrivateGuest {
  return {
    id: r.id as string,
    requestId: r.request_id as string,
    slot: r.slot as number,
    name: (r.name as string) ?? "",
    email: (r.email as string) ?? "",
    allergies: (r.allergies as string) ?? "",
    dietary: ((r.dietary as string[]) ?? []) as DietaryFilter[],
    messageOptIn: r.message_opt_in as boolean,
    shareCents: r.share_cents as number,
    status: r.status as PrivateGuest["status"],
    holdKey: (r.hold_key as string | null) ?? null,
    holdUntil: (r.hold_until as string | null) ?? null,
    paidAt: (r.paid_at as string | null) ?? null,
    detailsAt: (r.details_at as string | null) ?? null,
  };
}

function toPass(r: Row): ClassPass {
  return {
    id: r.id as string,
    codeHash: r.code_hash as string,
    codeLast4: r.code_last4 as string,
    creditsTotal: r.credits_total as number,
    creditsLeft: r.credits_left as number,
    status: r.status as ClassPass["status"],
    buyerName: (r.buyer_name as string) ?? "",
    buyerEmail: r.buyer_email as string,
    expiresOn: r.expires_on as string,
    createdAt: r.created_at as string,
  };
}

const toPhoto = (r: Row): ClassPhoto => ({
  id: r.id as string,
  sessionId: r.session_id as string,
  path: r.path as string,
  caption: (r.caption as string) ?? "",
  createdAt: r.created_at as string,
});

const PAYMENT_TARGET_COLUMN = { order: "order_id", box: "box_order_id", corporate: "corporate_order_id", booking: "class_booking_id", private: "private_request_id" } as const;

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
  bondCents: "bond_cents",
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
        bond_cents: item.bondCents,
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
    const [orderRows, offerRows, corporateRows] = await Promise.all([
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
        .is("session_id", null)
        .gt("offer_expires_at", nowIso)
        .gte("date", fromDate)
        .lte("date", toDate),
      db()
        .from("corporate_orders")
        .select("pickup_date,pickup_slot,status,created_at")
        .gte("pickup_date", fromDate)
        .lte("pickup_date", toDate)
        .neq("status", "cancelled"),
    ]);
    const orders = (check(orderRows) as Row[])
      .filter((r) => r.id !== query?.excludeOrderId)
      .filter((r) => r.stage !== "awaiting_payment" || (r.created_at as string) >= holdSince)
      .map((r) => ({ pickupDate: r.pickup_date as string, pickupSlot: r.pickup_slot as string }));
    const offers = (check(offerRows) as Row[])
      .filter((r) => r.id !== query?.excludeWaitlistId)
      .map((r) => ({ pickupDate: r.date as string, pickupSlot: "" }));
    const corporate = (check(corporateRows) as Row[])
      .filter((r) => r.status !== "awaiting_payment" || (r.created_at as string) >= holdSince)
      .map((r) => ({ pickupDate: r.pickup_date as string, pickupSlot: r.pickup_slot as string }));
    return [...orders, ...offers, ...corporate];
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
          referral_code: o.referralCode,
          stamp_reward: o.stampReward,
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
          corporate_order_id: p.corporateOrderId ?? null,
          class_booking_id: p.classBookingId ?? null,
          private_request_id: p.privateRequestId ?? null,
          pass_id: p.passId ?? null,
          share_hold_key: p.shareHoldKey ?? null,
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
          session_id: e.sessionId ?? null,
          seats: e.seats ?? 1,
        })
        .select("*")
        .single(),
    ) as Row;
    return toWaitlist(row);
  },
  async listWaitlist(opts) {
    let q = db().from("waitlist").select("*").order("date").order("created_at").limit(1000);
    if (!opts?.all) q = opts?.sessionId ? q.eq("session_id", opts.sessionId) : q.is("session_id", null);
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
        .update({ status: "claimed", order_id: orderId ?? null })
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

  async listOrdersByEmail(email) {
    const rows = check(await db().from("orders").select("*").ilike("email", email.replace(/[%_]/g, "")).limit(500)) as Row[];
    return withItems(rows);
  },

  async listCorporatePackages() {
    const rows = check(await db().from("corporate_packages").select("*").order("sort")) as Row[];
    return rows.map(
      (r): CorporatePackage => ({
        id: r.id as string,
        product: r.product as CorporatePackage["product"],
        name: r.name as string,
        quantity: r.quantity as number,
        priceCents: r.price_cents as number,
        visible: r.visible as boolean,
        sort: r.sort as number,
      }),
    );
  },
  async updateCorporatePackage(id, patch) {
    const row: Row = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.priceCents !== undefined) row.price_cents = patch.priceCents;
    if (patch.visible !== undefined) row.visible = patch.visible;
    if (Object.keys(row).length) check(await db().from("corporate_packages").update(row).eq("id", id));
  },
  async createCorporateOrder(o) {
    const row = check(
      await db()
        .from("corporate_orders")
        .insert({
          id: o.id,
          reference: o.reference,
          token_hash: o.tokenHash,
          package_id: o.packageId,
          package_name: o.packageName,
          quantity: o.quantity,
          total_cents: o.totalCents,
          deposit_cents: o.depositCents,
          company_name: o.companyName,
          abn: o.abn,
          contact_name: o.contactName,
          email: o.email,
          phone: o.phone,
          logo_path: o.logoPath,
          notes: o.notes,
          pickup_date: o.pickupDate,
          pickup_slot: o.pickupSlot,
          terms_accepted_at: o.termsAcceptedAt,
        })
        .select("*")
        .single(),
    ) as Row;
    return toCorporate(row);
  },
  async getCorporateOrderById(id) {
    const row = check(await db().from("corporate_orders").select("*").eq("id", id).maybeSingle()) as Row | null;
    return row ? toCorporate(row) : null;
  },
  async getCorporateOrderByTokenHash(tokenHash) {
    const row = check(await db().from("corporate_orders").select("*").eq("token_hash", tokenHash).maybeSingle()) as Row | null;
    return row ? toCorporate(row) : null;
  },
  async listCorporateOrders(opts) {
    let q = db().from("corporate_orders").select("*").order("pickup_date").order("pickup_slot").limit(1000);
    if (!opts?.includeUnpaid) q = q.neq("status", "awaiting_payment");
    return (check(await q) as Row[]).map(toCorporate);
  },
  async listStaleUnpaidCorporate(before) {
    const rows = check(await db().from("corporate_orders").select("*").eq("status", "awaiting_payment").lt("created_at", before).limit(200)) as Row[];
    return rows.map(toCorporate);
  },
  async setCorporateStatus(id, status, from) {
    const rows = check(await db().from("corporate_orders").update({ status }).eq("id", id).in("status", from).select("id")) as Row[];
    return rows.length === 1;
  },
  async setCorporateKitchenDone(id, done) {
    check(await db().from("corporate_orders").update({ kitchen_done: done }).eq("id", id));
  },

  async createReview(r) {
    const { data, error } = await db()
      .from("reviews")
      .insert({
        order_id: r.orderId,
        rating: r.rating,
        text: r.text,
        photo_path: r.photoPath,
        consent_to_publish: r.consentToPublish,
        display_name: r.displayName,
      })
      .select("*")
      .single();
    if (isUniqueViolation(error)) return null;
    if (error) throw new Error(`Database error: ${error.message}`);
    return toReview(data as Row);
  },
  async getReviewByOrder(orderId) {
    const row = check(await db().from("reviews").select("*").eq("order_id", orderId).maybeSingle()) as Row | null;
    return row ? toReview(row) : null;
  },
  async listReviews(opts) {
    let q = db().from("reviews").select("*").order("created_at", { ascending: false }).limit(500);
    if (opts?.status) q = q.eq("status", opts.status);
    return (check(await q) as Row[]).map(toReview);
  },
  async setReviewStatus(id, status) {
    check(await db().from("reviews").update({ status }).eq("id", id));
  },

  async getReferralCodeByEmail(email) {
    const row = check(await db().from("referral_codes").select("*").eq("email", email.toLowerCase()).maybeSingle()) as Row | null;
    return row ? { code: row.code as string, email: row.email as string, createdAt: row.created_at as string } : null;
  },
  async getReferralCode(code) {
    const row = check(await db().from("referral_codes").select("*").eq("code", code).maybeSingle()) as Row | null;
    return row ? { code: row.code as string, email: row.email as string, createdAt: row.created_at as string } : null;
  },
  async createReferralCode(code, email) {
    const { error } = await db().from("referral_codes").insert({ code, email: email.toLowerCase() });
    if (isUniqueViolation(error)) return false;
    if (error) throw new Error(`Database error: ${error.message}`);
    return true;
  },
  async createReferral(r) {
    const { error } = await db()
      .from("referrals")
      .insert({ code: r.code, referrer_email: r.referrerEmail, referred_email: r.referredEmail, order_id: r.orderId });
    if (isUniqueViolation(error) || error?.code === "23514") return false;
    if (error) throw new Error(`Database error: ${error.message}`);
    return true;
  },
  async listReferrals() {
    return (check(await db().from("referrals").select("*").order("created_at", { ascending: false }).limit(500)) as Row[]).map(toReferral);
  },
  async rewardReferralOnce(orderId) {
    const rows = check(
      await db().from("referrals").update({ status: "rewarded" }).eq("order_id", orderId).eq("status", "pending").select("*"),
    ) as Row[];
    return rows[0] ? toReferral(rows[0]) : null;
  },
  async voidReferral(orderId) {
    check(await db().from("referrals").update({ status: "void" }).eq("order_id", orderId).eq("status", "pending"));
  },

  async listClassTypes() {
    return (check(await db().from("class_types").select("*").order("sort")) as Row[]).map(toClassType);
  },
  async updateClassType(id, patch) {
    const row: Row = {};
    if (patch.priceCents !== undefined) row.price_cents = patch.priceCents;
    if (patch.visible !== undefined) row.visible = patch.visible;
    if (patch.minGuests !== undefined) row.min_guests = patch.minGuests;
    if (patch.description !== undefined) row.description = patch.description;
    if (Object.keys(row).length) check(await db().from("class_types").update(row).eq("id", id));
  },
  async listSessions(opts) {
    let q = db().from("class_sessions").select("*").order("date").order("start_time").limit(1000);
    if (!opts?.includeCancelled) q = q.eq("status", "scheduled");
    if (opts?.fromDate) q = q.gte("date", opts.fromDate);
    return (check(await q) as Row[]).map(toSession);
  },
  async getSession(id) {
    const row = check(await db().from("class_sessions").select("*").eq("id", id).maybeSingle()) as Row | null;
    return row ? toSession(row) : null;
  },
  async createSession(x) {
    const row = check(
      await db()
        .from("class_sessions")
        .insert({ id: x.id, class_type_id: x.classTypeId, date: x.date, start_time: x.startTime, seats: x.seats, status: x.status, series_id: x.seriesId })
        .select("*")
        .single(),
    ) as Row;
    return toSession(row);
  },
  async updateSession(id, patch) {
    const row: Row = {};
    if (patch.date !== undefined) row.date = patch.date;
    if (patch.startTime !== undefined) row.start_time = patch.startTime;
    if (patch.seats !== undefined) row.seats = patch.seats;
    if (patch.status !== undefined) row.status = patch.status;
    if (Object.keys(row).length) check(await db().from("class_sessions").update(row).eq("id", id));
  },
  async reserveSeats(sessionId, seats) {
    return check(await db().rpc("reserve_class_seats", { p_session_id: sessionId, p_seats: seats })) as boolean;
  },
  async releaseSeats(sessionId, seats) {
    check(await db().rpc("release_class_seats", { p_session_id: sessionId, p_seats: seats }));
  },
  async createBooking(b) {
    const row = check(
      await db()
        .from("class_bookings")
        .insert({
          id: b.id,
          reference: b.reference,
          token_hash: b.tokenHash,
          session_id: b.sessionId,
          seats: b.seats,
          guests: b.guests,
          contact_name: b.contactName,
          email: b.email,
          phone: b.phone,
          unit_price_cents: b.unitPriceCents,
          discount_cents: b.discountCents,
          total_cents: b.totalCents,
          adult_confirmed: b.adultConfirmed,
          marketing_opt_in: b.marketingOptIn,
          waitlist_id: b.waitlistId,
          terms_accepted_at: b.termsAcceptedAt,
        })
        .select("*")
        .single(),
    ) as Row;
    return toBooking(row);
  },
  async getBookingById(id) {
    const row = check(await db().from("class_bookings").select("*").eq("id", id).maybeSingle()) as Row | null;
    return row ? toBooking(row) : null;
  },
  async getBookingByTokenHash(tokenHash) {
    const row = check(await db().from("class_bookings").select("*").eq("token_hash", tokenHash).maybeSingle()) as Row | null;
    return row ? toBooking(row) : null;
  },
  async listBookings(opts) {
    let q = db().from("class_bookings").select("*").order("created_at").limit(2000);
    if (opts?.sessionId) q = q.eq("session_id", opts.sessionId);
    if (!opts?.includeUnpaid) q = q.neq("status", "awaiting_payment");
    return (check(await q) as Row[]).map(toBooking);
  },
  async listStaleUnpaidBookings(before) {
    const rows = check(await db().from("class_bookings").select("*").eq("status", "awaiting_payment").lt("created_at", before).limit(200)) as Row[];
    return rows.map(toBooking);
  },
  async updateBookingGuests(id, guests) {
    check(await db().from("class_bookings").update({ guests }).eq("id", id));
  },
  async cancelBookingOnce(id, onlyUnpaid, record) {
    return check(await db().rpc("cancel_class_booking", { p_booking_id: id, p_only_unpaid: onlyUnpaid, p_record: record })) as boolean;
  },
  async setBookingCancellation(id, record) {
    check(await db().from("class_bookings").update({ cancellation: record }).eq("id", id));
  },
  async claimBookingMessage(bookingId, key) {
    const { error } = await db().from("booking_message_log").insert({ booking_id: bookingId, key });
    if (!error) return true;
    if (isUniqueViolation(error)) return false;
    throw new Error(`Database error: ${error.message}`);
  },
  async releaseBookingMessage(bookingId, key) {
    check(await db().from("booking_message_log").delete().eq("booking_id", bookingId).eq("key", key));
  },
  async createPrivateRequest(r) {
    const row = check(
      await db()
        .from("private_requests")
        .insert({
          id: r.id,
          reference: r.reference,
          package_key: r.packageKey,
          package_name: r.packageName,
          guests: r.guests,
          per_person_cents: r.perPersonCents,
          deposit_cents: r.depositCents,
          estimate_cents: r.estimateCents,
          preferred_date: r.preferredDate,
          preferred_time: r.preferredTime,
          occasion: r.occasion,
          contact_name: r.contactName,
          email: r.email,
          phone: r.phone,
          notes: r.notes,
        })
        .select("*")
        .single(),
    ) as Row;
    return toPrivate(row);
  },
  async getPrivateRequest(id) {
    const row = check(await db().from("private_requests").select("*").eq("id", id).maybeSingle()) as Row | null;
    return row ? toPrivate(row) : null;
  },
  async getPrivateRequestByPayHash(hash) {
    const row = check(await db().from("private_requests").select("*").eq("pay_token_hash", hash).maybeSingle()) as Row | null;
    return row ? toPrivate(row) : null;
  },
  async listPrivateRequests() {
    return (check(await db().from("private_requests").select("*").order("created_at", { ascending: false }).limit(500)) as Row[]).map(toPrivate);
  },
  async setPrivateStatus(id, status, from, payTokenHash) {
    const row: Row = { status };
    if (payTokenHash) row.pay_token_hash = payTokenHash;
    const rows = check(await db().from("private_requests").update(row).eq("id", id).eq("status", from).select("id")) as Row[];
    return rows.length === 1;
  },

  async salesSummary(from, to) {
    const data = check(await db().rpc("sales_summary", { p_from: from, p_to: to })) as Omit<SalesSummary, "averageCents">;
    return { ...data, averageCents: data.orders ? Math.round(data.revenueCents / data.orders) : 0 };
  },

  // Phase 4 -----------------------------------------------------------------
  async setPrivateShareToken(id, tokenHash) {
    const rows = check(await db().from("private_requests").update({ share_token_hash: tokenHash }).eq("id", id).is("share_token_hash", null).select("id")) as Row[];
    return rows.length === 1;
  },
  async getPrivateRequestByShareHash(hash) {
    const row = check(await db().from("private_requests").select("*").eq("share_token_hash", hash).maybeSingle()) as Row | null;
    return row ? toPrivate(row) : null;
  },
  async claimNudge(id, before, now) {
    const rows = check(
      await db().from("private_requests").update({ last_nudge_at: now }).eq("id", id).or(`last_nudge_at.is.null,last_nudge_at.lte.${before}`).select("id"),
    ) as Row[];
    return rows.length === 1;
  },
  async cancelPrivateOnce(id, record) {
    const rows = check(
      await db().from("private_requests").update({ status: "cancelled", cancellation: record }).eq("id", id).not("status", "in", "(cancelled,declined)").select("id"),
    ) as Row[];
    return rows.length === 1;
  },
  async createGuestSlots(requestId, shares) {
    const { error } = await db()
      .from("private_guests")
      .insert(shares.map((cents, i) => ({ request_id: requestId, slot: i + 1, share_cents: cents })));
    if (error && !isUniqueViolation(error)) throw new Error(`Database error: ${error.message}`);
  },
  async listGuests(requestId) {
    return (check(await db().from("private_guests").select("*").eq("request_id", requestId).order("slot")) as Row[]).map(toGuest);
  },
  async getGuest(id) {
    const row = check(await db().from("private_guests").select("*").eq("id", id).maybeSingle()) as Row | null;
    return row ? toGuest(row) : null;
  },
  async claimGuestSlot(requestId, d) {
    return check(
      await db().rpc("claim_guest_slot", {
        p_request_id: requestId,
        p_name: d.name,
        p_email: d.email,
        p_allergies: d.allergies,
        p_dietary: d.dietary,
        p_opt_in: d.messageOptIn,
      }),
    ) as string | null;
  },
  async updateGuestDetails(id, d) {
    check(
      await db()
        .from("private_guests")
        .update({ name: d.name, email: d.email, allergies: d.allergies, dietary: d.dietary, message_opt_in: d.messageOptIn, details_at: new Date().toISOString() })
        .eq("id", id),
    );
  },
  async holdShares(ids, holdKey, until) {
    return check(await db().rpc("hold_shares", { p_ids: ids, p_key: holdKey, p_until: until })) as boolean;
  },

  async addClassPhoto(p) {
    const row = check(await db().from("class_photos").insert({ id: p.id, session_id: p.sessionId, path: p.path, caption: p.caption }).select("*").single()) as Row;
    return toPhoto(row);
  },
  async listClassPhotos(sessionId) {
    return (check(await db().from("class_photos").select("*").eq("session_id", sessionId).order("created_at")) as Row[]).map(toPhoto);
  },
  async getClassPhoto(id) {
    const row = check(await db().from("class_photos").select("*").eq("id", id).maybeSingle()) as Row | null;
    return row ? toPhoto(row) : null;
  },
  async deleteClassPhoto(id) {
    check(await db().from("class_photos").delete().eq("id", id));
  },

  async createPass(p) {
    const row = check(
      await db()
        .from("class_passes")
        .insert({
          id: p.id,
          code_hash: p.codeHash,
          code_last4: p.codeLast4,
          credits_total: p.creditsTotal,
          credits_left: p.creditsLeft,
          status: p.status,
          buyer_name: p.buyerName,
          buyer_email: p.buyerEmail,
          expires_on: p.expiresOn,
        })
        .select("*")
        .single(),
    ) as Row;
    return toPass(row);
  },
  async getPassById(id) {
    const row = check(await db().from("class_passes").select("*").eq("id", id).maybeSingle()) as Row | null;
    return row ? toPass(row) : null;
  },
  async getPassByCodeHash(hash) {
    const row = check(await db().from("class_passes").select("*").eq("code_hash", hash).maybeSingle()) as Row | null;
    return row ? toPass(row) : null;
  },
  async listPasses() {
    return (check(await db().from("class_passes").select("*").order("created_at", { ascending: false }).limit(1000)) as Row[]).map(toPass);
  },
  async redeemPass(codeHash, bookingId, max, today) {
    return check(await db().rpc("redeem_pass", { p_code_hash: codeHash, p_booking: bookingId, p_max: max, p_today: today })) as number;
  },
  async returnPass(bookingId, today) {
    return check(await db().rpc("return_pass", { p_booking: bookingId, p_today: today })) as number;
  },
  async updateBookingPrice(id, p) {
    check(await db().from("class_bookings").update({ discount_cents: p.discountCents, total_cents: p.totalCents }).eq("id", id));
  },
  async markBookingPaidWithoutPayment(id) {
    const rows = check(await db().from("class_bookings").update({ status: "paid" }).eq("id", id).eq("status", "awaiting_payment").select("id")) as Row[];
    return rows.length === 1;
  },
  async markBoxPaidWithoutPayment(id) {
    const rows = check(await db().from("box_orders").update({ status: "paid" }).eq("id", id).eq("status", "awaiting_payment").select("id")) as Row[];
    return rows.length === 1;
  },

  async redeemVoucherFor(kind, codeHash, targetId, maxCents, today) {
    return check(await db().rpc("redeem_voucher_for", { p_kind: kind, p_code_hash: codeHash, p_target: targetId, p_max_cents: maxCents, p_today: today })) as number;
  },
  async returnVoucherFor(kind, targetId, today) {
    const rows = check(await db().rpc("return_voucher_for", { p_kind: kind, p_target: targetId, p_today: today })) as Row[];
    const r = rows?.[0];
    return { amount: (r?.amount as number) ?? 0, toVoucher: (r?.to_voucher as boolean) ?? false };
  },

  async setPaymentIntent(sessionId, intentId) {
    check(await db().from("payments").update({ stripe_payment_intent: intentId }).eq("stripe_session_id", sessionId).is("stripe_payment_intent", null));
  },
  async listPaidPayments(kind, id) {
    return (check(await db().from("payments").select("*").eq(PAYMENT_TARGET_COLUMN[kind], id).eq("status", "paid")) as Row[]).map(toPayment);
  },
  async recordRefund(r) {
    check(
      await db()
        .from("refunds")
        .insert({ payment_id: r.paymentId, amount_cents: r.amountCents, stripe_refund_id: r.stripeRefundId, status: r.status, reason: r.reason.slice(0, 200) }),
    );
    if (r.status === "succeeded") {
      const row = check(await db().from("payments").select("amount_cents,refunded_cents").eq("id", r.paymentId).single()) as Row;
      const next = Math.min(row.amount_cents as number, (row.refunded_cents as number) + r.amountCents);
      check(await db().from("payments").update({ refunded_cents: next }).eq("id", r.paymentId));
    }
  },
  async listRefunds(paymentIds) {
    if (paymentIds.length === 0) return [];
    const rows = check(await db().from("refunds").select("*").in("payment_id", paymentIds).order("created_at")) as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      paymentId: r.payment_id as string,
      amountCents: r.amount_cents as number,
      stripeRefundId: (r.stripe_refund_id as string | null) ?? null,
      status: r.status as RefundRecord["status"],
      reason: (r.reason as string) ?? "",
      createdAt: r.created_at as string,
    }));
  },
  async recordChargeRefunded(eventId, intentId, amountRefunded) {
    return check(await db().rpc("record_charge_refunded", { p_event_id: eventId, p_intent: intentId, p_amount_refunded: amountRefunded })) as boolean;
  },

  async claimStampReward(email, earned, orderId) {
    return check(await db().rpc("claim_stamp_reward", { p_email: email, p_earned: earned, p_order: orderId })) as number;
  },
  async releaseStampReward(orderId) {
    check(await db().from("stamp_rewards").delete().eq("order_id", orderId));
  },
  async countStampRewards(email) {
    const { count, error } = await db().from("stamp_rewards").select("*", { count: "exact", head: true }).eq("email", email.toLowerCase());
    if (error) throw new Error(`Database error: ${error.message}`);
    return count ?? 0;
  },
};

function toPayment(r: Row): Payment {
  return {
    id: r.id as string,
    orderId: (r.order_id as string | null) ?? null,
    boxOrderId: (r.box_order_id as string | null) ?? null,
    voucherId: (r.voucher_id as string | null) ?? null,
    corporateOrderId: (r.corporate_order_id as string | null) ?? null,
    classBookingId: (r.class_booking_id as string | null) ?? null,
    privateRequestId: (r.private_request_id as string | null) ?? null,
    passId: (r.pass_id as string | null) ?? null,
    shareHoldKey: (r.share_hold_key as string | null) ?? null,
    stripePaymentIntent: (r.stripe_payment_intent as string | null) ?? null,
    refundedCents: (r.refunded_cents as number) ?? 0,
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
