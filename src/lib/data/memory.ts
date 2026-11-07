// In-memory adapter for automated tests and local demos. Data lives only in
// this server process and disappears on restart. Never used in production.

import { randomUUID } from "node:crypto";
import type { Order, OrderUpdate, Payment } from "../domain/types";
import { PAYMENT_HOLD_MINUTES, type MediaFile, type NewOrder, type Repository } from "./repository";
import { SAMPLE_CATALOGUE, SAMPLE_PEAK_DATES, SAMPLE_SETTINGS } from "./sample-data";

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

const clone = <T>(v: T): T => structuredClone(v);

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

  async listActiveBookings(fromDate, toDate) {
    const holdSince = new Date(Date.now() - PAYMENT_HOLD_MINUTES * 60_000).toISOString();
    return store()
      .orders.filter(
        (o) =>
          o.stage !== "cancelled" &&
          (o.stage !== "awaiting_payment" || o.createdAt >= holdSince) &&
          o.pickupDate >= fromDate &&
          o.pickupDate <= toDate,
      )
      .map((o) => ({ pickupDate: o.pickupDate, pickupSlot: o.pickupSlot }));
  },
  async createOrder(input: NewOrder) {
    const order: Order = {
      ...clone(input),
      createdAt: new Date().toISOString(),
      remindersSent: [],
      amountPaidCents: 0,
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
  async setStage(id, stage) {
    const o = store().orders.find((x) => x.id === id);
    if (o) o.stage = stage;
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
    const payment = s.payments.find((x) => x.stripeSessionId === sessionId);
    if (!payment || payment.status === "paid") {
      s.processedEvents.add(eventId);
      return false;
    }
    s.processedEvents.add(eventId);
    payment.status = "paid";
    const order = s.orders.find((o) => o.id === payment.orderId);
    if (order) {
      order.amountPaidCents += payment.amountCents;
      if (order.stage === "awaiting_payment") order.stage = "received";
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
};
