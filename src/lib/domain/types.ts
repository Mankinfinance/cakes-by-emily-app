// Core domain types shared by the server, the builder and the admin screens.

export const CATEGORIES = [
  "occasion",
  "size",
  "flavour",
  "finish",
  "colour",
  "decoration",
  "extra",
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
export const MULTI_CATEGORIES: readonly Category[] = ["decoration", "extra"];

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
  topperText: string;
}

export interface PriceLine {
  itemId: string | null;
  category: Category | "rush" | "peak";
  name: string;
  amountCents: number;
}

export interface PriceBreakdown {
  lines: PriceLine[];
  subtotalCents: number;
  rushFeeCents: number;
  peakSurchargeCents: number;
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
  /** Exactly one of orderId, boxOrderId or voucherId is set. */
  orderId: string | null;
  boxOrderId: string | null;
  voucherId: string | null;
  kind: "deposit" | "balance" | "box" | "voucher";
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
