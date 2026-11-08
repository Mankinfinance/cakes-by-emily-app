import { describe, expect, it } from "vitest";
import { SAMPLE_SETTINGS } from "@/lib/data/sample-data";
import { placeholderParts, privacyDocument, privateDeposits, termsDocument, type LegalDocument } from "@/lib/domain/legal";
import { reduceGuestsQuote } from "@/lib/domain/private-reduce";
import type { PrivateGuest } from "@/lib/domain/types";

const ctx = {
  businessName: "Cakes by Emily",
  siteName: "Layered by Cakes by Emily",
  suburb: "Grasmere",
  instagram: "_cakes_by_emily_",
  classMinGuests: 4,
  privateDepositCents: 15000,
  kidsDepositCents: 10000,
};
const text = (d: LegalDocument) => [d.title, d.intro, ...d.sections.flatMap((s) => [s.heading, ...(s.paras ?? []), ...(s.bullets ?? [])])].join("\n");

describe("draft terms and privacy", () => {
  it("fills every setting-backed number from the settings", () => {
    const t = text(termsDocument(SAMPLE_SETTINGS, ctx));
    expect(t).toContain("deposit of 50% of the order total");
    expect(t).toContain("The balance is due 4 days before pickup");
    expect(t).toContain("at least 7 days' notice");
    expect(t).toContain("rush fee of $40");
    expect(t).toContain("1 free round of changes");
    expect(t).toContain("14 days or more before pickup: your deposit is refunded, less an admin fee of $20.");
    expect(t).toContain("7 to 13 days before pickup: your deposit is kept as credit, valid for 12 months.");
    expect(t).toContain("Gift vouchers are valid for 12 months");
    expect(t).toContain("Class passes include 3 class seats and are valid for 12 months.");
    expect(t).toContain("7 days or more before, full refund; 3 to 6 days before, credit; less than 3 days before, no refund.");
    expect(t).toContain("at least 4 guests to run");
    expect(t).toContain("deposit of $150 ($100 for kids' parties)");
    expect(t).toContain("by 7 days before the class");
  });

  it("changes when the settings change", () => {
    const t = text(
      termsDocument({ ...SAMPLE_SETTINGS, depositPercent: 30, rushFeeCents: 5500, cancelAdminFeeCents: 2500, classFullRefundDays: 10, splitDueDays: 5, freeDesignChangeRounds: 2 }, { ...ctx, classMinGuests: 5 }),
    );
    expect(t).toContain("deposit of 30%");
    expect(t).toContain("rush fee of $55");
    expect(t).toContain("admin fee of $25");
    expect(t).toContain("10 days or more before, full refund; 3 to 9 days before, credit");
    expect(t).toContain("by 5 days before the class");
    expect(t).toContain("2 free rounds of changes");
    expect(t).toContain("at least 5 guests");
    expect(t).not.toContain("deposit of 50%");
  });

  it("keeps the placeholders Emily still has to fill in", () => {
    const t = text(termsDocument(SAMPLE_SETTINGS, ctx));
    for (const p of ["[Emily's ABN]", "[email]", "[GST:", "[Delivery:", "[date]"]) expect(t).toContain(p);
    const p = text(privacyDocument(ctx));
    expect(p).toContain("[Emily to confirm, often 5 to 7 years]");
    expect(p).toContain("Stripe (payments), Supabase (secure order storage), Resend (email) and Vercel (website hosting)");
  });

  it("uses no em dashes", () => {
    expect(text(termsDocument(SAMPLE_SETTINGS, ctx))).not.toMatch(/\u2014/);
    expect(text(privacyDocument(ctx))).not.toMatch(/\u2014/);
  });

  it("splits placeholders out for styling", () => {
    expect(placeholderParts("ABN: [Emily's ABN]. Thanks")).toEqual([
      { text: "ABN: ", placeholder: false },
      { text: "[Emily's ABN]", placeholder: true },
      { text: ". Thanks", placeholder: false },
    ]);
    expect(placeholderParts("none")).toEqual([{ text: "none", placeholder: false }]);
  });

  it("reads the private deposits from the packages", () => {
    expect(privateDeposits(SAMPLE_SETTINGS.privatePackages)).toEqual({ adult: 15000, kids: 10000 });
  });
});

const g = (slot: number, over: Partial<PrivateGuest> = {}): PrivateGuest => ({
  id: `g${slot}`,
  requestId: "r",
  slot,
  name: "",
  email: "",
  allergies: "",
  dietary: [],
  messageOptIn: false,
  shareCents: 10125,
  status: "open",
  holdKey: null,
  holdUntil: null,
  paidAt: null,
  detailsAt: null,
  ...over,
});
const req = { status: "paid" as const, guests: 8, perPersonCents: 12000, depositCents: 15000 };
const terms = { classFullRefundDays: 7, classCreditDays: 3 };
const NOW = "2026-11-08T00:00:00.000Z";

describe("fewer private guests quote", () => {
  it("removes empty places first, then unpaid guests, and shares out what's left", () => {
    const guests = [g(1, { name: "A", status: "paid" }), g(2, { name: "B" }), g(3), g(4), g(5), g(6), g(7), g(8, { name: "H" })];
    const q = reduceGuestsQuote(req, guests, 6, 6, terms, 20, { by: "organiser", nowIso: NOW });
    expect(q.ok).toBe(true);
    expect(q.removeOpenIds).toEqual(["g7", "g6"]);
    // $720 - $150 - $101.25 = $468.75 across 5 places.
    expect(q.shareUpdates.reduce((s, u) => s + u.shareCents, 0)).toBe(46875);
    expect(q.shareUpdates).toHaveLength(5);
    expect(q.refundCents).toBe(0);
  });

  it("refunds, credits or keeps paid places by the class terms window", () => {
    const allPaid = Array.from({ length: 8 }, (_, i) => g(i + 1, { name: `P${i + 1}`, status: "paid" }));
    const full = reduceGuestsQuote(req, allPaid, 7, 6, terms, 10, { by: "emily", nowIso: NOW });
    expect(full).toMatchObject({ window: "full", refundCents: 10125 + 1875, creditCents: 0 });
    expect(full.removePaid.map((p) => p.name)).toEqual(["P8"]);
    const credit = reduceGuestsQuote(req, allPaid, 7, 6, terms, 5, { by: "emily", nowIso: NOW });
    expect(credit).toMatchObject({ window: "credit", refundCents: 0, creditCents: 10125 + 1875 });
    const none = reduceGuestsQuote(req, allPaid, 7, 6, terms, 2, { by: "emily", nowIso: NOW });
    expect(none).toMatchObject({ window: "none", refundCents: 0, creditCents: 0, keptCents: 10125 + 1875 });
    const waived = reduceGuestsQuote(req, allPaid, 7, 6, terms, 2, { by: "emily", waive: true, nowIso: NOW });
    expect(waived).toMatchObject({ window: "full", refundCents: 10125 + 1875, waived: true });
    // Only Emily can waive.
    expect(reduceGuestsQuote(req, allPaid, 7, 6, terms, 2, { by: "organiser", waive: true, nowIso: NOW }).waived).toBe(false);
  });

  it("refuses below the minimum, at or above the current count, on the day, or mid-checkout", () => {
    const guests = Array.from({ length: 8 }, (_, i) => g(i + 1));
    expect(reduceGuestsQuote(req, guests, 5, 6, terms, 20, { by: "emily", nowIso: NOW }).problem).toMatch(/at least 6/);
    expect(reduceGuestsQuote(req, guests, 8, 6, terms, 20, { by: "emily", nowIso: NOW }).problem).toMatch(/fewer than 8/);
    expect(reduceGuestsQuote(req, guests, 6, 6, terms, 0, { by: "emily", nowIso: NOW }).problem).toMatch(/on the day/);
    const held = guests.map((x, i) => (i === 0 ? { ...x, holdKey: "k", holdUntil: "2026-11-08T00:10:00.000Z" } : x));
    expect(reduceGuestsQuote(req, held, 6, 6, terms, 20, { by: "emily", nowIso: NOW }).problem).toMatch(/paying right now/);
    expect(reduceGuestsQuote({ ...req, status: "accepted" as never }, guests, 6, 6, terms, 20, { by: "emily", nowIso: NOW }).problem).toMatch(/deposit is paid/);
  });

  it("gives pass credits back unless inside the no-refund window, and vouchers always", () => {
    const guests = [
      ...Array.from({ length: 6 }, (_, i) => g(i + 1, { name: `P${i + 1}`, status: "paid" })),
      g(7, { name: "V", status: "paid", voucherId: "v1", voucherAppliedCents: 5000 }),
      g(8, { name: "S", status: "paid", passId: "p1", passAppliedCents: 8500 }),
    ];
    const q = reduceGuestsQuote(req, guests, 6, 6, terms, 10, { by: "emily", nowIso: NOW });
    expect(q.removePaid.map((p) => [p.name, p.cashCents, p.returnVoucher, p.returnPass])).toEqual([
      ["S", 10125 - 8500, false, true],
      ["V", 10125 - 5000, true, false],
    ]);
    const late = reduceGuestsQuote(req, guests, 6, 6, terms, 1, { by: "emily", nowIso: NOW });
    expect(late.removePaid.find((p) => p.name === "S")!.returnPass).toBe(false);
    expect(late.removePaid.find((p) => p.name === "V")!.returnVoucher).toBe(true);
  });

  it("ignores places that were already removed", () => {
    const guests = [...Array.from({ length: 8 }, (_, i) => g(i + 1)), g(9, { status: "removed" })];
    expect(reduceGuestsQuote(req, guests, 6, 6, terms, 20, { by: "emily", nowIso: NOW }).ok).toBe(true);
  });
});
