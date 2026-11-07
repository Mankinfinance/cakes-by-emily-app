// The data adapter interface. The live site uses Supabase; automated tests
// use the in-memory adapter (DATA_ADAPTER=memory) so they never touch real data.

import type {
  CatalogueItem,
  DayOff,
  Order,
  OrderUpdate,
  Payment,
  PeakDate,
  Settings,
  Stage,
} from "../domain/types";

/** Unpaid orders hold their slot this long while the customer is at checkout. */
export const PAYMENT_HOLD_MINUTES = 30;

export type NewOrder = Omit<Order, "createdAt" | "remindersSent" | "amountPaidCents">;

export interface MediaFile {
  bytes: Uint8Array;
  contentType: string;
}

export interface Repository {
  // Catalogue and settings
  listCatalogue(): Promise<CatalogueItem[]>;
  updateCatalogueItem(id: string, patch: Partial<Omit<CatalogueItem, "id" | "category">>): Promise<void>;
  createCatalogueItem(item: CatalogueItem): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  listDaysOff(): Promise<DayOff[]>;
  addDayOff(day: DayOff): Promise<void>;
  removeDayOff(date: string): Promise<void>;
  listPeakDates(): Promise<PeakDate[]>;
  upsertPeakDate(peak: PeakDate): Promise<void>;
  removePeakDate(date: string): Promise<void>;

  // Orders
  /** Orders that hold capacity: everything except cancelled and unpaid ones older than the hold window. */
  listActiveBookings(fromDate: string, toDate: string): Promise<{ pickupDate: string; pickupSlot: string }[]>;
  createOrder(order: NewOrder): Promise<Order>;
  getOrderById(id: string): Promise<Order | null>;
  getOrderByTokenHash(tokenHash: string): Promise<Order | null>;
  listOrders(opts?: { includeUnpaid?: boolean }): Promise<Order[]>;
  setStage(id: string, stage: Stage): Promise<void>;
  markReminderSent(id: string, key: string): Promise<void>;

  // Payments (Stripe)
  createPayment(p: Omit<Payment, "id" | "createdAt" | "status">): Promise<Payment>;
  getPaymentBySession(sessionId: string): Promise<Payment | null>;
  /**
   * Mark a payment paid and add it to the order's amount paid, exactly once.
   * Returns false if the event was already processed.
   */
  recordPaymentOnce(eventId: string, sessionId: string): Promise<boolean>;

  // Updates and media
  addUpdate(u: Omit<OrderUpdate, "id" | "createdAt">): Promise<OrderUpdate>;
  listUpdates(orderId: string): Promise<OrderUpdate[]>;
  uploadMedia(path: string, file: MediaFile): Promise<void>;
  /** A short-lived URL the browser can load, or null if missing. */
  mediaUrl(path: string): Promise<string | null>;
}
