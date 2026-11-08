import { describe, expect, it } from "vitest";
import { SAMPLE_SETTINGS } from "@/lib/data/sample-data";
import { classCancellationOutcome, classPriceWithPass } from "@/lib/domain/classes";
import { allocateRefund, refundKey } from "@/lib/domain/refunds";
import { canNudge, holdable, organiserCanPayRest, shareAmounts, shareDueDate, splitProgress } from "@/lib/domain/split";
import type { PrivateGuest } from "@/lib/domain/types";

const S = SAMPLE_SETTINGS;

describe("refund allocation across payments", () => {
  const deposit = { id: "dep", amountCents: 8800, refundedCents: 0, createdAt: "2026-11-01T00:00:00Z" };
  const balance = { id: "bal", amountCents: 8700, refundedCents: 0, createdAt: "2026-11-15T00:00:00Z" };

  it("refunds the newest payment first, then the older one", () => {
    expect(allocateRefund([deposit, balance], 10000)).toEqual({
      slices: [
        { paymentId: "bal", cents: 8700 },
        { paymentId: "dep", cents: 1300 },
      ],
      unallocated: 0,
    });
    expect(allocateRefund([deposit, balance], 5000).slices).toEqual([{ paymentId: "bal", cents: 5000 }]);
  });

  it("skips what was already refunded and reports any shortfall", () => {
    const partly = { ...balance, refundedCents: 8000 };
    expect(allocateRefund([deposit, partly], 2000).slices).toEqual([
      { paymentId: "bal", cents: 700 },
      { paymentId: "dep", cents: 1300 },
    ]);
    expect(allocateRefund([deposit, balance], 20000)).toMatchObject({ unallocated: 2500 });
    expect(allocateRefund([], 500)).toEqual({ slices: [], unallocated: 500 });
    expect(allocateRefund([deposit], 0).slices).toEqual([]);
  });

  it("splits across many guest shares", () => {
    const shares = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, amountCents: 7000, refundedCents: 0, createdAt: `2026-11-0${i + 1}T00:00:00Z` }));
    const r = allocateRefund([deposit, ...shares], 30000);
    expect(r.slices.map((x) => x.paymentId)).toEqual(["s3", "s2", "s1", "s0", "dep"]);
    expect(r.slices.reduce((s, x) => s + x.cents, 0)).toBe(30000);
  });

  it("builds stable idempotency keys", () => {
    expect(refundKey("p1", "cancel-emily", 500)).toBe("refund-p1-cancel-emily-500");
    expect(refundKey("p1", "cancel-emily", 500)).toBe(refundKey("p1", "cancel-emily", 500));
  });
});

describe("split payments", () => {
  it("divides the balance evenly, with leftover cents on the first share", () => {
    expect(shareAmounts(96000, 15000, 8)).toEqual(Array(8).fill(10125));
    expect(shareAmounts(10000, 0, 3)).toEqual([3334, 3333, 3333]);
    expect(shareAmounts(10000, 15000, 2)).toEqual([0, 0]);
  });

  const g = (over: Partial<PrivateGuest>): PrivateGuest => ({
    id: "g",
    requestId: "r",
    slot: 1,
    name: "",
    email: "",
    allergies: "",
    dietary: [],
    messageOptIn: false,
    shareCents: 10000,
    status: "open",
    holdKey: null,
    holdUntil: null,
    paidAt: null,
    detailsAt: null,
    ...over,
  });

  it("tracks who has paid, by name only", () => {
    const p = splitProgress([g({ name: "Ann", status: "paid", allergies: "Nuts" }), g({ name: "Bo", slot: 2 }), g({ slot: 3 })]);
    expect(p).toMatchObject({ guests: 3, paid: 1, detailsIn: 2, paidCents: 10000, owingCents: 20000, paidNames: ["Ann"], waitingNames: ["Bo"] });
    expect(JSON.stringify(p)).not.toContain("Nuts");
  });

  it("knows when a share can be held, and when the organiser can pay the rest", () => {
    const now = "2026-11-08T00:00:00Z";
    expect(holdable(g({}), now)).toBe(true);
    expect(holdable(g({ holdKey: "k", holdUntil: "2026-11-08T00:10:00Z" }), now)).toBe(false);
    expect(holdable(g({ holdKey: "k", holdUntil: "2026-11-07T23:00:00Z" }), now)).toBe(true);
    expect(holdable(g({ status: "paid" }), now)).toBe(false);
    const due = shareDueDate({ preferredDate: "2026-12-12" }, 7);
    expect(due).toBe("2026-12-05");
    const progress = splitProgress([g({ status: "paid" }), g({ slot: 2 })]);
    expect(organiserCanPayRest("2026-12-04", due, progress)).toBe(false);
    expect(organiserCanPayRest("2026-12-05", due, progress)).toBe(true);
    expect(organiserCanPayRest("2026-12-05", due, splitProgress([g({ status: "paid" })]))).toBe(false);
  });

  it("limits reminder nudges to one a day", () => {
    const now = new Date("2026-11-08T12:00:00Z");
    expect(canNudge(null, now)).toBe(true);
    expect(canNudge("2026-11-08T01:00:00Z", now)).toBe(false);
    expect(canNudge("2026-11-07T11:59:00Z", now)).toBe(true);
  });
});

describe("class pass pricing", () => {
  it("covers whole seats, with the group discount on the seats still paid for", () => {
    expect(classPriceWithPass(9500, 2, 3, S)).toEqual({ subtotalCents: 0, discountCents: 0, totalCents: 0, creditsUsed: 2 });
    expect(classPriceWithPass(9500, 3, 1, S)).toEqual({ subtotalCents: 19000, discountCents: 0, totalCents: 19000, creditsUsed: 1 });
    // 4 seats keeps the group discount on the 2 paid seats.
    expect(classPriceWithPass(9500, 4, 2, S)).toEqual({ subtotalCents: 19000, discountCents: 1900, totalCents: 17100, creditsUsed: 2 });
    expect(classPriceWithPass(9500, 2, 0, S).totalCents).toBe(19000);
  });
});

describe("class cancellation terms", () => {
  const b = { amountPaidCents: 19000, voucherAppliedCents: 2000, passCredits: 1 };

  it("refunds in full 7 or more days out, with pass credits and voucher back", () => {
    const r = classCancellationOutcome(b, S, 10);
    expect(r).toMatchObject({ window: "full", refundCents: 19000, creditCents: 0, voucherReturnedCents: 2000, passCreditsReturned: 1 });
    expect(classCancellationOutcome(b, S, 7).window).toBe("full");
  });

  it("turns what was paid into credit 3 to 6 days out", () => {
    expect(classCancellationOutcome(b, S, 6)).toMatchObject({ window: "credit", refundCents: 0, creditCents: 19000, passCreditsReturned: 1 });
    expect(classCancellationOutcome(b, S, 3).window).toBe("credit");
  });

  it("gives nothing back inside 3 days, except the voucher", () => {
    const r = classCancellationOutcome(b, S, 2);
    expect(r).toMatchObject({ window: "none", refundCents: 0, creditCents: 0, keptCents: 19000, passCreditsReturned: 0, voucherReturnedCents: 2000 });
    expect(r.summary).toContain("class pass credits aren't returned");
  });

  it("refunds everything when Emily cancels", () => {
    expect(classCancellationOutcome(b, S, 1, "emily")).toMatchObject({ window: "emily", refundCents: 19000, passCreditsReturned: 1, voucherReturnedCents: 2000 });
  });

  it("follows Emily's settings", () => {
    expect(classCancellationOutcome(b, { classFullRefundDays: 14, classCreditDays: 7 }, 10).window).toBe("credit");
  });
});
