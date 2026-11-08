import { describe, expect, it } from "vitest";
import { allergyChanged, guestCanEdit, guestEditDeadline, passCreditValue, shareCodeProblem, shareOwed } from "@/lib/domain/guests";
import { partialCancelQuote } from "@/lib/domain/partial-cancel";
import { overall, safeHost, setupChecks, stripeKeyMode, type SetupFacts } from "@/lib/domain/setup";
import { splitProgress } from "@/lib/domain/split";
import type { ClassBooking, PrivateGuest } from "@/lib/domain/types";
import { nextMonths, orderTokenFromUrl, pickDateAndSlot, resultsTable, sessionIdFromCheckoutUrl, smokeExitCode, smokeGuard, smokeOrderPayload } from "@/lib/smoke";
import { orderRequestSchema } from "@/lib/validation";

const TERMS = { groupDiscountMinSeats: 4, groupDiscountPercent: 10, classFullRefundDays: 7, classCreditDays: 3 };

function booking(over: Partial<ClassBooking> = {}): Pick<ClassBooking, "seats" | "guests" | "unitPriceCents" | "discountCents" | "totalCents" | "amountPaidCents" | "voucherAppliedCents" | "passCredits" | "status"> {
  const seats = over.seats ?? 4;
  return {
    seats,
    guests: Array.from({ length: seats }, (_, i) => ({ name: `G${i + 1}`, allergies: "", checkedIn: false })),
    unitPriceCents: 9500,
    discountCents: 3800,
    totalCents: 34200,
    amountPaidCents: 34200,
    voucherAppliedCents: 0,
    passCredits: 0,
    status: "paid",
    ...over,
  };
}

function guest(over: Partial<PrivateGuest> = {}): PrivateGuest {
  return {
    id: "g1",
    requestId: "r1",
    slot: 1,
    name: "Ana",
    email: "ana@example.com",
    allergies: "",
    dietary: [],
    messageOptIn: false,
    shareCents: 9500,
    status: "open",
    holdKey: null,
    holdUntil: null,
    paidAt: null,
    detailsAt: null,
    ...over,
  };
}

describe("guests changing their details", () => {
  it("closes the day the cut-off starts", () => {
    expect(guestEditDeadline("2026-12-12", 2)).toBe("2026-12-10");
    expect(guestCanEdit("2026-12-12", "2026-12-10", 2)).toBe(true);
    expect(guestCanEdit("2026-12-12", "2026-12-11", 2)).toBe(false);
    expect(guestCanEdit("2026-12-12", "2026-12-12", 0)).toBe(false);
    expect(guestCanEdit("2026-12-12", "2026-12-11", 0)).toBe(true);
  });

  it("spots allergy and dietary changes, ignoring order and spaces", () => {
    expect(allergyChanged({ allergies: "nuts", dietary: ["egg-free", "nut-free"] }, { allergies: " nuts ", dietary: ["nut-free", "egg-free"] })).toBe(false);
    expect(allergyChanged({ allergies: "nuts", dietary: [] }, { allergies: "nuts, sesame", dietary: [] })).toBe(true);
    expect(allergyChanged({ allergies: "", dietary: [] }, { allergies: "", dietary: ["dairy-free"] })).toBe(true);
  });
});

describe("codes on private class shares", () => {
  it("values a pass credit at what the pass cost per credit", () => {
    expect(passCreditValue(25500, 3)).toBe(8500);
    expect(passCreditValue(10000, 3)).toBe(3333);
    expect(passCreditValue(10000, 0)).toBe(10000);
  });

  it("works out what's left to pay, never below zero", () => {
    expect(shareOwed(guest())).toBe(9500);
    expect(shareOwed(guest({ voucherAppliedCents: 2000 }))).toBe(7500);
    expect(shareOwed(guest({ passAppliedCents: 8500 }))).toBe(1000);
    expect(shareOwed(guest({ voucherAppliedCents: 9500 }))).toBe(0);
  });

  it("takes one code per open share, and not while it's being paid", () => {
    const now = "2026-11-08T00:00:00.000Z";
    expect(shareCodeProblem(guest(), now)).toBeNull();
    expect(shareCodeProblem(guest({ status: "paid" }), now)).toMatch(/already paid/);
    expect(shareCodeProblem(guest({ voucherId: "v" }), now)).toMatch(/already applied/);
    expect(shareCodeProblem(guest({ passId: "p" }), now)).toMatch(/already applied/);
    expect(shareCodeProblem(guest({ holdKey: "k", holdUntil: "2026-11-08T00:10:00.000Z" }), now)).toMatch(/being paid/);
    expect(shareCodeProblem(guest({ holdKey: "k", holdUntil: "2026-11-07T23:00:00.000Z" }), now)).toBeNull();
  });

  it("counts only what's still owed in the organiser's tracker", () => {
    const p = splitProgress([guest({ voucherAppliedCents: 5000 }), guest({ id: "g2", slot: 2, status: "paid" })]);
    expect(p.owingCents).toBe(4500);
    expect(p.paidCents).toBe(9500);
  });
});

describe("cancelling some seats", () => {
  it("re-prices the seats left and drops the group discount below the threshold", () => {
    // 4 seats with 10% off = $342. Cancel 1: 3 seats, no discount = $285. $57 back.
    const q = partialCancelQuote(booking(), [3], TERMS, 10);
    expect(q.ok).toBe(true);
    expect(q.window).toBe("full");
    expect(q.seatsLeft).toBe(3);
    expect(q.newTotalCents).toBe(28500);
    expect(q.newDiscountCents).toBe(0);
    expect(q.discountLost).toBe(true);
    expect(q.reductionCents).toBe(5700);
    expect(q.refundCents).toBe(5700);
    expect(q.creditCents).toBe(0);
    expect(q.guestNames).toEqual(["G4"]);
    expect(q.summary).toContain("group discount no longer applies");
  });

  it("keeps the discount while still at the threshold", () => {
    const q = partialCancelQuote(booking({ seats: 5, discountCents: 4750, totalCents: 42750, amountPaidCents: 42750 }), [0], TERMS, 10);
    expect(q.newTotalCents).toBe(34200);
    expect(q.discountLost).toBe(false);
    expect(q.refundCents).toBe(8550);
  });

  it("turns the difference into credit in the credit window", () => {
    const q = partialCancelQuote(booking(), [1, 2], TERMS, 5);
    expect(q.window).toBe("credit");
    expect(q.newTotalCents).toBe(19000);
    expect(q.refundCents).toBe(0);
    expect(q.creditCents).toBe(15200);
  });

  it("refuses inside the no-refund window, every seat, nobody, or the same guest twice", () => {
    expect(partialCancelQuote(booking(), [0], TERMS, 2).problem).toMatch(/message Emily/);
    expect(partialCancelQuote(booking(), [0, 1, 2, 3], TERMS, 10).problem).toMatch(/whole booking/);
    expect(partialCancelQuote(booking(), [], TERMS, 10).problem).toMatch(/at least one/);
    expect(partialCancelQuote(booking(), [1, 1], TERMS, 10).problem).toMatch(/once/);
    expect(partialCancelQuote(booking({ status: "awaiting_payment" }), [0], TERMS, 10).problem).toMatch(/paid/);
  });

  it("gives pass credits back before any money", () => {
    // 3 seats: 1 by pass credit, 2 paid at $95 = $190 (below the threshold, no discount).
    const b = booking({ seats: 3, passCredits: 1, discountCents: 0, totalCents: 19000, amountPaidCents: 19000 });
    const q = partialCancelQuote(b, [2], TERMS, 10);
    expect(q.passCreditsReturned).toBe(1);
    expect(q.newPassCredits).toBe(0);
    expect(q.newTotalCents).toBe(19000);
    expect(q.refundCents).toBe(0);
    expect(q.summary).toContain("1 class pass credit back");
  });

  it("gives cash back first, then voucher money as a credit code", () => {
    // 2 seats $190: $150 by voucher, $40 cash. Cancel 1: $95 back = $40 cash + $55 voucher.
    const b = booking({ seats: 2, discountCents: 0, totalCents: 19000, amountPaidCents: 4000, voucherAppliedCents: 15000 });
    const q = partialCancelQuote(b, [0], TERMS, 10);
    expect(q.refundCents).toBe(4000);
    expect(q.voucherCreditCents).toBe(5500);
  });
});

describe("setup checks", () => {
  const goodEnv = {
    NEXT_PUBLIC_SITE_URL: "https://cakes.example.com.au",
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-value",
    ADMIN_EMAILS: "emily@example.com",
    ADMIN_NOTIFY_EMAIL: "emily@example.com",
    STRIPE_SECRET_KEY: "sk_live_secretvalue123",
    STRIPE_WEBHOOK_SECRET: "whsec_secretvalue",
    RESEND_API_KEY: "re_secretvalue",
    EMAIL_FROM: "Layered <orders@example.com.au>",
    ORDER_LINK_SECRET: "x".repeat(43),
    CRON_SECRET: "cron-secret-value",
    PICKUP_DETAILS: "12 Example St, park on the street",
    ADMIN_REQUIRE_MFA: "true",
  };
  const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({
    env: goodEnv,
    requestHost: "cakes.example.com.au",
    memoryMode: false,
    supabase: { reachable: true, missingTables: [], phase5: true, missingBuckets: [] },
    stripe: { reachable: true, accountName: "Cakes by Emily", chargesEnabled: true },
    ...over,
  });

  it("is all green when everything is set and answering", () => {
    const checks = setupChecks(facts());
    expect(checks.filter((c) => c.status !== "ok").map((c) => c.id)).toEqual([]);
    expect(overall(checks)).toBe("ok");
  });

  it("never shows a secret's value", () => {
    const text = JSON.stringify(setupChecks(facts()));
    for (const secret of ["anon-key-value", "service-role-secret-value", "sk_live_secretvalue123", "whsec_secretvalue", "re_secretvalue", "cron-secret-value", "x".repeat(43)]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("abc.supabase.co");
  });

  it("flags missing settings red with a fix, and placeholders amber", () => {
    const env = { ...goodEnv, STRIPE_WEBHOOK_SECRET: "", PICKUP_DETAILS: "[Emily to add pickup address and parking note]" };
    const checks = setupChecks(facts({ env }));
    const hook = checks.find((c) => c.id === "env:STRIPE_WEBHOOK_SECRET")!;
    expect(hook.status).toBe("fail");
    expect(hook.fix).toContain("Vercel");
    expect(checks.find((c) => c.id === "env:PICKUP_DETAILS")!.status).toBe("warn");
    expect(overall(checks)).toBe("fail");
  });

  it("names the migrations to run when tables are missing", () => {
    const checks = setupChecks(facts({ supabase: { reachable: true, missingTables: ["class_passes", "refunds"], phase5: false, missingBuckets: ["order-media"] } }));
    expect(checks.find((c) => c.id === "db-tables")!.fix).toContain("20261111000000_phase4.sql");
    expect(checks.find((c) => c.id === "db-phase5")!.status).toBe("fail");
    expect(checks.find((c) => c.id === "db-storage")!.status).toBe("fail");
  });

  it("explains an unreachable database and Stripe", () => {
    const checks = setupChecks(facts({ supabase: { reachable: false, error: "fetch failed", missingTables: [], phase5: false, missingBuckets: [] }, stripe: { reachable: false, error: "Invalid API Key" } }));
    expect(checks.find((c) => c.id === "db")!.status).toBe("fail");
    expect(checks.find((c) => c.id === "stripe-api")!.status).toBe("fail");
  });

  it("tells test keys from live keys, and warns when the site address doesn't match", () => {
    expect(stripeKeyMode("sk_test_1")).toBe("test");
    expect(stripeKeyMode("sk_live_1")).toBe("live");
    expect(stripeKeyMode("rk_live_1")).toBe("restricted");
    expect(stripeKeyMode(undefined)).toBe("missing");
    const checks = setupChecks(facts({ env: { ...goodEnv, STRIPE_SECRET_KEY: "sk_test_1" }, requestHost: "my-site.vercel.app" }));
    expect(checks.find((c) => c.id === "stripe-mode")!.status).toBe("warn");
    expect(checks.find((c) => c.id === "site-url")!.status).toBe("warn");
  });

  it("is red when two-factor is off or the link secret is short, and amber in test mode", () => {
    const checks = setupChecks(facts({ env: { ...goodEnv, ADMIN_REQUIRE_MFA: "false", ORDER_LINK_SECRET: "short" } }));
    expect(checks.find((c) => c.id === "mfa")!.status).toBe("fail");
    expect(checks.find((c) => c.id === "order-secret")!.status).toBe("fail");
    const test = setupChecks(facts({ memoryMode: true, supabase: null, env: {} }));
    expect(test.find((c) => c.id === "db")!.status).toBe("warn");
    expect(test.find((c) => c.id === "stripe-mode")!.detail).toContain("pretend checkout");
  });

  it("shows only the host of a URL", () => {
    expect(safeHost("https://user:pass@abc.supabase.co/rest?x=1")).toBe("abc.supabase.co");
    expect(safeHost("not a url")).toBe("set (not a valid URL)");
    expect(safeHost(undefined)).toBe("missing");
  });
});

describe("live smoke test helpers", () => {
  it("refuses without a test key, confirmation and an https address", () => {
    expect(smokeGuard({ STRIPE_SECRET_KEY: "sk_test_1", SMOKE_CONFIRM: "yes", SMOKE_BASE_URL: "https://x.vercel.app" })).toEqual([]);
    expect(smokeGuard({ STRIPE_SECRET_KEY: "sk_live_1", SMOKE_CONFIRM: "yes", SMOKE_BASE_URL: "https://x.vercel.app" }).join()).toMatch(/test key/);
    expect(smokeGuard({ STRIPE_SECRET_KEY: "sk_test_1", SMOKE_BASE_URL: "https://x.vercel.app" }).join()).toMatch(/SMOKE_CONFIRM/);
    expect(smokeGuard({ STRIPE_SECRET_KEY: "sk_test_1", SMOKE_CONFIRM: "yes", SMOKE_BASE_URL: "http://x.vercel.app" }).join()).toMatch(/https/);
    expect(smokeGuard({ STRIPE_SECRET_KEY: "sk_test_1", SMOKE_CONFIRM: "yes", SMOKE_BASE_URL: "http://localhost:3000" })).toEqual([]);
    expect(smokeGuard({})).toHaveLength(3);
  });

  it("picks the first normal date with a free slot", () => {
    const days = [
      { date: "2026-11-10", bookable: true, isRush: true, peakSurchargeCents: 0 },
      { date: "2026-11-20", bookable: true, isRush: false, peakSurchargeCents: 3000 },
      { date: "2026-11-21", bookable: false, isRush: false, peakSurchargeCents: 0 },
      { date: "2026-11-24", bookable: true, isRush: false, peakSurchargeCents: 0 },
      { date: "2026-11-25", bookable: true, isRush: false, peakSurchargeCents: 0 },
    ];
    const slots: Record<string, { time: string; available: boolean }[]> = {
      "2026-11-24": [{ time: "10:00", available: false }],
      "2026-11-25": [
        { time: "10:00", available: false },
        { time: "10:30", available: true },
      ],
    };
    expect(pickDateAndSlot(days, (d) => slots[d])).toEqual({ date: "2026-11-25", slot: "10:30" });
    expect(pickDateAndSlot([], () => [])).toBeNull();
  });

  it("reads the session id and order token from Stripe URLs", () => {
    expect(sessionIdFromCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_a1B2c3#fidkdWxO")).toBe("cs_test_a1B2c3");
    expect(sessionIdFromCheckoutUrl("/checkout/test?session=cs_fake_1")).toBeNull();
    expect(orderTokenFromUrl("https://cakes.example.com.au/o/abcdefghijklmnopqrstuvwxyz_-0123?paid=1")).toBe("abcdefghijklmnopqrstuvwxyz_-0123");
    expect(orderTokenFromUrl("https://cakes.example.com.au/b/abcdefghijklmnopqrstuvwxyz")).toBeNull();
  });

  it("builds an order the real API accepts, marked as a smoke test", () => {
    const payload = smokeOrderPayload("2026-11-25", "10:30", "20261108");
    const parsed = orderRequestSchema.parse(payload);
    expect(parsed.notes).toContain("SMOKE TEST");
    expect(parsed.email).toBe("smoke-test+20261108@example.com");
  });

  it("lists months and prints a PASS/FAIL table with the right exit code", () => {
    expect(nextMonths("2026-11-08", 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
    const rows = [
      { step: "Site answers", status: "PASS" as const, detail: "ok" },
      { step: "Automatic refund", status: "SKIP" as const, detail: "off" },
    ];
    expect(resultsTable(rows)).toContain("PASSED: 1 steps (1 skipped)");
    expect(smokeExitCode(rows)).toBe(0);
    const failed = [...rows, { step: "Webhook", status: "FAIL" as const, detail: "no" }];
    expect(resultsTable(failed)).toContain("FAILED: 1 of 3 steps");
    expect(smokeExitCode(failed)).toBe(1);
  });
});
