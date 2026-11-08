// SAMPLE catalogue and settings. These are placeholder prices from the
// concept demo. Emily replaces them with her real prices in /admin.
// Relative imports only: this file is also read by scripts/seed-sql.ts.

import type { Automation, CatalogueItem, ClassType, CorporatePackage, SeasonalBox, Settings } from "../domain/types";

type Seed = Omit<CatalogueItem, "visible" | "sort" | "hex" | "tiers" | "priceMode" | "description" | "bondCents"> &
  Partial<Pick<CatalogueItem, "hex" | "tiers" | "priceMode" | "description" | "bondCents">>;

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

  // Phase 3: party add-ons offered at checkout.
  { id: "add-number-candle", category: "addon", name: "Number candle", priceCents: 400, allergens: [] },
  { id: "add-sparklers", category: "addon", name: "Sparkler candles (4)", priceCents: 800, allergens: [] },
  { id: "add-box-upgrade", category: "addon", name: "Gift box upgrade", description: "A sturdy window box with a ribbon", priceCents: 600, allergens: [] },
  {
    id: "add-stand-hire",
    category: "addon",
    name: "Cake stand hire",
    description: "Return within 7 days to get the bond back",
    priceCents: 1500,
    bondCents: 2000,
    allergens: [],
  },
];

export const SAMPLE_CATALOGUE: CatalogueItem[] = seeds.map((s, i) => ({
  description: "",
  priceMode: "flat",
  tiers: 1,
  hex: null,
  bondCents: 0,
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
  cancellationPolicy: "[Emily to confirm these terms before launch.]",
  freeDesignChangeRounds: 1,
  freeDateChanges: 1,
  cancelFullRefundDays: 14,
  cancelAdminFeeCents: 2000,
  cancelCreditDays: 7,
  voucherValidMonths: 12,
  voucherOptions: [
    { cents: 5000, visible: true },
    { cents: 10000, visible: true },
    { cents: 15000, visible: true },
    { cents: 20000, visible: true },
  ],
  voucherCustomEnabled: true,
  voucherCustomMinCents: 2000,
  voucherCustomMaxCents: 50000,
  reviewUrl: "",
  referralsEnabled: true,
  referralGiveCents: 1000,
  referralGetCents: 1000,
  stampsEnabled: true,
  stampEvery: 5,
  stampRewardName: "6 iced cookies",
  groupDiscountMinSeats: 4,
  groupDiscountPercent: 10,
  classBlocksCakes: true,
  privatePackages: [
    { key: "classic", name: "Classic", includes: "The class and a take-home cake each", perPersonCents: 9000, depositCents: 15000, minGuests: 6, maxGuests: 10, kids: false, visible: true },
    { key: "deluxe", name: "Deluxe", includes: "Classic plus a grazing platter and decorated cookie favours", perPersonCents: 12000, depositCents: 15000, minGuests: 6, maxGuests: 10, kids: false, visible: true },
    { key: "ultimate", name: "Ultimate", includes: "Deluxe plus a custom celebration cake for the guest of honour", perPersonCents: 15000, depositCents: 15000, minGuests: 6, maxGuests: 10, kids: false, visible: true },
    { key: "kids", name: "Kids' cupcake party", includes: "1.5 hours of cupcake decorating, a parent or guardian stays", perPersonCents: 5000, depositCents: 10000, minGuests: 6, maxGuests: 10, kids: true, visible: true },
  ],
};

export const SAMPLE_AUTOMATIONS: Automation[] = [
  { key: "order_received", enabled: true, days: 0 },
  { key: "design_confirmed", enabled: true, days: 0 },
  { key: "balance_reminder", enabled: true, days: 4 },
  { key: "pickup_details", enabled: true, days: 1 },
  { key: "thank_you", enabled: true, days: 1 },
  { key: "rebook_reminder", enabled: true, days: 335 },
  { key: "stand_return", enabled: true, days: 3 },
  { key: "class_reminder", enabled: true, days: 1 },
  { key: "class_thank_you", enabled: true, days: 1 },
];

/** SAMPLE corporate packages: logo cookies and cupcakes in set quantities. */
export const SAMPLE_CORPORATE: CorporatePackage[] = [
  { id: "corp-cookies-24", product: "cookies", name: "Logo cookies x 24", quantity: 24, priceCents: 18000, visible: true, sort: 10 },
  { id: "corp-cookies-48", product: "cookies", name: "Logo cookies x 48", quantity: 48, priceCents: 33600, visible: true, sort: 20 },
  { id: "corp-cookies-96", product: "cookies", name: "Logo cookies x 96", quantity: 96, priceCents: 62400, visible: true, sort: 30 },
  { id: "corp-cupcakes-24", product: "cupcakes", name: "Logo cupcakes x 24", quantity: 24, priceCents: 11400, visible: true, sort: 40 },
  { id: "corp-cupcakes-48", product: "cupcakes", name: "Logo cupcakes x 48", quantity: 48, priceCents: 21600, visible: true, sort: 50 },
  { id: "corp-cupcakes-96", product: "cupcakes", name: "Logo cupcakes x 96", quantity: 96, priceCents: 40800, visible: true, sort: 60 },
];

/** SAMPLE Cake and Sip class types. */
export const SAMPLE_CLASS_TYPES: ClassType[] = [
  {
    id: "class-florals",
    name: "Cake and Sip: Buttercream Florals",
    description: "Pipe buttercream flowers and decorate a 6 inch cake to take home. BYO drinks. [Sample]",
    level: "Beginner",
    priceCents: 9500,
    durationMinutes: 150,
    defaultSeats: 8,
    minGuests: 4,
    isSip: true,
    ageNote: "18+",
    visible: true,
    sort: 10,
  },
  {
    id: "class-drip",
    name: "Cake and Sip: Drip Cakes",
    description: "Master the perfect drip and stack your toppings. BYO drinks. [Sample]",
    level: "Intermediate",
    priceCents: 9500,
    durationMinutes: 150,
    defaultSeats: 8,
    minGuests: 4,
    isSip: true,
    ageNote: "18+",
    visible: true,
    sort: 20,
  },
  {
    id: "class-kids",
    name: "Kids' Cupcake Class",
    description: "Decorate six cupcakes with buttercream and sprinkles. A parent or guardian stays. [Sample]",
    level: "All levels",
    priceCents: 5500,
    durationMinutes: 90,
    defaultSeats: 8,
    minGuests: 4,
    isSip: false,
    ageNote: "Ages 6 to 12",
    visible: true,
    sort: 30,
  },
];

/** SAMPLE seasonal boxes. Prices, caps and dates are placeholders for Emily to change. */
export const SAMPLE_BOXES: SeasonalBox[] = [
  {
    id: "b0000000-0000-4000-8000-000000000001",
    name: "Christmas cookie box",
    description: "12 hand-iced Christmas cookies in a gift box. [Sample]",
    priceCents: 4500,
    cap: 40,
    sold: 0,
    opensOn: "2026-11-01",
    closesOn: "2026-12-14",
    pickupFrom: "2026-12-18",
    pickupTo: "2026-12-23",
    photoPath: null,
    visible: true,
    sort: 10,
  },
  {
    id: "b0000000-0000-4000-8000-000000000002",
    name: "Teacher gift box",
    description: "6 iced cookies and a thank-you tag for the end of the school year. [Sample]",
    priceCents: 3800,
    cap: 30,
    sold: 0,
    opensOn: "2026-11-01",
    closesOn: "2026-12-07",
    pickupFrom: "2026-12-10",
    pickupTo: "2026-12-17",
    photoPath: null,
    visible: true,
    sort: 20,
  },
  {
    id: "b0000000-0000-4000-8000-000000000003",
    name: "Mother's Day box",
    description: "Cupcakes, cookies and a mini cake for Mum. [Sample]",
    priceCents: 6500,
    cap: 25,
    sold: 0,
    opensOn: "2027-04-01",
    closesOn: "2027-05-03",
    pickupFrom: "2027-05-07",
    pickupTo: "2027-05-09",
    photoPath: null,
    visible: true,
    sort: 30,
  },
];

export const SAMPLE_PEAK_DATES = [
  { date: "2026-12-24", label: "Christmas Eve", surchargeCents: 3000 },
  { date: "2027-05-08", label: "Mother's Day weekend", surchargeCents: 3000 },
  { date: "2027-05-09", label: "Mother's Day", surchargeCents: 3000 },
];
