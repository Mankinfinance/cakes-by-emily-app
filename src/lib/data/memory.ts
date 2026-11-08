// In-memory adapter for automated tests and local demos. Data lives only in
// this server process and disappears on restart. Never used in production.
// JavaScript runs one task at a time, so each method here is atomic, matching
// the row locks the Supabase adapter relies on.

import { randomUUID } from "node:crypto";
import type {
  Automation,
  BoxOrder,
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
import { SAMPLE_AUTOMATIONS, SAMPLE_BOXES, SAMPLE_CATALOGUE, SAMPLE_PEAK_DATES, SAMPLE_SETTINGS } from "./sample-data";

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
export function backdateMemoryRecord(kind: "order" | "box", id: string, createdAt: string): void {
  const list = kind === "order" ? store().orders : store().boxOrders;
  const rec = list.find((x) => x.id === id);
  if (rec) rec.createdAt = createdAt;
}

const clone = <T>(v: T): T => structuredClone(v);
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
      .waitlist.filter((w) => w.id !== query?.excludeWaitlistId && isActiveOffer(w, now) && w.date >= fromDate && w.date <= toDate)
      .map((w) => ({ pickupDate: w.date, pickupSlot: "" }));
    return [...orders, ...offers];
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
    const payment: Payment = { ...p, id: randomUUID(), status: "pending", createdAt: new Date().toISOString() };
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
      ...clone(entry),
      id: randomUUID(),
      status: "waiting",
      offerTokenHash: null,
      offeredAt: null,
      offerExpiresAt: null,
      orderId: null,
      createdAt: new Date().toISOString(),
    };
    store().waitlist.push(w);
    return clone(w);
  },
  async listWaitlist(opts) {
    return clone(
      store()
        .waitlist.filter((w) => (!opts?.date || w.date === opts.date) && (!opts?.fromDate || w.date >= opts.fromDate))
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
    if (s.waitlist.some((x) => x.date === w.date && x.status === "offered")) return false;
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
    const o: BoxOrder = { ...clone(input), amountPaidCents: 0, status: "awaiting_payment", kitchenDone: false, createdAt: new Date().toISOString() };
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
};
