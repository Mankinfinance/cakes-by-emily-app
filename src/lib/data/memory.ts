// In-memory adapter for automated tests and local demos. Data lives only in
// this server process and disappears on restart. Never used in production.
// JavaScript runs one task at a time, so each method here is atomic, matching
// the row locks the Supabase adapter relies on.

import { randomUUID } from "node:crypto";
import { summarise } from "../domain/snapshot";
import { todayInBusinessTz } from "../domain/dates";
import type {
  Automation,
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
  ReferralCode,
  Review,
  Order,
  OrderUpdate,
  Payment,
  SeasonalBox,
  SentMessage,
  Voucher,
  WaitlistEntry,
} from "../domain/types";
import { isActiveOffer } from "../domain/waitlist";
import { PAYMENT_HOLD_MINUTES, type MediaFile, type NewOrder, type Repository } from "./repository";
import {
  SAMPLE_AUTOMATIONS,
  SAMPLE_BOXES,
  SAMPLE_CATALOGUE,
  SAMPLE_CLASS_TYPES,
  SAMPLE_CORPORATE,
  SAMPLE_PEAK_DATES,
  SAMPLE_SETTINGS,
} from "./sample-data";

interface Redemption {
  voucherId: string;
  orderId: string;
  amountCents: number;
  note: string;
}

interface Store {
  catalogue: typeof SAMPLE_CATALOGUE;
  settings: typeof SAMPLE_SETTINGS;
  daysOff: { date: string; note: string }[];
  peakDates: typeof SAMPLE_PEAK_DATES;
  orders: Order[];
  payments: Payment[];
  processedEvents: Set<string>;
  updates: OrderUpdate[];
  media: Map<string, MediaFile>;
  automations: Automation[];
  messages: SentMessage[];
  waitlist: WaitlistEntry[];
  boxes: SeasonalBox[];
  boxOrders: BoxOrder[];
  vouchers: Voucher[];
  redemptions: Redemption[];
  corporatePackages: CorporatePackage[];
  corporateOrders: CorporateOrder[];
  reviews: Review[];
  referralCodes: ReferralCode[];
  referrals: Referral[];
  classTypes: ClassType[];
  sessions: ClassSession[];
  bookings: ClassBooking[];
  bookingMessages: { bookingId: string; key: string }[];
  privateRequests: PrivateRequest[];
  guests: PrivateGuest[];
  photos: ClassPhoto[];
  passes: ClassPass[];
  passRedemptions: { passId: string; bookingId: string; credits: number }[];
  targetRedemptions: { voucherId: string; kind: string; targetId: string; amountCents: number }[];
  refunds: RefundRecord[];
  stampRewards: { email: string; n: number; orderId: string }[];
}

function freshStore(): Store {
  return {
    catalogue: structuredClone(SAMPLE_CATALOGUE),
    settings: structuredClone(SAMPLE_SETTINGS),
    daysOff: [],
    peakDates: structuredClone(SAMPLE_PEAK_DATES),
    orders: [],
    payments: [],
    processedEvents: new Set(),
    updates: [],
    media: new Map(),
    automations: structuredClone(SAMPLE_AUTOMATIONS),
    messages: [],
    waitlist: [],
    boxes: structuredClone(SAMPLE_BOXES),
    boxOrders: [],
    vouchers: [],
    redemptions: [],
    corporatePackages: structuredClone(SAMPLE_CORPORATE),
    corporateOrders: [],
    reviews: [],
    referralCodes: [],
    referrals: [],
    classTypes: structuredClone(SAMPLE_CLASS_TYPES),
    sessions: [],
    bookings: [],
    bookingMessages: [],
    privateRequests: [],
    guests: [],
    photos: [],
    passes: [],
    passRedemptions: [],
    targetRedemptions: [],
    refunds: [],
    stampRewards: [],
  };
}

const g = globalThis as unknown as { __cakesMemoryStore?: Store };

function store(): Store {
  g.__cakesMemoryStore ??= freshStore();
  return g.__cakesMemoryStore;
}

/** Test helper: wipe everything back to the sample data. */
export function resetMemoryStore(): void {
  g.__cakesMemoryStore = freshStore();
}

export function getMemoryMedia(path: string): MediaFile | undefined {
  return store().media.get(path);
}

/** Test helper: change creation times to simulate old unpaid orders. */
export function backdateMemoryRecord(kind: "order" | "box" | "corporate" | "booking", id: string, createdAt: string): void {
  const s = store();
  const list: { id: string; createdAt: string }[] =
    kind === "order" ? s.orders : kind === "box" ? s.boxOrders : kind === "corporate" ? s.corporateOrders : s.bookings;
  const rec = list.find((x) => x.id === id);
  if (rec) rec.createdAt = createdAt;
  if (kind === "order") for (const p of s.payments) if (p.orderId === id) p.createdAt = createdAt;
}

const clone = <T>(v: T): T => structuredClone(v);

/** Creation times that never tie, so "first come, first served" is well defined in tests. */
let lastStamp = 0;
function stamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}
const byCreated = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt);

export const memoryRepository: Repository = {
  async listCatalogue() {
    return clone(store().catalogue);
  },
  async updateCatalogueItem(id, patch) {
    const item = store().catalogue.find((i) => i.id === id);
    if (item) Object.assign(item, patch);
  },
  async createCatalogueItem(item) {
    store().catalogue.push(clone(item));
  },
  async getSettings() {
    return clone(store().settings);
  },
  async saveSettings(settings) {
    store().settings = clone(settings);
  },
  async listDaysOff() {
    return clone(store().daysOff).sort((a, b) => a.date.localeCompare(b.date));
  },
  async addDayOff(day) {
    const s = store();
    s.daysOff = s.daysOff.filter((d) => d.date !== day.date).concat(day);
  },
  async removeDayOff(date) {
    const s = store();
    s.daysOff = s.daysOff.filter((d) => d.date !== date);
  },
  async listPeakDates() {
    return clone(store().peakDates).sort((a, b) => a.date.localeCompare(b.date));
  },
  async upsertPeakDate(peak) {
    const s = store();
    s.peakDates = s.peakDates.filter((p) => p.date !== peak.date).concat(peak);
  },
  async removePeakDate(date) {
    const s = store();
    s.peakDates = s.peakDates.filter((p) => p.date !== date);
  },

  async listActiveBookings(fromDate, toDate, query) {
    const now = new Date();
    const holdSince = new Date(now.getTime() - PAYMENT_HOLD_MINUTES * 60_000).toISOString();
    const orders = store()
      .orders.filter(
        (o) =>
          o.id !== query?.excludeOrderId &&
          o.stage !== "cancelled" &&
          (o.stage !== "awaiting_payment" || o.createdAt >= holdSince) &&
          o.pickupDate >= fromDate &&
          o.pickupDate <= toDate,
      )
      .map((o) => ({ pickupDate: o.pickupDate, pickupSlot: o.pickupSlot }));
    const offers = store()
      .waitlist.filter((w) => !w.sessionId && w.id !== query?.excludeWaitlistId && isActiveOffer(w, now) && w.date >= fromDate && w.date <= toDate)
      .map((w) => ({ pickupDate: w.date, pickupSlot: "" }));
    const corporate = store()
      .corporateOrders.filter(
        (o) => o.status !== "cancelled" && (o.status !== "awaiting_payment" || o.createdAt >= holdSince) && o.pickupDate >= fromDate && o.pickupDate <= toDate,
      )
      .map((o) => ({ pickupDate: o.pickupDate, pickupSlot: o.pickupSlot }));
    return [...orders, ...offers, ...corporate];
  },
  async createOrder(input: NewOrder) {
    const order: Order = {
      ...clone(input),
      createdAt: new Date().toISOString(),
      remindersSent: [],
      amountPaidCents: 0,
      dateChangesUsed: 0,
      designChangesUsed: 0,
      approvedAt: null,
      voucherId: null,
      voucherAppliedCents: 0,
      kitchenDone: false,
      cancellation: null,
    };
    store().orders.push(order);
    return clone(order);
  },
  async getOrderById(id) {
    const o = store().orders.find((x) => x.id === id);
    return o ? clone(o) : null;
  },
  async getOrderByTokenHash(tokenHash) {
    const o = store().orders.find((x) => x.tokenHash === tokenHash);
    return o ? clone(o) : null;
  },
  async listOrders(opts) {
    return clone(
      store()
        .orders.filter((o) => opts?.includeUnpaid || o.stage !== "awaiting_payment")
        .sort((a, b) => (a.pickupDate + a.pickupSlot).localeCompare(b.pickupDate + b.pickupSlot)),
    );
  },
  async listStaleUnpaidOrders(before) {
    return clone(store().orders.filter((o) => o.stage === "awaiting_payment" && o.createdAt < before));
  },
  async setStage(id, stage) {
    const o = store().orders.find((x) => x.id === id);
    if (o) o.stage = stage;
  },
  async updateOrder(id, patch) {
    const o = store().orders.find((x) => x.id === id);
    if (o) Object.assign(o, clone(patch));
  },
  async cancelOrderOnce(id, record, onlyUnpaid) {
    const o = store().orders.find((x) => x.id === id);
    if (!o || o.stage === "cancelled" || o.stage === "collected") return false;
    if (onlyUnpaid && o.stage !== "awaiting_payment") return false;
    o.stage = "cancelled";
    o.cancellation = clone(record);
    return true;
  },
  async markReminderSent(id, key) {
    const o = store().orders.find((x) => x.id === id);
    if (o && !o.remindersSent.includes(key)) o.remindersSent.push(key);
  },

  async createPayment(p) {
    const payment: Payment = { refundedCents: 0, stripePaymentIntent: null, ...p, id: randomUUID(), status: "pending", createdAt: stamp() };
    store().payments.push(payment);
    return clone(payment);
  },
  async getPaymentBySession(sessionId) {
    const p = store().payments.find((x) => x.stripeSessionId === sessionId);
    return p ? clone(p) : null;
  },
  async recordPaymentOnce(eventId, sessionId) {
    const s = store();
    if (s.processedEvents.has(eventId)) return false;
    s.processedEvents.add(eventId);
    const payment = s.payments.find((x) => x.stripeSessionId === sessionId);
    if (!payment || payment.status === "paid") return false;
    payment.status = "paid";
    if (payment.orderId) {
      const order = s.orders.find((o) => o.id === payment.orderId);
      if (order) {
        order.amountPaidCents += payment.amountCents;
        if (order.stage === "awaiting_payment") order.stage = "received";
      }
    } else if (payment.boxOrderId) {
      const bo = s.boxOrders.find((o) => o.id === payment.boxOrderId);
      if (bo) {
        bo.amountPaidCents += payment.amountCents;
        if (bo.status === "awaiting_payment") bo.status = "paid";
      }
    } else if (payment.voucherId) {
      const v = s.vouchers.find((x) => x.id === payment.voucherId);
      if (v && v.status === "pending") {
        v.status = "active";
        v.balanceCents = v.amountCents;
      }
    } else if (payment.corporateOrderId) {
      const c = s.corporateOrders.find((x) => x.id === payment.corporateOrderId);
      if (c) {
        c.amountPaidCents += payment.amountCents;
        if (c.status === "awaiting_payment") c.status = "confirmed";
      }
    } else if (payment.classBookingId) {
      const b = s.bookings.find((x) => x.id === payment.classBookingId);
      if (b) {
        b.amountPaidCents += payment.amountCents;
        if (b.status === "awaiting_payment") b.status = "paid";
      }
    } else if (payment.privateRequestId) {
      const r = s.privateRequests.find((x) => x.id === payment.privateRequestId);
      if (r) {
        r.amountPaidCents += payment.amountCents;
        if (r.status === "accepted" && payment.kind === "private_deposit") r.status = "paid";
      }
      if (payment.kind === "private_share" && payment.shareHoldKey) {
        for (const g of s.guests) {
          if (g.requestId === payment.privateRequestId && g.holdKey === payment.shareHoldKey && g.status === "open") {
            g.status = "paid";
            g.paidAt = new Date().toISOString();
          }
        }
      }
    } else if (payment.passId) {
      const pass = s.passes.find((x) => x.id === payment.passId);
      if (pass && pass.status === "pending") {
        pass.status = "active";
        pass.creditsLeft = pass.creditsTotal;
      }
    }
    return true;
  },

  async addUpdate(u) {
    const update: OrderUpdate = { ...u, id: randomUUID(), createdAt: new Date().toISOString() };
    store().updates.push(update);
    return clone(update);
  },
  async listUpdates(orderId) {
    return clone(
      store()
        .updates.filter((u) => u.orderId === orderId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  },
  async uploadMedia(path, file) {
    store().media.set(path, { bytes: new Uint8Array(file.bytes), contentType: file.contentType });
  },
  async mediaUrl(path) {
    return store().media.has(path) ? `/api/test-media?path=${encodeURIComponent(path)}` : null;
  },
  async createUploadTarget(path, contentType) {
    return { kind: "local", url: `/api/test-upload?path=${encodeURIComponent(path)}&type=${encodeURIComponent(contentType)}` };
  },
  async readMediaHead(path, length) {
    const f = store().media.get(path);
    return f ? { bytes: f.bytes.slice(0, length), contentType: f.contentType } : null;
  },
  async deleteMedia(path) {
    store().media.delete(path);
  },

  async listAutomations() {
    return clone(store().automations);
  },
  async saveAutomation(a) {
    const s = store();
    s.automations = s.automations.filter((x) => x.key !== a.key).concat(clone(a));
  },
  async claimMessage(orderId, key) {
    const s = store();
    if (s.messages.some((m) => m.orderId === orderId && m.key === key)) return false;
    s.messages.push({ orderId, key, sentAt: new Date().toISOString() });
    return true;
  },
  async releaseMessage(orderId, key) {
    const s = store();
    s.messages = s.messages.filter((m) => !(m.orderId === orderId && m.key === key));
  },
  async listMessages(orderId) {
    return clone(store().messages.filter((m) => m.orderId === orderId));
  },

  async addWaitlist(entry) {
    const w: WaitlistEntry = {
      sessionId: null,
      seats: 1,
      ...clone(entry),
      id: randomUUID(),
      status: "waiting",
      offerTokenHash: null,
      offeredAt: null,
      offerExpiresAt: null,
      orderId: null,
      createdAt: stamp(),
    };
    store().waitlist.push(w);
    return clone(w);
  },
  async listWaitlist(opts) {
    return clone(
      store()
        .waitlist.filter(
          (w) =>
            (opts?.all || (opts?.sessionId ? w.sessionId === opts.sessionId : !w.sessionId)) &&
            (!opts?.date || w.date === opts.date) &&
            (!opts?.fromDate || w.date >= opts.fromDate),
        )
        .sort((a, b) => a.date.localeCompare(b.date) || byCreated(a, b)),
    );
  },
  async getWaitlistById(id) {
    const w = store().waitlist.find((x) => x.id === id);
    return w ? clone(w) : null;
  },
  async getWaitlistByOfferHash(hash) {
    const w = store().waitlist.find((x) => x.offerTokenHash === hash);
    return w ? clone(w) : null;
  },
  async offerWaitlist(id, tokenHash, offeredAt, expiresAt) {
    const s = store();
    const w = s.waitlist.find((x) => x.id === id);
    if (!w || w.status !== "waiting") return false;
    if (s.waitlist.some((x) => x.date === w.date && (x.sessionId ?? null) === (w.sessionId ?? null) && x.status === "offered")) return false;
    Object.assign(w, { status: "offered", offerTokenHash: tokenHash, offeredAt, offerExpiresAt: expiresAt });
    return true;
  },
  async claimWaitlist(id, orderId, now) {
    const w = store().waitlist.find((x) => x.id === id);
    if (!w || w.status !== "offered" || !w.offerExpiresAt || w.offerExpiresAt <= now) return false;
    Object.assign(w, { status: "claimed", orderId });
    return true;
  },
  async setWaitlistStatus(id, status) {
    const w = store().waitlist.find((x) => x.id === id);
    if (w) w.status = status;
  },

  async listBoxes() {
    return clone(store().boxes).sort((a, b) => a.sort - b.sort);
  },
  async getBox(id) {
    const b = store().boxes.find((x) => x.id === id);
    return b ? clone(b) : null;
  },
  async createBox(box) {
    store().boxes.push(clone(box));
  },
  async updateBox(id, patch) {
    const b = store().boxes.find((x) => x.id === id);
    if (b) Object.assign(b, clone(patch));
  },
  async reserveBoxStock(boxId, quantity, today) {
    const b = store().boxes.find((x) => x.id === boxId);
    if (!b || quantity < 1 || !b.visible || b.opensOn > today || b.closesOn < today || b.sold + quantity > b.cap) return false;
    b.sold += quantity;
    return true;
  },
  async createBoxOrder(input) {
    const o: BoxOrder = { voucherId: null, voucherAppliedCents: 0, ...clone(input), amountPaidCents: 0, status: "awaiting_payment", kitchenDone: false, createdAt: new Date().toISOString() };
    store().boxOrders.push(o);
    return clone(o);
  },
  async getBoxOrderById(id) {
    const o = store().boxOrders.find((x) => x.id === id);
    return o ? clone(o) : null;
  },
  async getBoxOrderByTokenHash(tokenHash) {
    const o = store().boxOrders.find((x) => x.tokenHash === tokenHash);
    return o ? clone(o) : null;
  },
  async listBoxOrders(opts) {
    return clone(
      store()
        .boxOrders.filter((o) => opts?.includeUnpaid || o.status !== "awaiting_payment")
        .sort((a, b) => (a.pickupDate + a.pickupSlot).localeCompare(b.pickupDate + b.pickupSlot)),
    );
  },
  async listStaleUnpaidBoxOrders(before) {
    return clone(store().boxOrders.filter((o) => o.status === "awaiting_payment" && o.createdAt < before));
  },
  async cancelBoxOrder(id, onlyUnpaid) {
    const s = store();
    const o = s.boxOrders.find((x) => x.id === id);
    if (!o || (o.status !== "awaiting_payment" && o.status !== "paid")) return false;
    if (onlyUnpaid && o.status !== "awaiting_payment") return false;
    o.status = "cancelled";
    const b = s.boxes.find((x) => x.id === o.boxId);
    if (b) b.sold = Math.max(0, b.sold - o.quantity);
    return true;
  },
  async updateBoxOrder(id, patch) {
    const o = store().boxOrders.find((x) => x.id === id);
    if (o) Object.assign(o, clone(patch));
  },

  async createVoucher(input) {
    const s = store();
    if (s.vouchers.some((v) => v.codeHash === input.codeHash)) throw new Error("Duplicate voucher code");
    const v: Voucher = { ...clone(input), createdAt: new Date().toISOString() };
    s.vouchers.push(v);
    return clone(v);
  },
  async getVoucherById(id) {
    const v = store().vouchers.find((x) => x.id === id);
    return v ? clone(v) : null;
  },
  async getVoucherByCodeHash(hash) {
    const v = store().vouchers.find((x) => x.codeHash === hash);
    return v ? clone(v) : null;
  },
  async listVouchers() {
    return clone(store().vouchers).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async setVoucherStatus(id, status) {
    const v = store().vouchers.find((x) => x.id === id);
    if (v) v.status = status;
  },
  async redeemVoucher(codeHash, orderId, maxCents, today) {
    const s = store();
    if (maxCents <= 0) return 0;
    const v = s.vouchers.find((x) => x.codeHash === codeHash);
    const order = s.orders.find((o) => o.id === orderId);
    if (!v || !order || v.status !== "active" || v.expiresOn < today || v.balanceCents <= 0 || order.voucherId) return 0;
    const amount = Math.min(v.balanceCents, maxCents);
    v.balanceCents -= amount;
    s.redemptions.push({ voucherId: v.id, orderId, amountCents: amount, note: "used" });
    order.voucherId = v.id;
    order.voucherAppliedCents = amount;
    return amount;
  },
  async returnVoucher(orderId, today) {
    const s = store();
    const order = s.orders.find((o) => o.id === orderId);
    if (!order?.voucherId) return { amount: 0, toVoucher: false };
    const net = s.redemptions
      .filter((r) => r.orderId === orderId && r.voucherId === order.voucherId)
      .reduce((sum, r) => sum + r.amountCents, 0);
    if (net <= 0) return { amount: 0, toVoucher: false };
    const v = s.vouchers.find((x) => x.id === order.voucherId)!;
    if (v.status === "active" && v.expiresOn >= today) {
      v.balanceCents = Math.min(v.amountCents, v.balanceCents + net);
      s.redemptions.push({ voucherId: v.id, orderId, amountCents: -net, note: "returned" });
      return { amount: net, toVoucher: true };
    }
    s.redemptions.push({ voucherId: v.id, orderId, amountCents: -net, note: "reissued as new credit" });
    return { amount: net, toVoucher: false };
  },

  async listOrdersByEmail(email) {
    return clone(store().orders.filter((o) => o.email.toLowerCase() === email.toLowerCase()));
  },

  async listCorporatePackages() {
    return clone(store().corporatePackages).sort((a, b) => a.sort - b.sort);
  },
  async updateCorporatePackage(id, patch) {
    const p = store().corporatePackages.find((x) => x.id === id);
    if (p) Object.assign(p, clone(patch));
  },
  async createCorporateOrder(input) {
    const o: CorporateOrder = { voucherId: null, voucherAppliedCents: 0, ...clone(input), amountPaidCents: 0, status: "awaiting_payment", kitchenDone: false, createdAt: new Date().toISOString() };
    store().corporateOrders.push(o);
    return clone(o);
  },
  async getCorporateOrderById(id) {
    const o = store().corporateOrders.find((x) => x.id === id);
    return o ? clone(o) : null;
  },
  async getCorporateOrderByTokenHash(tokenHash) {
    const o = store().corporateOrders.find((x) => x.tokenHash === tokenHash);
    return o ? clone(o) : null;
  },
  async listCorporateOrders(opts) {
    return clone(
      store()
        .corporateOrders.filter((o) => opts?.includeUnpaid || o.status !== "awaiting_payment")
        .sort((a, b) => (a.pickupDate + a.pickupSlot).localeCompare(b.pickupDate + b.pickupSlot)),
    );
  },
  async listStaleUnpaidCorporate(before) {
    return clone(store().corporateOrders.filter((o) => o.status === "awaiting_payment" && o.createdAt < before));
  },
  async setCorporateStatus(id, status, from) {
    const o = store().corporateOrders.find((x) => x.id === id);
    if (!o || !from.includes(o.status)) return false;
    o.status = status;
    return true;
  },
  async setCorporateKitchenDone(id, done) {
    const o = store().corporateOrders.find((x) => x.id === id);
    if (o) o.kitchenDone = done;
  },

  async createReview(r) {
    const s = store();
    if (s.reviews.some((x) => x.orderId === r.orderId)) return null;
    const review: Review = { ...clone(r), id: randomUUID(), status: "pending", createdAt: new Date().toISOString() };
    s.reviews.push(review);
    return clone(review);
  },
  async getReviewByOrder(orderId) {
    const r = store().reviews.find((x) => x.orderId === orderId);
    return r ? clone(r) : null;
  },
  async listReviews(opts) {
    return clone(store().reviews.filter((r) => !opts?.status || r.status === opts.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async setReviewStatus(id, status) {
    const r = store().reviews.find((x) => x.id === id);
    if (!r) return;
    if (status === "approved" && !r.consentToPublish) throw new Error("This review can't be published without the customer's consent.");
    r.status = status;
  },

  async getReferralCodeByEmail(email) {
    const c = store().referralCodes.find((x) => x.email === email.toLowerCase());
    return c ? clone(c) : null;
  },
  async getReferralCode(code) {
    const c = store().referralCodes.find((x) => x.code === code);
    return c ? clone(c) : null;
  },
  async createReferralCode(code, email) {
    const s = store();
    if (s.referralCodes.some((x) => x.code === code || x.email === email.toLowerCase())) return false;
    s.referralCodes.push({ code, email: email.toLowerCase(), createdAt: new Date().toISOString() });
    return true;
  },
  async createReferral(r) {
    const s = store();
    if (r.referrerEmail.toLowerCase() === r.referredEmail.toLowerCase()) return false;
    if (s.referrals.some((x) => x.orderId === r.orderId || (x.status !== "void" && x.referredEmail.toLowerCase() === r.referredEmail.toLowerCase()))) return false;
    s.referrals.push({ ...clone(r), id: randomUUID(), status: "pending", createdAt: new Date().toISOString() });
    return true;
  },
  async listReferrals() {
    return clone(store().referrals).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async rewardReferralOnce(orderId) {
    const r = store().referrals.find((x) => x.orderId === orderId && x.status === "pending");
    if (!r) return null;
    r.status = "rewarded";
    return clone(r);
  },
  async voidReferral(orderId) {
    const r = store().referrals.find((x) => x.orderId === orderId && x.status === "pending");
    if (r) r.status = "void";
  },

  async listClassTypes() {
    return clone(store().classTypes).sort((a, b) => a.sort - b.sort);
  },
  async updateClassType(id, patch) {
    const t = store().classTypes.find((x) => x.id === id);
    if (t) Object.assign(t, clone(patch));
  },
  async listSessions(opts) {
    return clone(
      store()
        .sessions.filter((x) => (opts?.includeCancelled || x.status === "scheduled") && (!opts?.fromDate || x.date >= opts.fromDate))
        .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime)),
    );
  },
  async getSession(id) {
    const x = store().sessions.find((y) => y.id === id);
    return x ? clone(x) : null;
  },
  async createSession(input) {
    const x: ClassSession = { ...clone(input), booked: 0, createdAt: new Date().toISOString() };
    store().sessions.push(x);
    return clone(x);
  },
  async updateSession(id, patch) {
    const x = store().sessions.find((y) => y.id === id);
    if (!x) return;
    if (patch.seats !== undefined && patch.seats < x.booked) throw new Error("Seats can't go below the number already booked.");
    Object.assign(x, clone(patch));
  },
  async reserveSeats(sessionId, seats) {
    const x = store().sessions.find((y) => y.id === sessionId);
    if (!x || seats < 1 || x.status !== "scheduled" || x.booked + seats > x.seats) return false;
    x.booked += seats;
    return true;
  },
  async releaseSeats(sessionId, seats) {
    const x = store().sessions.find((y) => y.id === sessionId);
    if (x) x.booked = Math.max(0, x.booked - seats);
  },
  async createBooking(input) {
    const b: ClassBooking = {
      passId: null,
      passCredits: 0,
      voucherId: null,
      voucherAppliedCents: 0,
      ...clone(input),
      amountPaidCents: 0,
      status: "awaiting_payment",
      cancellation: null,
      createdAt: new Date().toISOString(),
    };
    store().bookings.push(b);
    return clone(b);
  },
  async getBookingById(id) {
    const b = store().bookings.find((x) => x.id === id);
    return b ? clone(b) : null;
  },
  async getBookingByTokenHash(tokenHash) {
    const b = store().bookings.find((x) => x.tokenHash === tokenHash);
    return b ? clone(b) : null;
  },
  async listBookings(opts) {
    return clone(
      store()
        .bookings.filter((b) => (!opts?.sessionId || b.sessionId === opts.sessionId) && (opts?.includeUnpaid || b.status !== "awaiting_payment"))
        .sort(byCreated),
    );
  },
  async listStaleUnpaidBookings(before) {
    return clone(store().bookings.filter((b) => b.status === "awaiting_payment" && b.createdAt < before));
  },
  async updateBookingGuests(id, guests) {
    const b = store().bookings.find((x) => x.id === id);
    if (b) b.guests = clone(guests);
  },
  async cancelBookingOnce(id, onlyUnpaid, record) {
    const s = store();
    const b = s.bookings.find((x) => x.id === id);
    if (!b || (b.status !== "awaiting_payment" && b.status !== "paid")) return false;
    if (onlyUnpaid && b.status !== "awaiting_payment") return false;
    b.status = "cancelled";
    b.cancellation = clone(record);
    const x = s.sessions.find((y) => y.id === b.sessionId);
    if (x) x.booked = Math.max(0, x.booked - b.seats);
    return true;
  },
  async setBookingCancellation(id, record) {
    const b = store().bookings.find((x) => x.id === id);
    if (b) b.cancellation = clone(record);
  },
  async claimBookingMessage(bookingId, key) {
    const s = store();
    if (s.bookingMessages.some((m) => m.bookingId === bookingId && m.key === key)) return false;
    s.bookingMessages.push({ bookingId, key });
    return true;
  },
  async releaseBookingMessage(bookingId, key) {
    const s = store();
    s.bookingMessages = s.bookingMessages.filter((m) => !(m.bookingId === bookingId && m.key === key));
  },
  async createPrivateRequest(input) {
    const r: PrivateRequest = {
      ...clone(input),
      status: "requested",
      payTokenHash: null,
      amountPaidCents: 0,
      createdAt: new Date().toISOString(),
      shareTokenHash: null,
      lastNudgeAt: null,
      cancellation: null,
    };
    store().privateRequests.push(r);
    return clone(r);
  },
  async getPrivateRequest(id) {
    const r = store().privateRequests.find((x) => x.id === id);
    return r ? clone(r) : null;
  },
  async getPrivateRequestByPayHash(hash) {
    const r = store().privateRequests.find((x) => x.payTokenHash === hash);
    return r ? clone(r) : null;
  },
  async listPrivateRequests() {
    return clone(store().privateRequests).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async setPrivateStatus(id, status, from, payTokenHash) {
    const r = store().privateRequests.find((x) => x.id === id);
    if (!r || r.status !== from) return false;
    r.status = status;
    if (payTokenHash) r.payTokenHash = payTokenHash;
    return true;
  },

  async salesSummary(from, to) {
    const s = store();
    return summarise(s.orders, s.payments, from, to, (iso) => todayInBusinessTz(new Date(iso)));
  },

  // Phase 4 -----------------------------------------------------------------
  async setPrivateShareToken(id, tokenHash) {
    const r = store().privateRequests.find((x) => x.id === id);
    if (!r || r.shareTokenHash) return false;
    r.shareTokenHash = tokenHash;
    return true;
  },
  async getPrivateRequestByShareHash(hash) {
    const r = store().privateRequests.find((x) => x.shareTokenHash === hash);
    return r ? clone(r) : null;
  },
  async claimNudge(id, before, now) {
    const r = store().privateRequests.find((x) => x.id === id);
    if (!r || (r.lastNudgeAt && r.lastNudgeAt > before)) return false;
    r.lastNudgeAt = now;
    return true;
  },
  async cancelPrivateOnce(id, record) {
    const r = store().privateRequests.find((x) => x.id === id);
    if (!r || r.status === "cancelled" || r.status === "declined") return false;
    r.status = "cancelled";
    r.cancellation = clone(record);
    return true;
  },
  async createGuestSlots(requestId, shares) {
    const s = store();
    if (s.guests.some((g) => g.requestId === requestId)) return;
    shares.forEach((cents, i) =>
      s.guests.push({
        id: randomUUID(),
        requestId,
        slot: i + 1,
        name: "",
        email: "",
        allergies: "",
        dietary: [],
        messageOptIn: false,
        shareCents: cents,
        status: "open",
        holdKey: null,
        holdUntil: null,
        paidAt: null,
        detailsAt: null,
      }),
    );
  },
  async listGuests(requestId) {
    return clone(store().guests.filter((g) => g.requestId === requestId)).sort((a, b) => a.slot - b.slot);
  },
  async getGuest(id) {
    const g = store().guests.find((x) => x.id === id);
    return g ? clone(g) : null;
  },
  async claimGuestSlot(requestId, d) {
    const g = store()
      .guests.filter((x) => x.requestId === requestId && !x.name)
      .sort((a, b) => a.slot - b.slot)[0];
    if (!g) return null;
    Object.assign(g, clone(d), { detailsAt: new Date().toISOString() });
    return g.id;
  },
  async updateGuestDetails(id, d) {
    const g = store().guests.find((x) => x.id === id);
    if (g) Object.assign(g, clone(d), { detailsAt: new Date().toISOString() });
  },
  async holdShares(ids, holdKey, until) {
    const now = new Date().toISOString();
    const list = store().guests.filter((g) => ids.includes(g.id));
    if (list.length === 0 || list.length !== new Set(ids).size) return false;
    if (!list.every((g) => g.status === "open" && (!g.holdKey || !g.holdUntil || g.holdUntil <= now))) return false;
    for (const g of list) Object.assign(g, { holdKey, holdUntil: until });
    return true;
  },

  async addClassPhoto(p) {
    const photo: ClassPhoto = { ...clone(p), createdAt: stamp() };
    store().photos.push(photo);
    return clone(photo);
  },
  async listClassPhotos(sessionId) {
    return clone(store().photos.filter((p) => p.sessionId === sessionId)).sort(byCreated);
  },
  async getClassPhoto(id) {
    const p = store().photos.find((x) => x.id === id);
    return p ? clone(p) : null;
  },
  async deleteClassPhoto(id) {
    const s = store();
    s.photos = s.photos.filter((p) => p.id !== id);
  },

  async createPass(p) {
    const s = store();
    if (s.passes.some((x) => x.codeHash === p.codeHash)) throw new Error("Duplicate pass code");
    const pass: ClassPass = { ...clone(p), createdAt: new Date().toISOString() };
    s.passes.push(pass);
    return clone(pass);
  },
  async getPassById(id) {
    const p = store().passes.find((x) => x.id === id);
    return p ? clone(p) : null;
  },
  async getPassByCodeHash(hash) {
    const p = store().passes.find((x) => x.codeHash === hash);
    return p ? clone(p) : null;
  },
  async listPasses() {
    return clone(store().passes).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async redeemPass(codeHash, bookingId, max, today) {
    const s = store();
    if (max <= 0) return 0;
    const p = s.passes.find((x) => x.codeHash === codeHash);
    const b = s.bookings.find((x) => x.id === bookingId);
    if (!p || !b || p.status !== "active" || p.expiresOn < today || p.creditsLeft <= 0 || b.passId) return 0;
    const n = Math.min(p.creditsLeft, max);
    p.creditsLeft -= n;
    s.passRedemptions.push({ passId: p.id, bookingId, credits: n });
    b.passId = p.id;
    b.passCredits = n;
    return n;
  },
  async returnPass(bookingId, today) {
    const s = store();
    const b = s.bookings.find((x) => x.id === bookingId);
    if (!b?.passId) return 0;
    const net = s.passRedemptions.filter((r) => r.bookingId === bookingId && r.passId === b.passId).reduce((sum, r) => sum + r.credits, 0);
    if (net <= 0) return 0;
    const p = s.passes.find((x) => x.id === b.passId)!;
    p.creditsLeft = Math.min(p.creditsTotal, p.creditsLeft + net);
    const extended = new Date(`${today}T00:00:00Z`);
    extended.setUTCDate(extended.getUTCDate() + 90);
    const ext = extended.toISOString().slice(0, 10);
    if (p.expiresOn < ext) p.expiresOn = ext;
    s.passRedemptions.push({ passId: p.id, bookingId, credits: -net });
    return net;
  },
  async updateBookingPrice(id, p) {
    const b = store().bookings.find((x) => x.id === id);
    if (b) Object.assign(b, p);
  },
  async markBookingPaidWithoutPayment(id) {
    const b = store().bookings.find((x) => x.id === id);
    if (!b || b.status !== "awaiting_payment") return false;
    b.status = "paid";
    return true;
  },
  async markBoxPaidWithoutPayment(id) {
    const b = store().boxOrders.find((x) => x.id === id);
    if (!b || b.status !== "awaiting_payment") return false;
    b.status = "paid";
    return true;
  },

  async redeemVoucherFor(kind, codeHash, targetId, maxCents, today) {
    const s = store();
    if (maxCents <= 0) return 0;
    const v = s.vouchers.find((x) => x.codeHash === codeHash);
    const target: { voucherId?: string | null; voucherAppliedCents?: number } | undefined =
      kind === "box" ? s.boxOrders.find((x) => x.id === targetId) : kind === "corporate" ? s.corporateOrders.find((x) => x.id === targetId) : s.bookings.find((x) => x.id === targetId);
    if (!v || !target || v.status !== "active" || v.expiresOn < today || v.balanceCents <= 0 || target.voucherId) return 0;
    const amount = Math.min(v.balanceCents, maxCents);
    v.balanceCents -= amount;
    s.targetRedemptions.push({ voucherId: v.id, kind, targetId, amountCents: amount });
    target.voucherId = v.id;
    target.voucherAppliedCents = amount;
    return amount;
  },
  async returnVoucherFor(kind, targetId, today) {
    const s = store();
    const target = kind === "box" ? s.boxOrders.find((x) => x.id === targetId) : kind === "corporate" ? s.corporateOrders.find((x) => x.id === targetId) : s.bookings.find((x) => x.id === targetId);
    if (!target?.voucherId) return { amount: 0, toVoucher: false };
    const net = s.targetRedemptions.filter((r) => r.kind === kind && r.targetId === targetId && r.voucherId === target.voucherId).reduce((sum, r) => sum + r.amountCents, 0);
    if (net <= 0) return { amount: 0, toVoucher: false };
    const v = s.vouchers.find((x) => x.id === target.voucherId)!;
    const ok = v.status === "active" && v.expiresOn >= today;
    if (ok) v.balanceCents = Math.min(v.amountCents, v.balanceCents + net);
    s.targetRedemptions.push({ voucherId: v.id, kind, targetId, amountCents: -net });
    return { amount: net, toVoucher: ok };
  },

  async setPaymentIntent(sessionId, intentId) {
    const p = store().payments.find((x) => x.stripeSessionId === sessionId);
    if (p && !p.stripePaymentIntent) p.stripePaymentIntent = intentId;
  },
  async listPaidPayments(kind, id) {
    const key = ({ order: "orderId", box: "boxOrderId", corporate: "corporateOrderId", booking: "classBookingId", private: "privateRequestId" } as const)[kind];
    return clone(store().payments.filter((p) => p.status === "paid" && p[key] === id));
  },
  async recordRefund(r) {
    const s = store();
    s.refunds.push({ ...clone(r), id: randomUUID(), createdAt: new Date().toISOString() });
    if (r.status === "succeeded") {
      const p = s.payments.find((x) => x.id === r.paymentId);
      if (p) p.refundedCents = Math.min(p.amountCents, (p.refundedCents ?? 0) + r.amountCents);
    }
  },
  async listRefunds(paymentIds) {
    return clone(store().refunds.filter((r) => paymentIds.includes(r.paymentId)));
  },
  async recordChargeRefunded(eventId, intentId, amountRefunded) {
    const s = store();
    if (s.processedEvents.has(eventId)) return false;
    s.processedEvents.add(eventId);
    const list = s.payments.filter((p) => p.stripePaymentIntent === intentId);
    for (const p of list) p.refundedCents = Math.min(p.amountCents, Math.max(p.refundedCents ?? 0, amountRefunded));
    return list.length > 0;
  },

  async claimStampReward(email, earned, orderId) {
    const s = store();
    const e = email.toLowerCase();
    if (s.stampRewards.some((r) => r.orderId === orderId)) return 0;
    for (let n = 1; n <= earned; n++) {
      if (!s.stampRewards.some((r) => r.email === e && r.n === n)) {
        s.stampRewards.push({ email: e, n, orderId });
        return n;
      }
    }
    return 0;
  },
  async releaseStampReward(orderId) {
    const s = store();
    s.stampRewards = s.stampRewards.filter((r) => r.orderId !== orderId);
  },
  async countStampRewards(email) {
    return store().stampRewards.filter((r) => r.email === email.toLowerCase()).length;
  },
};
