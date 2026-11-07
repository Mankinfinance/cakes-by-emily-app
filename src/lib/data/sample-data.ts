// SAMPLE catalogue and settings. These are placeholder prices from the
// concept demo. Emily replaces them with her real prices in /admin.
// Relative imports only: this file is also read by scripts/seed-sql.ts.

import type { CatalogueItem, Settings } from "../domain/types";

type Seed = Omit<CatalogueItem, "visible" | "sort" | "hex" | "tiers" | "priceMode" | "description"> &
  Partial<Pick<CatalogueItem, "hex" | "tiers" | "priceMode" | "description">>;

const seeds: Seed[] = [
  { id: "occ-birthday", category: "occasion", name: "Birthday", priceCents: 0, allergens: [] },
  { id: "occ-first-birthday", category: "occasion", name: "1st birthday", priceCents: 0, allergens: [] },
  { id: "occ-baby-shower", category: "occasion", name: "Baby shower", priceCents: 0, allergens: [] },
  { id: "occ-baptism", category: "occasion", name: "Baptism", priceCents: 0, allergens: [] },
  { id: "occ-engagement", category: "occasion", name: "Engagement or wedding", priceCents: 0, allergens: [] },
  { id: "occ-corporate", category: "occasion", name: "Corporate", priceCents: 0, allergens: [] },
  { id: "occ-other", category: "occasion", name: "Just because", priceCents: 0, allergens: [] },

  { id: "size-6-round", category: "size", name: '6" round', description: "Serves about 12 to 16", priceCents: 13000, tiers: 1, allergens: [] },
  { id: "size-8-round", category: "size", name: '8" round', description: "Serves about 20 to 28", priceCents: 17000, tiers: 1, allergens: [] },
  { id: "size-6-tall", category: "size", name: '6" tall', description: "Serves about 18 to 22", priceCents: 17500, tiers: 1, allergens: [] },
  { id: "size-two-tier", category: "size", name: "Two tier", description: "Serves about 35 to 45", priceCents: 34000, tiers: 2, allergens: [] },

  { id: "fl-vanilla", category: "flavour", name: "Vanilla bean", priceCents: 0, allergens: ["gluten", "egg", "dairy"] },
  { id: "fl-chocolate", category: "flavour", name: "Chocolate mud", priceCents: 0, allergens: ["gluten", "egg", "dairy", "soy"] },
  { id: "fl-red-velvet", category: "flavour", name: "Red velvet", priceCents: 0, allergens: ["gluten", "egg", "dairy"] },
  { id: "fl-lemon-raspberry", category: "flavour", name: "Lemon and raspberry", priceCents: 0, allergens: ["gluten", "egg", "dairy"] },
  { id: "fl-cookies-cream", category: "flavour", name: "Cookies and cream", priceCents: 0, allergens: ["gluten", "egg", "dairy", "soy"] },
  { id: "fl-gf-vanilla", category: "flavour", name: "Gluten-free vanilla", description: "Made with gluten-free flour", priceCents: 2000, priceMode: "per_tier", allergens: ["egg", "dairy"] },
  { id: "fl-vegan-chocolate", category: "flavour", name: "Vegan chocolate", description: "No egg or dairy", priceCents: 2000, priceMode: "per_tier", allergens: ["gluten", "soy"] },

  { id: "fin-buttercream", category: "finish", name: "Smooth buttercream", priceCents: 0, priceMode: "per_tier", allergens: ["dairy"] },
  { id: "fin-painted", category: "finish", name: "Painted buttercream", priceCents: 3500, priceMode: "per_tier", allergens: ["dairy"] },
  { id: "fin-drip", category: "finish", name: "Drip", priceCents: 2500, priceMode: "per_tier", allergens: ["dairy", "soy"] },
  { id: "fin-semi-naked", category: "finish", name: "Semi-naked", priceCents: 2000, priceMode: "per_tier", allergens: ["dairy"] },
  { id: "fin-fondant", category: "finish", name: "Fondant", priceCents: 6000, priceMode: "per_tier", allergens: ["dairy"] },

  { id: "col-blush", category: "colour", name: "Blush pink", hex: "#F2C4CE", priceCents: 0, allergens: [] },
  { id: "col-white", category: "colour", name: "Classic white", hex: "#FBF7F4", priceCents: 0, allergens: [] },
  { id: "col-sage", category: "colour", name: "Sage", hex: "#B7C9A8", priceCents: 0, allergens: [] },
  { id: "col-lilac", category: "colour", name: "Lilac", hex: "#CDB8E0", priceCents: 0, allergens: [] },
  { id: "col-baby-blue", category: "colour", name: "Baby blue", hex: "#BCD7EE", priceCents: 0, allergens: [] },
  { id: "col-butter", category: "colour", name: "Butter yellow", hex: "#F5E3A3", priceCents: 0, allergens: [] },
  { id: "col-chocolate", category: "colour", name: "Chocolate", hex: "#6B4434", priceCents: 0, allergens: [] },

  { id: "dec-fresh-flowers", category: "decoration", name: "Fresh flowers", priceCents: 2500, allergens: [] },
  { id: "dec-gold-leaf", category: "decoration", name: "Gold leaf", priceCents: 1500, allergens: [] },
  { id: "dec-macarons", category: "decoration", name: "Macarons", priceCents: 2000, allergens: ["nuts", "egg"] },
  { id: "dec-sprinkles", category: "decoration", name: "Sprinkles", priceCents: 1000, allergens: [] },
  { id: "dec-butterflies", category: "decoration", name: "Butterflies", priceCents: 1500, allergens: [] },
  { id: "dec-topper", category: "decoration", name: "Script name topper", description: "Add the name or message below", priceCents: 2000, allergens: [] },

  { id: "ext-cupcakes", category: "extra", name: "6 matching cupcakes", priceCents: 3000, allergens: ["gluten", "egg", "dairy"] },
  { id: "ext-cookies", category: "extra", name: "6 iced cookies", priceCents: 3600, allergens: ["gluten", "egg", "dairy"] },
  { id: "ext-cake-pops", category: "extra", name: "6 cake pops", priceCents: 3000, allergens: ["gluten", "egg", "dairy", "soy"] },
  { id: "ext-candles", category: "extra", name: "Gold candles", priceCents: 600, allergens: [] },
];

export const SAMPLE_CATALOGUE: CatalogueItem[] = seeds.map((s, i) => ({
  description: "",
  priceMode: "flat",
  tiers: 1,
  hex: null,
  ...s,
  visible: true,
  sort: i * 10,
}));

export const SAMPLE_SETTINGS: Settings = {
  minNoticeDays: 7,
  rushEnabled: true,
  rushFeeCents: 4000,
  rushMinDays: 2,
  dailyCap: 3,
  weeklyCap: 12,
  pickupStart: "09:00",
  pickupEnd: "16:00",
  slotMinutes: 30,
  slotCap: 2,
  depositPercent: 50,
  balanceDueDays: 4,
  changeCutoffDays: 7,
  closedWeekdays: [1],
  bookingHorizonDays: 180,
  cancellationPolicy:
    "[Emily to confirm] Deposits secure your date. Cancellations 14 or more days before pickup get the deposit back minus a $20 admin fee. Inside 14 days the deposit is not refundable. Rush and peak fees are not refundable.",
};

export const SAMPLE_PEAK_DATES = [
  { date: "2026-12-24", label: "Christmas Eve", surchargeCents: 3000 },
  { date: "2027-05-08", label: "Mother's Day weekend", surchargeCents: 3000 },
  { date: "2027-05-09", label: "Mother's Day", surchargeCents: 3000 },
];
