// Core domain types shared by the server, the builder and the admin screens.

export const CATEGORIES = [
  "occasion",
  "size",
  "flavour",
  "finish",
  "colour",
  "decoration",
  "extra",
  "addon",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Categories where the customer must pick exactly one option. */
export const REQUIRED_CATEGORIES: readonly Category[] = [
  "occasion",
  "size",
  "flavour",
  "finish",
  "colour",
];

/** Categories where the customer may pick several options. */
export const MULTI_CATEGORIES: readonly Category[] = ["decoration", "extra", "addon"];

export const ALLERGENS = ["gluten", "egg", "dairy", "nuts", "soy", "sesame"] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const DIETARY_FILTERS = {
  "nut-free": { label: "Nut-free", excludes: ["nuts"] },
  "egg-free": { label: "Egg-free", excludes: ["egg"] },
  "dairy-free": { label: "Dairy-free", excludes: ["dairy"] },
  "gluten-friendly": { label: "Gluten-friendly", excludes: ["gluten"] },
} as const satisfies Record<string, { label: string; excludes: Allergen[] }>;
export type DietaryFilter = keyof typeof DIETARY_FILTERS;

/** "flat" is charged once; "per_tier" is multiplied by the size's tier count. */
export type PriceMode = "flat" | "per_tier";

export interface CatalogueItem {
  id: string;
  category: Category;
  name: string;
  description: string;
  priceCents: number;
  priceMode: PriceMode;
  /** Only used by sizes: how many tiers this size has. */
  tiers: number;
  /** Only used by colours: hex value for the preview. */
  hex: string | null;
  allergens: Allergen[];
  visible: boolean;
  sort: number;
  /** Party add-ons only: a refundable bond (for example cake stand hire). */
  bondCents: number;
}

export interface Settings {
  /** Standard minimum notice in days. */
  minNoticeDays: number;
  rushEnabled: boolean;
  rushFeeCents: number;
  /** Rush orders cannot be closer than this many days out. */
  rushMinDays: number;
  dailyCap: number;
  weeklyCap: number;
  /** Pickup window, 24h "HH:MM". */
  pickupStart: string;
  pickupEnd: string;
  slotMinutes: number;
  slotCap: number;
  depositPercent: number;
  /** Balance is due this many days before pickup. */
  balanceDueDays: number;
  /** Design changes accepted up to this many days before pickup. */
  changeCutoffDays: number;
  /** Days of the week with no pickups (0 = Sunday). */
  closedWeekdays: number[];
  /** How far ahead customers can book, in days. */
  bookingHorizonDays: number;
  /** Extra notes added to the generated terms (optional). */
  cancellationPolicy: string;
  /** Free design change rounds after Emily sends a design for approval. */
  freeDesignChangeRounds: number;
  /** How many times a customer can move their pickup date online for free. */
  freeDateChanges: number;
  /** Cancel this many days or more before pickup: deposit back minus the admin fee. */
  cancelFullRefundDays: number;
  cancelAdminFeeCents: number;
  /** Cancel between this and cancelFullRefundDays: what was paid becomes credit. Inside it: nothing back. */
  cancelCreditDays: number;
  /** Gift vouchers and credit codes expire after this many months. */
  voucherValidMonths: number;
  /** Voucher amounts offered to buyers, each with its own "Show to customers" switch. */
  voucherOptions: VoucherOption[];
  voucherCustomEnabled: boolean;
  voucherCustomMinCents: number;
  voucherCustomMaxCents: number;
  /** Where the thank-you message sends people to leave a review (for example a Google review link). */
  reviewUrl: string;
  // Phase 3
  referralsEnabled: boolean;
  /** What the new customer gets off their first order. */
  referralGiveCents: number;
  /** Credit the referrer gets when the new customer's deposit is paid. */
  referralGetCents: number;
  stampsEnabled: boolean;
  /** Every Nth collected order earns a reward. */
  stampEvery: number;
  stampRewardName: string;
  /** Group discount on class bookings. */
  groupDiscountMinSeats: number;
  groupDiscountPercent: number;
  /** When true, days with a class (or an accepted private class) take no cake orders. */
  classBlocksCakes: boolean;
  privatePackages: PrivatePackage[];
}

export interface PrivatePackage {
  key: string;
  name: string;
  includes: string;
  perPersonCents: number;
  depositCents: number;
  minGuests: number;
  maxGuests: number;
  kids: boolean;
  visible: boolean;
}

export interface VoucherOption {
  cents: number;
  visible: boolean;
}

export interface PeakDate {
  date: string; // YYYY-MM-DD
  label: string;
  surchargeCents: number;
}

export interface DayOff {
  date: string; // YYYY-MM-DD
  note: string;
}

export const STAGES = [
  "awaiting_payment",
  "received",
  "awaiting_approval",
  "design_confirmed",
  "baking",
  "decorating",
  "ready",
  "collected",
] as const;
export type Stage = (typeof STAGES)[number] | "cancelled";

export const STAGE_LABELS: Record<Stage, string> = {
  awaiting_payment: "Awaiting deposit",
  received: "Order received",
  awaiting_approval: "Awaiting your approval",
  design_confirmed: "Design confirmed",
  baking: "Baking",
  decorating: "Decorating",
  ready: "Ready for pickup",
  collected: "Collected",
  cancelled: "Cancelled",
};

/** The customer's choices, by catalogue item id. */
export interface CakeConfig {
  occasion: string;
  size: string;
  flavour: string;
  finish: string;
  colour: string;
  decorations: string[];
  extras: string[];
  /** Party add-ons chosen at checkout (phase 3). Older saved designs may not have it. */
  addons?: string[];
  topperText: string;
}

export interface PriceLine {
  itemId: string | null;
  category: Category | "rush" | "peak" | "bond" | "referral" | "reward";
  name: string;
  amountCents: number;
}

export interface PriceBreakdown {
  lines: PriceLine[];
  subtotalCents: number;
  rushFeeCents: number;
  peakSurchargeCents: number;
  bondCents: number;
  referralDiscountCents: number;
  totalCents: number;
  depositCents: number;
  isRush: boolean;
}

export interface OrderItemSnapshot {
  itemId: string | null;
  category: string;
  name: string;
  amountCents: number;
}

export interface Order {
  id: string;
  reference: string;
  tokenHash: string;
  stage: Stage;
  customerName: string;
  email: string;
  phone: string;
  marketingOptIn: boolean;
  pickupDate: string;
  pickupSlot: string;
  config: CakeConfig;
  allergyNotes: string;
  notes: string;
  inspirationPath: string | null;
  items: OrderItemSnapshot[];
  subtotalCents: number;
  rushFeeCents: number;
  peakSurchargeCents: number;
  totalCents: number;
  depositCents: number;
  amountPaidCents: number;
  isRush: boolean;
  termsAcceptedAt: string;
  createdAt: string;
  remindersSent: string[];
  dietary: DietaryFilter[];
  /** Birthday orders: the customer asked for a reminder before next year's birthday. */
  remindNextYear: boolean;
  dateChangesUsed: number;
  designChangesUsed: number;
  approvedAt: string | null;
  /** A gift voucher or credit code used on this order, and how much of it. */
  voucherId: string | null;
  voucherAppliedCents: number;
  /** Set when this order came from a waitlist offer. */
  waitlistId: string | null;
  kitchenDone: boolean;
  cancellation: CancellationRecord | null;
  /** Phase 3: a referral code used on this order, and whether a stamp card reward was applied. */
  referralCode: string | null;
  stampReward: boolean;
}

export interface CancellationRecord {
  at: string;
  by: "customer" | "emily" | "expired";
  daysOut: number;
  /** Cash Emily needs to refund in Stripe. */
  refundCents: number;
  /** Cash paid that became a credit code. */
  creditCents: number;
  /** Cash kept under the terms. */
  keptCents: number;
  /** Voucher or credit used on the order that was given back. */
  voucherReturnedCents: number;
  summary: string;
}

export interface OrderUpdate {
  id: string;
  orderId: string;
  kind: "stage" | "photo" | "video" | "note" | "sketch" | "change_request" | "approval";
  caption: string;
  mediaPath: string | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  /** Exactly one target is set. */
  orderId: string | null;
  boxOrderId: string | null;
  voucherId: string | null;
  corporateOrderId?: string | null;
  classBookingId?: string | null;
  privateRequestId?: string | null;
  kind: "deposit" | "balance" | "box" | "voucher" | "corporate_deposit" | "corporate_balance" | "class" | "private_deposit";
  amountCents: number;
  stripeSessionId: string;
  status: "pending" | "paid";
  createdAt: string;
}

// Automatic messages ----------------------------------------------------

export const AUTOMATION_KEYS = [
  "order_received",
  "design_confirmed",
  "balance_reminder",
  "pickup_details",
  "thank_you",
  "rebook_reminder",
  "stand_return",
  "class_reminder",
  "class_thank_you",
] as const;
export type AutomationKey = (typeof AUTOMATION_KEYS)[number];

export interface Automation {
  key: AutomationKey;
  enabled: boolean;
  /**
   * balance_reminder and pickup_details: days before pickup.
   * thank_you and rebook_reminder: days after pickup.
   * Unused for the others.
   */
  days: number;
}

export interface SentMessage {
  orderId: string;
  key: string;
  sentAt: string;
}

// Waitlist --------------------------------------------------------------

export type WaitlistStatus = "waiting" | "offered" | "claimed" | "expired" | "removed";

export interface WaitlistEntry {
  id: string;
  date: string;
  /** Set for a class session waitlist (phase 3); null for cake dates. */
  sessionId?: string | null;
  seats?: number;
  customerName: string;
  email: string;
  phone: string;
  config: CakeConfig;
  dietary: DietaryFilter[];
  status: WaitlistStatus;
  offerTokenHash: string | null;
  offeredAt: string | null;
  offerExpiresAt: string | null;
  orderId: string | null;
  createdAt: string;
}

// Seasonal boxes --------------------------------------------------------

export interface SeasonalBox {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  cap: number;
  sold: number;
  opensOn: string;
  closesOn: string;
  pickupFrom: string;
  pickupTo: string;
  photoPath: string | null;
  visible: boolean;
  sort: number;
}

export type BoxOrderStatus = "awaiting_payment" | "paid" | "collected" | "cancelled";

export interface BoxOrder {
  id: string;
  reference: string;
  tokenHash: string;
  boxId: string;
  boxName: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  amountPaidCents: number;
  customerName: string;
  email: string;
  phone: string;
  marketingOptIn: boolean;
  pickupDate: string;
  pickupSlot: string;
  status: BoxOrderStatus;
  kitchenDone: boolean;
  createdAt: string;
}

// Gift vouchers and credit codes ---------------------------------------

export type VoucherKind = "gift" | "credit";
export type VoucherStatus = "pending" | "active" | "void";

export interface Voucher {
  id: string;
  kind: VoucherKind;
  codeHash: string;
  codeLast4: string;
  amountCents: number;
  balanceCents: number;
  status: VoucherStatus;
  buyerName: string;
  /** For gift vouchers the buyer; for credit codes the customer who owns the credit. */
  buyerEmail: string;
  recipientName: string;
  recipientEmail: string;
  message: string;
  expiresOn: string;
  sourceOrderId: string | null;
  createdAt: string;
}

// Phase 3: corporate packages ---------------------------------------------

export interface CorporatePackage {
  id: string;
  product: "cookies" | "cupcakes";
  name: string;
  quantity: number;
  priceCents: number;
  visible: boolean;
  sort: number;
}

export type CorporateStatus = "awaiting_payment" | "confirmed" | "ready" | "collected" | "cancelled";

export interface CorporateOrder {
  id: string;
  reference: string;
  tokenHash: string;
  packageId: string;
  packageName: string;
  quantity: number;
  totalCents: number;
  depositCents: number;
  amountPaidCents: number;
  companyName: string;
  abn: string;
  contactName: string;
  email: string;
  phone: string;
  logoPath: string | null;
  notes: string;
  pickupDate: string;
  pickupSlot: string;
  status: CorporateStatus;
  kitchenDone: boolean;
  termsAcceptedAt: string;
  createdAt: string;
}

// Phase 3: reviews -------------------------------------------------------------

export type ReviewStatus = "pending" | "approved" | "hidden";

export interface Review {
  id: string;
  orderId: string;
  rating: number;
  text: string;
  photoPath: string | null;
  consentToPublish: boolean;
  displayName: string;
  status: ReviewStatus;
  createdAt: string;
}

// Phase 3: referrals --------------------------------------------------------------

export interface ReferralCode {
  code: string;
  email: string;
  createdAt: string;
}

export type ReferralStatus = "pending" | "rewarded" | "void";

export interface Referral {
  id: string;
  code: string;
  referrerEmail: string;
  referredEmail: string;
  orderId: string;
  status: ReferralStatus;
  createdAt: string;
}

// Phase 3: classes -------------------------------------------------------------------

export interface ClassType {
  id: string;
  name: string;
  description: string;
  level: string;
  priceCents: number;
  durationMinutes: number;
  defaultSeats: number;
  minGuests: number;
  isSip: boolean;
  ageNote: string;
  visible: boolean;
  sort: number;
}

export interface ClassSession {
  id: string;
  classTypeId: string;
  date: string;
  startTime: string;
  seats: number;
  booked: number;
  status: "scheduled" | "cancelled";
  seriesId: string | null;
  createdAt: string;
}

export interface ClassGuest {
  name: string;
  allergies: string;
  checkedIn: boolean;
}

export type ClassBookingStatus = "awaiting_payment" | "paid" | "cancelled";

export interface ClassBooking {
  id: string;
  reference: string;
  tokenHash: string;
  sessionId: string;
  seats: number;
  guests: ClassGuest[];
  contactName: string;
  email: string;
  phone: string;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  amountPaidCents: number;
  status: ClassBookingStatus;
  adultConfirmed: boolean;
  marketingOptIn: boolean;
  waitlistId: string | null;
  cancellation: CancellationRecord | null;
  termsAcceptedAt: string;
  createdAt: string;
}

export type PrivateRequestStatus = "requested" | "accepted" | "declined" | "paid";

export interface PrivateRequest {
  id: string;
  reference: string;
  packageKey: string;
  packageName: string;
  guests: number;
  perPersonCents: number;
  depositCents: number;
  estimateCents: number;
  preferredDate: string;
  preferredTime: string;
  occasion: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
  status: PrivateRequestStatus;
  payTokenHash: string | null;
  amountPaidCents: number;
  createdAt: string;
}
