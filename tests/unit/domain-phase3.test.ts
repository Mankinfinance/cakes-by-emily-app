import { describe, expect, it } from "vitest";
import { SAMPLE_CATALOGUE, SAMPLE_SETTINGS } from "@/lib/data/sample-data";
import { DEFAULT_AUTOMATIONS, dueScheduledMessages, messageTimeline } from "@/lib/domain/automations";
import { belowMinimum, classIcs, classPrice, decideBy, privateEstimate, recurringDates, seatsLeft } from "@/lib/domain/classes";
import { kitchenSheet } from "@/lib/domain/kitchen";
import { priceCake } from "@/lib/domain/pricing";
import { looksLikeReferral, normalizeReferral, referralCodeFrom, referralProblem, stampCard } from "@/lib/domain/referrals";
import { monthRange, previousMonth, summarise } from "@/lib/domain/snapshot";
import type { CakeConfig, CorporateOrder, Order, Payment } from "@/lib/domain/types";
import { sanitizeConfig } from "@/lib/domain/visibility";

const S = SAMPLE_SETTINGS;
const base: CakeConfig = { occasion: "occ-birthday", size: "size-6-round", flavour: "fl-vanilla", finish: "fin-buttercream", colour: "col-blush", decorations: [], extras: [], topperText: "" };
const opts = { isRush: false, peakSurchargeCents: 0 };

describe("party add-ons, bonds, referral discounts and rewards in pricing", () => {
  it("adds add-ons and a refundable bond line", () => {
    const p = priceCake({ ...base, addons: ["add-number-candle", "add-stand-hire"] }, SAMPLE_CATALOGUE, S, opts);
    // 130 + 4 candle + 15 stand + 20 bond
    expect(p.bondCents).toBe(2000);
    expect(p.totalCents).toBe(16900);
    expect(p.lines.map((l) => l.name)).toContain("Refundable bond (stand hire)");
  });

  it("takes a referral discount off the total, never below zero", () => {
    const p = priceCake(base, SAMPLE_CATALOGUE, S, { ...opts, referralDiscountCents: 1000 });
    expect(p).toMatchObject({ referralDiscountCents: 1000, totalCents: 12000, depositCents: 6000 });
    expect(p.lines.at(-1)).toMatchObject({ category: "referral", amountCents: -1000 });
    expect(priceCake(base, SAMPLE_CATALOGUE, S, { ...opts, referralDiscountCents: 99999 }).totalCents).toBe(0);
  });

  it("adds a stamp card reward as a free line", () => {
    const p = priceCake(base, SAMPLE_CATALOGUE, S, { ...opts, stampRewardName: "6 iced cookies" });
    expect(p.lines.find((l) => l.category === "reward")).toMatchObject({ name: "Stamp card reward: 6 iced cookies", amountCents: 0 });
    expect(p.totalCents).toBe(13000);
  });

  it("drops hidden or unknown add-ons, and treats older saved designs as having none", () => {
    const hidden = SAMPLE_CATALOGUE.map((i) => (i.id === "add-sparklers" ? { ...i, visible: false } : i));
    const r = sanitizeConfig({ ...base, addons: ["add-sparklers", "add-number-candle", "nope"] }, hidden);
    expect(r.config.addons).toEqual(["add-number-candle"]);
    expect(r.removed).toEqual(["Sparkler candles (4)"]);
    expect(sanitizeConfig(base, SAMPLE_CATALOGUE).config.addons).toEqual([]);
  });
});

describe("referrals and the stamp card", () => {
  it("makes friendly codes from a first name", () => {
    let i = 0;
    const code = referralCodeFrom("  Sam Taylor ", () => i++ % 32);
    expect(code).toBe("SAM-ABCD");
    expect(referralCodeFrom("", () => 0)).toBe("CAKE-AAAA");
    expect(looksLikeReferral(" sam-abcd ")).toBe(true);
    expect(normalizeReferral(" sam-abcd ")).toBe("SAM-ABCD");
    expect(looksLikeReferral("SAM-0000")).toBe(false);
  });

  it("only lets new customers use someone else's code, once", () => {
    const ok = { enabled: true, referrerEmail: "kim@x.com", customerEmail: "sam@x.com", customerHasOrders: false, customerAlreadyReferred: false };
    expect(referralProblem(ok)).toBeNull();
    expect(referralProblem({ ...ok, enabled: false })).toBe("disabled");
    expect(referralProblem({ ...ok, referrerEmail: null })).toBe("not_found");
    expect(referralProblem({ ...ok, customerEmail: "KIM@x.com" })).toBe("own_code");
    expect(referralProblem({ ...ok, customerHasOrders: true })).toBe("not_new");
    expect(referralProblem({ ...ok, customerAlreadyReferred: true })).toBe("already_referred");
  });

  it("earns a reward every Nth collected order", () => {
    expect(stampCard(4, 0, 5)).toMatchObject({ stamps: 4, rewardsAvailable: 0 });
    expect(stampCard(5, 0, 5)).toMatchObject({ stamps: 0, rewardsEarned: 1, rewardsAvailable: 1 });
    expect(stampCard(5, 1, 5).rewardsAvailable).toBe(0);
    expect(stampCard(11, 1, 5)).toMatchObject({ stamps: 1, rewardsAvailable: 1 });
  });
});

describe("classes", () => {
  it("prices seats with the group discount from 4 seats", () => {
    expect(classPrice(9500, 3, S)).toEqual({ subtotalCents: 28500, discountCents: 0, totalCents: 28500 });
    expect(classPrice(9500, 4, S)).toEqual({ subtotalCents: 38000, discountCents: 3800, totalCents: 34200 });
    expect(classPrice(9500, 4, { ...S, groupDiscountPercent: 0 }).discountCents).toBe(0);
  });

  it("knows seats left and when a class is below its minimum", () => {
    expect(seatsLeft({ seats: 8, booked: 5 })).toBe(3);
    expect(seatsLeft({ seats: 8, booked: 9 })).toBe(0);
    expect(belowMinimum({ booked: 2, status: "scheduled" }, { minGuests: 4 })).toBe(true);
    expect(belowMinimum({ booked: 2, status: "cancelled" }, { minGuests: 4 })).toBe(false);
    expect(decideBy("2026-12-12")).toBe("2026-12-07");
  });

  it("generates recurring dates, skipping days off and closed weekdays", () => {
    const d = recurringDates("2026-11-21", 7, 4, new Set(["2026-11-28"]), [1]);
    expect(d).toEqual([
      { date: "2026-11-21", skipped: false },
      { date: "2026-11-28", skipped: true },
      { date: "2026-12-05", skipped: false },
      { date: "2026-12-12", skipped: false },
    ]);
    expect(recurringDates("2026-11-23", 14, 2, new Set(), [1]).every((x) => x.skipped)).toBe(true); // Mondays
  });

  it("estimates private groups and checks the group size", () => {
    const deluxe = S.privatePackages.find((p) => p.key === "deluxe")!;
    expect(privateEstimate(deluxe, 8)).toEqual({ totalCents: 96000, depositCents: 15000, ok: true });
    expect(privateEstimate(deluxe, 11).ok).toBe(false);
    const kids = S.privatePackages.find((p) => p.key === "kids")!;
    expect(privateEstimate(kids, 6)).toEqual({ totalCents: 30000, depositCents: 10000, ok: true });
  });

  it("writes a valid calendar file in Sydney time", () => {
    const ics = classIcs({ uid: "b1@x", title: "Florals, BYO", date: "2026-11-21", startTime: "14:00", durationMinutes: 150, location: "Grasmere NSW", description: "2 seats", stamp: new Date("2026-11-08T00:00:00Z") });
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("DTSTART;TZID=Australia/Sydney:20261121T140000");
    expect(ics).toContain("DTEND;TZID=Australia/Sydney:20261121T163000");
    expect(ics).toContain("SUMMARY:Florals\\, BYO");
    expect(ics).toContain("DTSTAMP:20261108T000000Z");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

function order(over: Partial<Order>): Order {
  return {
    id: "o",
    reference: "CBE-AAAAA",
    tokenHash: "h",
    stage: "received",
    customerName: "Sam Taylor",
    email: "sam@x.com",
    phone: "0400000000",
    marketingOptIn: false,
    pickupDate: "2026-11-20",
    pickupSlot: "10:00",
    config: base,
    allergyNotes: "",
    notes: "",
    inspirationPath: null,
    items: [],
    subtotalCents: 13000,
    rushFeeCents: 0,
    peakSurchargeCents: 0,
    totalCents: 13000,
    depositCents: 6500,
    amountPaidCents: 6500,
    isRush: false,
    termsAcceptedAt: "",
    createdAt: "2026-11-02T01:00:00Z",
    remindersSent: [],
    dietary: [],
    remindNextYear: false,
    dateChangesUsed: 0,
    designChangesUsed: 0,
    approvedAt: null,
    voucherId: null,
    voucherAppliedCents: 0,
    waitlistId: null,
    kitchenDone: false,
    cancellation: null,
    referralCode: null,
    stampReward: false,
    ...over,
  };
}

describe("stand hire return reminder", () => {
  it("is only for orders with a bond, after collection", () => {
    const withStand = order({ stage: "collected", items: [{ itemId: null, category: "bond", name: "Bond", amountCents: 2000 }], amountPaidCents: 13000 });
    expect(dueScheduledMessages(withStand, DEFAULT_AUTOMATIONS, ["thank_you"], "2026-11-23")).toEqual(["stand_return"]);
    expect(dueScheduledMessages({ ...withStand, items: [] }, DEFAULT_AUTOMATIONS, ["thank_you"], "2026-11-23")).toEqual([]);
    expect(messageTimeline(withStand, DEFAULT_AUTOMATIONS, []).some((t) => t.key === "stand_return")).toBe(true);
  });
});

describe("kitchen sheet with corporate orders", () => {
  it("lists confirmed corporate orders with their logo note", () => {
    const corp: CorporateOrder = {
      id: "c1",
      reference: "CORP-AAAAA",
      tokenHash: "h",
      packageId: "corp-cookies-24",
      packageName: "Logo cookies x 24",
      quantity: 24,
      totalCents: 18000,
      depositCents: 9000,
      amountPaidCents: 9000,
      companyName: "Acme",
      abn: "",
      contactName: "Pat Lee",
      email: "p@x.com",
      phone: "0400000000",
      logoPath: "corporate/c1/logo.png",
      notes: "Blue and white",
      pickupDate: "2026-11-20",
      pickupSlot: "09:00",
      status: "confirmed",
      kitchenDone: false,
      termsAcceptedAt: "",
      createdAt: "",
    };
    const days = kitchenSheet([], [], "2026-11-20", "2026-11-20", [corp, { ...corp, id: "c2", reference: "CORP-BBBBB", status: "awaiting_payment" }]);
    expect(days[0].lines).toHaveLength(1);
    expect(days[0].lines[0]).toMatchObject({ kind: "corporate", company: "Acme", hasLogo: true });
  });
});

describe("sales snapshot maths", () => {
  const sydney = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date(iso));
  const items = (flavour: string) => [
    { itemId: null, category: "flavour", name: flavour, amountCents: 0 },
    { itemId: null, category: "finish", name: "Drip", amountCents: 2500 },
    { itemId: null, category: "occasion", name: "Birthday", amountCents: 0 },
  ];

  it("counts booked orders in the month, deposits taken and top choices", () => {
    const orders = [
      order({ id: "a", totalCents: 20000, createdAt: "2026-11-02T01:00:00Z", items: items("Vanilla bean") }),
      order({ id: "b", totalCents: 10000, createdAt: "2026-11-05T01:00:00Z", items: items("Chocolate mud") }),
      order({ id: "c", totalCents: 30000, createdAt: "2026-11-06T01:00:00Z", items: items("Vanilla bean") }),
      order({ id: "d", totalCents: 99900, createdAt: "2026-11-06T01:00:00Z", stage: "cancelled" }),
      order({ id: "e", totalCents: 99900, createdAt: "2026-10-30T12:00:00Z" }), // 30 Oct 11pm Sydney
    ];
    const payments: Payment[] = [
      { id: "1", orderId: "a", boxOrderId: null, voucherId: null, kind: "deposit", amountCents: 10000, stripeSessionId: "s1", status: "paid", createdAt: "2026-11-02T01:00:00Z" },
      { id: "2", orderId: "b", boxOrderId: null, voucherId: null, kind: "deposit", amountCents: 5000, stripeSessionId: "s2", status: "pending", createdAt: "2026-11-05T01:00:00Z" },
      { id: "3", orderId: "a", boxOrderId: null, voucherId: null, kind: "balance", amountCents: 10000, stripeSessionId: "s3", status: "paid", createdAt: "2026-11-07T01:00:00Z" },
    ];
    const { from, to } = monthRange("2026-11");
    const s = summarise(orders, payments, from, to, sydney);
    expect(s).toMatchObject({ orders: 3, revenueCents: 60000, depositsCents: 10000, averageCents: 20000 });
    expect(s.topFlavours).toEqual([
      { name: "Vanilla bean", count: 2 },
      { name: "Chocolate mud", count: 1 },
    ]);
    expect(monthRange("2027-02")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(previousMonth("2027-01")).toBe("2026-12");
  });
});
