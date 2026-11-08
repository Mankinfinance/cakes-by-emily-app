// The data adapter interface. The live site uses Supabase; automated tests
// use the in-memory adapter (DATA_ADAPTER=memory) so they never touch real data.

import type { SalesSummary } from "../domain/snapshot";
import type {
  Automation,
  BoxOrder,
  CatalogueItem,
  ClassBooking,
  ClassSession,
  ClassType,
  CorporateOrder,
  CorporatePackage,
  PrivateRequest,
  Referral,
  ReferralCode,
  Review,
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
export type NewCorporateOrder = Omit<CorporateOrder, "createdAt" | "amountPaidCents" | "status" | "kitchenDone">;
export type NewClassBooking = Omit<ClassBooking, "createdAt" | "amountPaidCents" | "status" | "cancellation">;
export type NewPrivateRequest = Omit<PrivateRequest, "createdAt" | "amountPaidCents" | "status" | "payTokenHash">;

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
  /** Cake waitlist entries unless sessionId is given (then that class session's). */
  listWaitlist(opts?: { date?: string; fromDate?: string; sessionId?: string; all?: boolean }): Promise<WaitlistEntry[]>;
  getWaitlistById(id: string): Promise<WaitlistEntry | null>;
  getWaitlistByOfferHash(hash: string): Promise<WaitlistEntry | null>;
  /** waiting -> offered, only if still waiting and no other live offer exists for the date (or class session). */
  offerWaitlist(id: string, tokenHash: string, offeredAt: string, expiresAt: string): Promise<boolean>;
  /** offered -> claimed, only if the offer is still live. */
  claimWaitlist(id: string, orderId: string | null, now: string): Promise<boolean>;
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

  // Phase 3 -----------------------------------------------------------------
  /** Every order (any stage) placed with this email. */
  listOrdersByEmail(email: string): Promise<Order[]>;

  // Corporate packages
  listCorporatePackages(): Promise<CorporatePackage[]>;
  updateCorporatePackage(id: string, patch: Partial<Pick<CorporatePackage, "name" | "priceCents" | "visible">>): Promise<void>;
  createCorporateOrder(order: NewCorporateOrder): Promise<CorporateOrder>;
  getCorporateOrderById(id: string): Promise<CorporateOrder | null>;
  getCorporateOrderByTokenHash(tokenHash: string): Promise<CorporateOrder | null>;
  listCorporateOrders(opts?: { includeUnpaid?: boolean }): Promise<CorporateOrder[]>;
  listStaleUnpaidCorporate(before: string): Promise<CorporateOrder[]>;
  /** Change status only if it is currently one of `from`. */
  setCorporateStatus(id: string, status: CorporateOrder["status"], from: CorporateOrder["status"][]): Promise<boolean>;
  setCorporateKitchenDone(id: string, done: boolean): Promise<void>;

  // Reviews
  /** One review per order: returns null if this order already has one. */
  createReview(r: Omit<Review, "id" | "createdAt" | "status">): Promise<Review | null>;
  getReviewByOrder(orderId: string): Promise<Review | null>;
  listReviews(opts?: { status?: Review["status"] }): Promise<Review[]>;
  setReviewStatus(id: string, status: Review["status"]): Promise<void>;

  // Referrals
  getReferralCodeByEmail(email: string): Promise<ReferralCode | null>;
  getReferralCode(code: string): Promise<ReferralCode | null>;
  /** False if the code or the email already has a code. */
  createReferralCode(code: string, email: string): Promise<boolean>;
  /** False if this customer has already been referred (or the order already has a referral). */
  createReferral(r: Omit<Referral, "id" | "createdAt" | "status">): Promise<boolean>;
  listReferrals(): Promise<Referral[]>;
  /** pending -> rewarded for this order's referral, exactly once. Returns it if this call rewarded it. */
  rewardReferralOnce(orderId: string): Promise<Referral | null>;
  /** pending -> void (the order was never paid), freeing the customer to be referred again. */
  voidReferral(orderId: string): Promise<void>;

  // Classes
  listClassTypes(): Promise<ClassType[]>;
  updateClassType(id: string, patch: Partial<Pick<ClassType, "priceCents" | "visible" | "minGuests" | "description">>): Promise<void>;
  listSessions(opts?: { fromDate?: string; includeCancelled?: boolean }): Promise<ClassSession[]>;
  getSession(id: string): Promise<ClassSession | null>;
  createSession(s: Omit<ClassSession, "createdAt" | "booked">): Promise<ClassSession>;
  updateSession(id: string, patch: Partial<Pick<ClassSession, "date" | "startTime" | "seats" | "status">>): Promise<void>;
  /** Atomically take seats. False if there aren't enough or the class is cancelled. */
  reserveSeats(sessionId: string, seats: number): Promise<boolean>;
  releaseSeats(sessionId: string, seats: number): Promise<void>;
  createBooking(b: NewClassBooking): Promise<ClassBooking>;
  getBookingById(id: string): Promise<ClassBooking | null>;
  getBookingByTokenHash(tokenHash: string): Promise<ClassBooking | null>;
  listBookings(opts?: { sessionId?: string; includeUnpaid?: boolean }): Promise<ClassBooking[]>;
  listStaleUnpaidBookings(before: string): Promise<ClassBooking[]>;
  updateBookingGuests(id: string, guests: ClassBooking["guests"]): Promise<void>;
  /** Cancel once and give the seats back. */
  cancelBookingOnce(id: string, onlyUnpaid: boolean, record: ClassBooking["cancellation"]): Promise<boolean>;
  claimBookingMessage(bookingId: string, key: string): Promise<boolean>;
  releaseBookingMessage(bookingId: string, key: string): Promise<void>;
  createPrivateRequest(r: NewPrivateRequest): Promise<PrivateRequest>;
  getPrivateRequest(id: string): Promise<PrivateRequest | null>;
  getPrivateRequestByPayHash(hash: string): Promise<PrivateRequest | null>;
  listPrivateRequests(): Promise<PrivateRequest[]>;
  /** Change status (and optionally set the pay link hash) only if it is currently `from`. */
  setPrivateStatus(id: string, status: PrivateRequest["status"], from: PrivateRequest["status"], payTokenHash?: string): Promise<boolean>;

  // Sales snapshot (money and counts for orders booked between two Sydney dates)
  salesSummary(from: string, to: string): Promise<SalesSummary>;
}
