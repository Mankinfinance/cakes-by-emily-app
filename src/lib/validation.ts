// Zod schemas for everything that crosses a trust boundary.

import { z } from "zod";
import { isIsoDate } from "./domain/dates";
import { ALLERGENS, CATEGORIES, DIETARY_FILTERS } from "./domain/types";

const id = z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/);
const isoDate = z.string().refine(isIsoDate, "Invalid date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const cents = z.number().int().min(0).max(1_000_000);

export const cakeConfigSchema = z.object({
  occasion: id,
  size: id,
  flavour: id,
  finish: id,
  colour: id,
  decorations: z.array(id).max(20),
  extras: z.array(id).max(20),
  addons: z.array(id).max(20).default([]),
  topperText: z.string().max(30).default(""),
});

const dietaryKeys = Object.keys(DIETARY_FILTERS) as [keyof typeof DIETARY_FILTERS, ...(keyof typeof DIETARY_FILTERS)[]];

export const orderRequestSchema = z.object({
  config: cakeConfigSchema,
  dietary: z.array(z.enum(dietaryKeys)).max(4).default([]),
  pickupDate: isoDate,
  pickupSlot: hhmm,
  customerName: z.string().trim().min(2, "Please enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Please enter a valid email").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9 +()-]{8,20}$/, "Please enter a valid phone number"),
  allergyNotes: z.string().trim().max(500).default(""),
  notes: z.string().trim().max(1000).default(""),
  marketingOptIn: z.boolean().default(false),
  acceptTerms: z.literal(true, { error: "Please accept the terms to continue" }),
  remindNextYear: z.boolean().default(false),
  voucherCode: z.string().trim().max(40).default(""),
  referralCode: z.string().trim().max(20).default(""),
  /** Set when claiming a waitlist offer. */
  waitlistToken: z.string().trim().max(60).default(""),
});
export type OrderRequest = z.infer<typeof orderRequestSchema>;

export const settingsSchema = z
  .object({
    minNoticeDays: z.number().int().min(0).max(60),
    rushEnabled: z.boolean(),
    rushFeeCents: cents,
    rushMinDays: z.number().int().min(1).max(30),
    dailyCap: z.number().int().min(0).max(50),
    weeklyCap: z.number().int().min(0).max(200),
    pickupStart: hhmm,
    pickupEnd: hhmm,
    slotMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    slotCap: z.number().int().min(1).max(20),
    depositPercent: z.number().int().min(10).max(100),
    balanceDueDays: z.number().int().min(0).max(30),
    changeCutoffDays: z.number().int().min(0).max(60),
    closedWeekdays: z.array(z.number().int().min(0).max(6)).max(7),
    bookingHorizonDays: z.number().int().min(7).max(730),
    cancellationPolicy: z.string().max(2000),
    freeDesignChangeRounds: z.number().int().min(0).max(10),
    freeDateChanges: z.number().int().min(0).max(10),
    cancelFullRefundDays: z.number().int().min(0).max(120),
    cancelAdminFeeCents: cents,
    cancelCreditDays: z.number().int().min(0).max(120),
    voucherValidMonths: z.number().int().min(1).max(60),
    voucherOptions: z
      .array(z.object({ cents: z.number().int().min(500).max(100_000), visible: z.boolean() }))
      .max(12),
    voucherCustomEnabled: z.boolean(),
    voucherCustomMinCents: z.number().int().min(500).max(100_000),
    voucherCustomMaxCents: z.number().int().min(500).max(100_000),
    reviewUrl: z.union([z.literal(""), z.string().trim().url().max(500).refine((u) => u.startsWith("https://"), "Use an https:// link")]),
    referralsEnabled: z.boolean(),
    referralGiveCents: z.number().int().min(0).max(20_000),
    referralGetCents: z.number().int().min(0).max(20_000),
    stampsEnabled: z.boolean(),
    stampEvery: z.number().int().min(2).max(50),
    stampRewardName: z.string().trim().min(1).max(80),
    groupDiscountMinSeats: z.number().int().min(2).max(20),
    groupDiscountPercent: z.number().int().min(0).max(50),
    classBlocksCakes: z.boolean(),
    privatePackages: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z0-9-]{1,30}$/),
          name: z.string().trim().min(1).max(60),
          includes: z.string().trim().max(200),
          perPersonCents: z.number().int().min(0).max(100_000),
          depositCents: z.number().int().min(0).max(100_000),
          minGuests: z.number().int().min(1).max(50),
          maxGuests: z.number().int().min(1).max(50),
          kids: z.boolean(),
          visible: z.boolean(),
        }),
      )
      .max(10),
  })
  .refine((s) => s.cancelCreditDays <= s.cancelFullRefundDays, {
    message: "The credit window must start on or before the full refund window",
    path: ["cancelCreditDays"],
  })
  .refine((s) => s.voucherCustomMinCents <= s.voucherCustomMaxCents, {
    message: "Custom voucher minimum must be below the maximum",
    path: ["voucherCustomMaxCents"],
  })
  .refine((s) => s.pickupStart < s.pickupEnd, { message: "Pickup start must be before pickup end", path: ["pickupEnd"] });

export const catalogueItemPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(200).optional(),
  priceCents: cents.optional(),
  priceMode: z.enum(["flat", "per_tier"]).optional(),
  tiers: z.number().int().min(1).max(6).optional(),
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  allergens: z.array(z.enum(ALLERGENS)).optional(),
  visible: z.boolean().optional(),
  sort: z.number().int().min(0).max(100000).optional(),
  bondCents: cents.optional(),
});

export const newCatalogueItemSchema = z.object({
  category: z.enum(CATEGORIES),
  name: z.string().trim().min(1).max(80),
  priceCents: cents,
});

export const peakDateSchema = z.object({
  date: isoDate,
  label: z.string().trim().min(1).max(60),
  surchargeCents: cents,
});

export const dayOffSchema = z.object({
  date: isoDate,
  note: z.string().trim().max(100).default(""),
});

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
/**
 * Photos are resized in the browser before upload and sent through the
 * website, so they stay under Vercel's 4.5 MB request limit. Videos go
 * straight to Supabase Storage with a signed upload link.
 */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export type UploadCheck = { ok: true; ext: string } | { ok: false; reason: string };

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** Checks the declared type, the size and the file's magic bytes. */
export function checkUpload(
  bytes: Uint8Array,
  contentType: string,
  allowed: readonly string[],
  maxBytes: number,
): UploadCheck {
  if (!allowed.includes(contentType)) return { ok: false, reason: "That file type is not supported." };
  if (bytes.byteLength === 0) return { ok: false, reason: "The file is empty." };
  if (bytes.byteLength > maxBytes) {
    return { ok: false, reason: `Files must be under ${Math.round(maxBytes / 1024 / 1024)} MB.` };
  }
  if (!magicMatches(bytes, contentType)) return { ok: false, reason: "That file does not look like a valid image or video." };
  return { ok: true, ext: EXT[contentType] };
}

export function magicMatches(b: Uint8Array, type: string): boolean {
  const ascii = (start: number, len: number) => String.fromCharCode(...b.slice(start, start + len));
  switch (type) {
    case "image/jpeg":
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png":
      return b[0] === 0x89 && ascii(1, 3) === "PNG";
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
    case "image/heic":
    case "video/mp4":
    case "video/quicktime":
      return ascii(4, 4) === "ftyp";
    case "video/webm":
      return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    default:
      return false;
  }
}

const personFields = {
  customerName: z.string().trim().min(2, "Please enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Please enter a valid email").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9 +()-]{8,20}$/, "Please enter a valid phone number"),
};

export const waitlistRequestSchema = z.object({
  date: isoDate,
  config: cakeConfigSchema,
  dietary: z.array(z.enum(dietaryKeys)).max(4).default([]),
  ...personFields,
});
export type WaitlistRequest = z.infer<typeof waitlistRequestSchema>;

export const boxOrderRequestSchema = z.object({
  boxId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10),
  pickupDate: isoDate,
  pickupSlot: hhmm,
  marketingOptIn: z.boolean().default(false),
  acceptTerms: z.literal(true, { error: "Please accept the terms to continue" }),
  ...personFields,
});
export type BoxOrderRequest = z.infer<typeof boxOrderRequestSchema>;

export const voucherPurchaseSchema = z.object({
  amountCents: z.number().int().min(500).max(100_000),
  buyerName: personFields.customerName,
  buyerEmail: personFields.email,
  recipientName: z.string().trim().min(1, "Who is it for?").max(80),
  recipientEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email("Please enter a valid email").max(120)]).default(""),
  message: z.string().trim().max(300).default(""),
  acceptTerms: z.literal(true, { error: "Please accept the terms to continue" }),
});
export type VoucherPurchase = z.infer<typeof voucherPurchaseSchema>;

export const seasonalBoxSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).default(""),
    priceCents: z.number().int().min(100).max(100_000),
    cap: z.number().int().min(0).max(10_000),
    opensOn: isoDate,
    closesOn: isoDate,
    pickupFrom: isoDate,
    pickupTo: isoDate,
    visible: z.boolean(),
    sort: z.number().int().min(0).max(100_000).default(0),
  })
  .refine((b) => b.opensOn <= b.closesOn, { message: "Pre-orders must open before they close", path: ["closesOn"] })
  .refine((b) => b.pickupFrom <= b.pickupTo, { message: "Pickup window start must be before its end", path: ["pickupTo"] });

// Phase 3 ---------------------------------------------------------------------

export const corporateRequestSchema = z.object({
  packageId: z.string().regex(/^[a-z0-9-]{1,60}$/),
  companyName: z.string().trim().min(1, "Please enter the company name").max(120),
  abn: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, ""))
    .refine((v) => v === "" || /^[0-9]{11}$/.test(v), "An ABN has 11 digits")
    .default(""),
  contactName: personFields.customerName,
  email: personFields.email,
  phone: personFields.phone,
  notes: z.string().trim().max(1000).default(""),
  pickupDate: isoDate,
  pickupSlot: hhmm,
  acceptTerms: z.literal(true, { error: "Please accept the terms to continue" }),
});
export type CorporateRequest = z.infer<typeof corporateRequestSchema>;

export const reviewSchema = z.object({
  rating: z.number().int().min(1, "Please choose a star rating").max(5),
  text: z.string().trim().max(1500).default(""),
  consentToPublish: z.boolean().default(false),
});

const guestSchema = z.object({
  name: z.string().trim().min(1, "Please enter each guest's name").max(80),
  allergies: z.string().trim().max(300).default(""),
});

export const classBookingSchema = z
  .object({
    sessionId: z.string().uuid(),
    seats: z.number().int().min(1).max(6),
    guests: z.array(guestSchema).min(1).max(6),
    contactName: personFields.customerName,
    email: personFields.email,
    phone: personFields.phone,
    adultConfirmed: z.boolean().default(false),
    marketingOptIn: z.boolean().default(false),
    acceptTerms: z.literal(true, { error: "Please accept the terms to continue" }),
    waitlistToken: z.string().trim().max(60).default(""),
  })
  .refine((b) => b.guests.length === b.seats, { message: "Please add a name for every seat", path: ["guests"] });
export type ClassBookingRequest = z.infer<typeof classBookingSchema>;

export const classWaitlistSchema = z.object({
  sessionId: z.string().uuid(),
  seats: z.number().int().min(1).max(6),
  ...personFields,
});
export type ClassWaitlistRequest = z.infer<typeof classWaitlistSchema>;

export const privateRequestSchema = z.object({
  packageKey: z.string().regex(/^[a-z0-9-]{1,30}$/),
  guests: z.number().int().min(1).max(50),
  preferredDate: isoDate,
  preferredTime: hhmm,
  occasion: z.string().trim().max(80).default(""),
  notes: z.string().trim().max(1000).default(""),
  ...personFields,
});
export type PrivateRequestInput = z.infer<typeof privateRequestSchema>;

export const sessionSchema = z.object({
  classTypeId: z.string().regex(/^[a-z0-9-]{1,60}$/),
  date: isoDate,
  startTime: hhmm,
  seats: z.number().int().min(1).max(50),
});

export const seriesSchema = sessionSchema.extend({
  everyDays: z.union([z.literal(7), z.literal(14), z.literal(28)]),
  count: z.number().int().min(1).max(26),
});
