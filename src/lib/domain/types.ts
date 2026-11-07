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
  /** Plain text terms values shown at checkout. */
  cancellationPolicy: string;
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
}

export interface OrderUpdate {
  id: string;
  orderId: string;
  kind: "stage" | "photo" | "video" | "note";
  caption: string;
  mediaPath: string | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  orderId: string;
  kind: "deposit" | "balance";
  amountCents: number;
  stripeSessionId: string;
  status: "pending" | "paid";
  createdAt: string;
}
