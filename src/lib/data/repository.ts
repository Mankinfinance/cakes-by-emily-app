// The data adapter interface. The live site uses Supabase; automated tests
// use the in-memory adapter (DATA_ADAPTER=memory) so they never touch real data.

import type {
  Automation,
  BoxOrder,
  CatalogueItem,
  DayOff,
  Order,
  OrderUpdate,
  Payment,
  PeakDate,
  SeasonalBox,
  SentMessage,
  Settings,
  Stage,
  Voucher,
  WaitlistEntry,
} from "../domain/types";

/** Unpaid orders hold their slot this long while the customer is at checkout. */
export const PAYMENT_HOLD_MINUTES = 30;
/**
 * Unpaid orders older than this are cancelled by the daily job and anything
 * they reserved (box stock, voucher balance, a waitlist place) is released.
 * Longer than the Stripe session, so a payment can't arrive afterwards.
 */
export const RELEASE_AFTER_MINUTES = 60;

export type NewOrder = Omit<
  Order,
  | "createdAt"
  | "remindersSent"
  | "amountPaidCents"
  | "dateChangesUsed"
  | "designChangesUsed"
  | "approvedAt"
  | "voucherId"
  | "voucherAppliedCents"
  | "kitchenDone"
  | "cancellation"
>;

export type OrderPatch = Partial<
  Pick<
    Order,
    | "pickupDate"
    | "pickupSlot"
    | "dateChangesUsed"
    | "designChangesUsed"
    | "approvedAt"
    | "kitchenDone"
    | "cancellation"
    | "stage"
  >
>;

export interface MediaFile {
  bytes: Uint8Array;
  contentType: string;
}

export type UploadTarget =
  | { kind: "supabase"; bucket: string; path: string; token: string }
  | { kind: "local"; url: string };

export interface BookingQuery {
  /** Leave this order out (when moving its own date). */
  excludeOrderId?: string;
  /** Leave this waitlist offer's hold out (when its holder claims it). */
  excludeWaitlistId?: string;
}

export type NewBoxOrder = Omit<BoxOrder, "createdAt" | "amountPaidCents" | "status" | "kitchenDone">;
export type NewVoucher = Omit<Voucher, "createdAt">;
export type NewWaitlistEntry = Omit<WaitlistEntry, "id" | "createdAt" | "status" | "offerTokenHash" | "offeredAt" | "offerExpiresAt" | "orderId">;

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
  /**
   * Bookings that hold capacity: everything except cancelled orders and
   * unpaid ones older than the hold window, plus live waitlist offers (which
   * hold a place on their date with an empty slot).
   */
  listActiveBookings(fromDate: string, toDate: string, query?: BookingQuery): Promise<{ pickupDate: string; pickupSlot: string }[]>;
  createOrder(order: NewOrder): Promise<Order>;
  getOrderById(id: string): Promise<Order | null>;
  getOrderByTokenHash(tokenHash: string): Promise<Order | null>;
  listOrders(opts?: { includeUnpaid?: boolean }): Promise<Order[]>;
  /** Unpaid orders created before `before` (ISO time) that are still awaiting payment. */
  listStaleUnpaidOrders(before: string): Promise<Order[]>;
  setStage(id: string, stage: Stage): Promise<void>;
  updateOrder(id: string, patch: OrderPatch): Promise<void>;
  /**
   * Move a live order to "cancelled" exactly once. Returns false if it was
   * already cancelled or collected (or, with onlyUnpaid, if it has been paid).
   */
  cancelOrderOnce(id: string, record: Order["cancellation"], onlyUnpaid?: boolean): Promise<boolean>;
  markReminderSent(id: string, key: string): Promise<void>;

  // Payments (Stripe)
  createPayment(p: Omit<Payment, "id" | "createdAt" | "status">): Promise<Payment>;
  getPaymentBySession(sessionId: string): Promise<Payment | null>;
  /**
   * Mark a payment paid and add it to what it paid for, exactly once.
   * Returns false if the event was already processed.
   */
  recordPaymentOnce(eventId: string, sessionId: string): Promise<boolean>;

  // Updates and media
  addUpdate(u: Omit<OrderUpdate, "id" | "createdAt">): Promise<OrderUpdate>;
  listUpdates(orderId: string): Promise<OrderUpdate[]>;
  uploadMedia(path: string, file: MediaFile): Promise<void>;
  /** A short-lived URL the browser can load, or null if missing. */
  mediaUrl(path: string): Promise<string | null>;
  /** Where the browser should upload a large file (videos) directly. */
  createUploadTarget(path: string, contentType: string): Promise<UploadTarget>;
  /** The first bytes of a stored file, to check it really is what it claims. */
  readMediaHead(path: string, length: number): Promise<MediaFile | null>;
  deleteMedia(path: string): Promise<void>;

  // Automatic messages
  listAutomations(): Promise<Automation[]>;
  saveAutomation(a: Automation): Promise<void>;
  /** Claim a message before sending it. False means it was already sent (or is being sent). */
  claimMessage(orderId: string, key: string): Promise<boolean>;
  /** Undo a claim when the send failed, so the next run tries again. */
  releaseMessage(orderId: string, key: string): Promise<void>;
  listMessages(orderId: string): Promise<SentMessage[]>;

  // Waitlist
  addWaitlist(entry: NewWaitlistEntry): Promise<WaitlistEntry>;
  listWaitlist(opts?: { date?: string; fromDate?: string }): Promise<WaitlistEntry[]>;
  getWaitlistById(id: string): Promise<WaitlistEntry | null>;
  getWaitlistByOfferHash(hash: string): Promise<WaitlistEntry | null>;
  /** waiting -> offered, only if still waiting and no other live offer exists for the date. */
  offerWaitlist(id: string, tokenHash: string, offeredAt: string, expiresAt: string): Promise<boolean>;
  /** offered -> claimed, only if the offer is still live. */
  claimWaitlist(id: string, orderId: string, now: string): Promise<boolean>;
  setWaitlistStatus(id: string, status: WaitlistEntry["status"]): Promise<void>;

  // Seasonal boxes
  listBoxes(): Promise<SeasonalBox[]>;
  getBox(id: string): Promise<SeasonalBox | null>;
  createBox(box: SeasonalBox): Promise<void>;
  updateBox(id: string, patch: Partial<Omit<SeasonalBox, "id" | "sold">>): Promise<void>;
  /** Atomically take stock. False if it would oversell, or the box is hidden or not open today. */
  reserveBoxStock(boxId: string, quantity: number, today: string): Promise<boolean>;
  createBoxOrder(order: NewBoxOrder): Promise<BoxOrder>;
  getBoxOrderById(id: string): Promise<BoxOrder | null>;
  getBoxOrderByTokenHash(tokenHash: string): Promise<BoxOrder | null>;
  listBoxOrders(opts?: { includeUnpaid?: boolean }): Promise<BoxOrder[]>;
  listStaleUnpaidBoxOrders(before: string): Promise<BoxOrder[]>;
  /** Cancel once and put the stock back. */
  cancelBoxOrder(id: string, onlyUnpaid: boolean): Promise<boolean>;
  updateBoxOrder(id: string, patch: Partial<Pick<BoxOrder, "kitchenDone" | "status">>): Promise<void>;

  // Gift vouchers and credit codes
  createVoucher(v: NewVoucher): Promise<Voucher>;
  getVoucherById(id: string): Promise<Voucher | null>;
  getVoucherByCodeHash(hash: string): Promise<Voucher | null>;
  listVouchers(): Promise<Voucher[]>;
  setVoucherStatus(id: string, status: Voucher["status"]): Promise<void>;
  /** Atomically use up to maxCents of a voucher on an order (once per order). Returns the amount used. */
  redeemVoucher(codeHash: string, orderId: string, maxCents: number, today: string): Promise<number>;
  /** Give back what an order used, once. toVoucher=false means the caller must issue a new credit code. */
  returnVoucher(orderId: string, today: string): Promise<{ amount: number; toVoucher: boolean }>;
}
