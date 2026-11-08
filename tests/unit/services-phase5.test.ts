import { beforeEach, describe, expect, it } from "vitest";
import { memoryRepository as repo, resetMemoryStore } from "@/lib/data/memory";
import {
  acceptPrivate,
  bookClass,
  cancelBooking,
  cancelPrivate,
  cancelSomeSeats,
  createSeries,
  joinClassWaitlist,
  partialCancelPreview,
  privateFromPayToken,
  requestPrivate,
  startPrivateDeposit,
} from "@/lib/services/classes";
import { outbox, type Mailer } from "@/lib/services/email";
import { createOrder, handlePaidSession } from "@/lib/services/orders";
import { startPassPurchase } from "@/lib/services/passes";
import { fakeGateway, type PaymentsGateway } from "@/lib/services/payments";
import { pickEnv, runSetupChecks, sendSetupTestEmail } from "@/lib/services/setup";
import { applyCodeToShare, editGuestDetails, guestEditWindow, guestFromTokens, joinAsGuest, payOwnShare } from "@/lib/services/split";
import { linkToken, passCode, voucherCode } from "@/lib/services/tokens";
import { startVoucherPurchase } from "@/lib/services/vouchers";
import { classBookingSchema, orderRequestSchema, privateRequestSchema, voucherPurchaseSchema, type ClassBookingRequest } from "@/lib/validation";

process.env.DATA_ADAPTER = "memory";
process.env.ADMIN_NOTIFY_EMAIL = "emily@example.com";

const sent: { to: string; subject: string; text: string }[] = [];
const mailer: Mailer = {
  async send(e) {
    sent.push({ to: e.to, subject: e.subject, text: e.text });
  },
};

// 10am Sun 8 Nov 2026 in Sydney.
const NOW = new Date("2026-11-07T23:00:00Z");
const deps = { repo, payments: fakeGateway, mailer, baseUrl: "https://cakes.test", now: NOW };
const at = (iso: string) => ({ ...deps, now: new Date(iso) });
const sessionOf = (url: string) => new URL(url, "https://x").searchParams.get("session")!;
const amountOf = (url: string) => Number(new URL(url, "https://x").searchParams.get("amount"));
let evt = 0;
async function pay(url: string, d: typeof deps = deps) {
  const s = sessionOf(url);
  return handlePaidSession(d, `evt5_${++evt}`, s, `pi_fake_${s.slice(8)}`);
}
const autoRefundsOn = async () => repo.saveSettings({ ...(await repo.getSettings()), autoRefunds: true });

async function giftVoucher(amountCents = 10000) {
  const { checkoutUrl, voucher } = await startVoucherPurchase(
    deps,
    voucherPurchaseSchema.parse({ amountCents, buyerName: "Kim Lee", buyerEmail: "kim@example.com", recipientName: "Sam", acceptTerms: true }),
  );
  await pay(checkoutUrl);
  return voucherCode(voucher.id);
}

async function classPass() {
  const { checkoutUrl, pass } = await startPassPurchase(deps, { buyerName: "Kim Lee", buyerEmail: "kim@example.com" });
  await pay(checkoutUrl);
  return { code: passCode(pass.id), id: pass.id };
}

async function session(seats = 8, date = "2026-11-21") {
  const [s] = await createSeries(deps, { classTypeId: "class-florals", date, startTime: "14:00", seats, everyDays: 7, count: 1 });
  return s;
}
const book = (sessionId: string, seats: number, over: Partial<ClassBookingRequest> = {}) =>
  classBookingSchema.parse({
    sessionId,
    seats,
    guests: Array.from({ length: seats }, (_, i) => ({ name: `Guest ${i + 1}`, allergies: "" })),
    contactName: "Ann Lee",
    email: "ann@example.com",
    phone: "0400 333 444",
    adultConfirmed: true,
    acceptTerms: true,
    ...over,
  });
async function bookAndPay(sessionId: string, seats: number, over: Partial<ClassBookingRequest> = {}, d: typeof deps = deps) {
  const r = await bookClass(d, book(sessionId, seats, over));
  if (sessionOf(r.checkoutUrl)) await pay(r.checkoutUrl, d);
  return (await repo.getBookingById(r.booking.id))!;
}

async function paidPrivate() {
  const r = await requestPrivate(
    deps,
    privateRequestSchema.parse({ packageKey: "deluxe", guests: 6, preferredDate: "2026-12-12", preferredTime: "14:00", customerName: "Jo Park", email: "jo@example.com", phone: "0400555666" }),
  );
  await acceptPrivate(deps, r.id);
  const token = linkToken("organiser", r.id);
  const found = (await privateFromPayToken(repo, token))!;
  await pay(await startPrivateDeposit(deps, found, token));
  return (await repo.getPrivateRequest(r.id))!;
}

async function joinedGuest(allergies = "") {
  const request = await paidPrivate();
  const share = linkToken("share", request.id);
  const g = await joinAsGuest(deps, { shareToken: share, name: "Bea Wu", email: "bea@example.com", allergies, dietary: [], messageOptIn: false, pay: false });
  const [, guestId, guestToken] = new URL(g.guestUrl).pathname.split("/").slice(2);
  const found = (await guestFromTokens(deps, share, guestId, guestToken))!;
  return { request, guest: found.guest, share, guestId, guestToken };
}

beforeEach(() => {
  resetMemoryStore();
  sent.length = 0;
});

describe("guests changing their own details", () => {
  it("saves changes before the cut-off and tells Emily about allergy changes only", async () => {
    const { request, guest } = await joinedGuest("Peanuts");
    expect(await guestEditWindow(deps, request)).toEqual({ canEdit: true, deadline: "2026-12-10" });
    sent.length = 0;
    const nameOnly = await editGuestDetails(deps, request, guest, { name: "Bea Wu-Lin", email: "bea@example.com", allergies: "Peanuts", dietary: [], messageOptIn: true });
    expect(nameOnly.allergyChanged).toBe(false);
    expect(sent).toHaveLength(0);
    const g1 = (await repo.getGuest(guest.id))!;
    expect(g1).toMatchObject({ name: "Bea Wu-Lin", messageOptIn: true });

    const changed = await editGuestDetails(deps, request, g1, { name: "Bea Wu-Lin", email: "bea@example.com", allergies: "Peanuts, sesame", dietary: ["egg-free"], messageOptIn: true });
    expect(changed.allergyChanged).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "emily@example.com" });
    expect(sent[0].subject).toBe(`Allergy change: Bea Wu-Lin (${request.reference})`);
    expect(sent[0].text).toContain("Before: Peanuts");
    expect(sent[0].text).toContain("Now: Peanuts, sesame; egg-free");
  });

  it("refuses changes from the cut-off day", async () => {
    const { request, guest } = await joinedGuest();
    const late = at("2026-12-10T14:00:00Z"); // 1am Fri 11 Dec in Sydney.
    expect((await guestEditWindow(late, request)).canEdit).toBe(false);
    await expect(editGuestDetails(late, request, guest, { name: "X", email: "x@example.com", allergies: "", dietary: [], messageOptIn: false })).rejects.toThrow(/message Emily/);
    expect((await repo.getGuest(guest.id))!.name).toBe("Bea Wu");
  });
});

describe("codes on a guest's share", () => {
  it("takes part of the share off with a gift voucher, so the checkout is for what's left", async () => {
    const code = await giftVoucher(5000);
    const { request, guest } = await joinedGuest();
    const r = await applyCodeToShare(deps, request, guest, code);
    expect(r).toMatchObject({ appliedCents: 5000, kind: "voucher", owedCents: 4500, paid: false });
    const g = (await repo.getGuest(guest.id))!;
    const url = await payOwnShare(deps, request, g);
    expect(amountOf(url)).toBe(4500);
    await pay(url);
    expect((await repo.getGuest(guest.id))!.status).toBe("paid");
  });

  it("marks the share paid with no checkout when the voucher covers it all", async () => {
    const code = await giftVoucher(20000);
    const { request, guest } = await joinedGuest();
    sent.length = 0;
    const r = await applyCodeToShare(deps, request, guest, code);
    expect(r).toMatchObject({ appliedCents: 9500, owedCents: 0, paid: true });
    expect((await repo.getGuest(guest.id))!.status).toBe("paid");
    expect(sent.map((m) => m.subject)).toEqual(["Share paid for Jo's class", "1 of 6 shares paid"]);
    // The voucher keeps the rest.
    const v = (await repo.listVouchers()).find((x) => x.kind === "gift")!;
    expect(v.balanceCents).toBe(10500);
  });

  it("uses one class pass credit, worth what a credit cost", async () => {
    const pass = await classPass();
    const { request, guest } = await joinedGuest();
    const r = await applyCodeToShare(deps, request, guest, pass.code);
    expect(r).toMatchObject({ kind: "pass", appliedCents: 8500, owedCents: 1000 });
    expect((await repo.getPassById(pass.id))!.creditsLeft).toBe(2);
  });

  it("takes only one code per share, never while it's being paid, and refuses bad codes", async () => {
    const code = await giftVoucher(2000);
    const second = await giftVoucher(2000);
    const { request, guest } = await joinedGuest();
    await expect(applyCodeToShare(deps, request, guest, "AAAA-AAAA-AAAA-AAAA")).rejects.toThrow(/wasn't recognised/);
    await applyCodeToShare(deps, request, guest, code);
    await expect(applyCodeToShare(deps, request, (await repo.getGuest(guest.id))!, second)).rejects.toThrow(/already applied/);

    const other = await joinAsGuest(deps, { shareToken: linkToken("share", request.id), name: "Cy", email: "cy@example.com", allergies: "", dietary: [], messageOptIn: false, pay: true });
    const [, otherId] = new URL(other.guestUrl).pathname.split("/").slice(2);
    await expect(applyCodeToShare(deps, request, (await repo.getGuest(otherId))!, second)).rejects.toThrow(/being paid/);
  });

  it("lets only one of two simultaneous codes land on a share", async () => {
    const a = await giftVoucher(2000);
    const b = await giftVoucher(3000);
    const { request, guest } = await joinedGuest();
    const results = await Promise.allSettled([applyCodeToShare(deps, request, guest, a), applyCodeToShare(deps, request, guest, b)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const vouchers = await repo.listVouchers();
    expect(vouchers.reduce((s, v) => s + v.balanceCents, 0)).toBe(5000 - (await repo.getGuest(guest.id))!.voucherAppliedCents!);
  });

  it("gives vouchers and pass credits back when Emily cancels the private class", async () => {
    const code = await giftVoucher(4000);
    const pass = await classPass();
    const { request, guest } = await joinedGuest();
    await applyCodeToShare(deps, request, guest, code);
    const second = await joinAsGuest(deps, { shareToken: linkToken("share", request.id), name: "Cy", email: "cy@example.com", allergies: "", dietary: [], messageOptIn: false, pay: false });
    const [, secondId] = new URL(second.guestUrl).pathname.split("/").slice(2);
    await applyCodeToShare(deps, request, (await repo.getGuest(secondId))!, pass.code);
    const record = await cancelPrivate(deps, request.id);
    expect(record).toMatchObject({ voucherReturnedCents: 4000, passCreditsReturned: 1 });
    expect(record.summary).toContain("$40 of vouchers or credit");
    expect((await repo.listVouchers()).find((v) => v.kind === "gift")!.balanceCents).toBe(4000);
    expect((await repo.getPassById(pass.id))!.creditsLeft).toBe(3);
  });
});

describe("cancelling some seats", () => {
  it("re-prices the booking, records the refund, frees the seats and offers them to the waitlist", async () => {
    const s = await session(4);
    const b = await bookAndPay(s.id, 4);
    expect(b).toMatchObject({ totalCents: 34200, discountCents: 3800 });
    await joinClassWaitlist(deps, { sessionId: s.id, seats: 1, customerName: "Wai Ting", email: "wai@example.com", phone: "0400111222" });
    sent.length = 0;
    const preview = (await partialCancelPreview(repo, b, [3], NOW))!;
    expect(preview.quote).toMatchObject({ ok: true, newTotalCents: 28500, refundCents: 5700, discountLost: true });

    const record = await cancelSomeSeats(deps, b.id, [3]);
    expect(record).toMatchObject({ seats: 1, guestNames: ["Guest 4"], refundCents: 5700 });
    const after = (await repo.getBookingById(b.id))!;
    expect(after).toMatchObject({ status: "paid", seats: 3, totalCents: 28500, discountCents: 0, amountPaidCents: 28500 });
    expect(after.guests.map((g) => g.name)).toEqual(["Guest 1", "Guest 2", "Guest 3"]);
    expect(after.partialCancellations).toHaveLength(1);
    // 3 still booked, plus the freed seat now held for the waitlist offer.
    expect((await repo.getSession(s.id))!.booked).toBe(4);
    expect((await repo.listWaitlist({ sessionId: s.id }))[0].status).toBe("offered");
    expect(sent.some((m) => m.to === "ann@example.com" && m.subject.startsWith("Seats cancelled"))).toBe(true);
    expect(sent.some((m) => m.to === "emily@example.com" && m.subject.includes("(refund $57 in Stripe)"))).toBe(true);
    expect(sent.some((m) => m.to === "wai@example.com")).toBe(true);
  });

  it("refunds through Stripe when automatic refunds are on, and a later full cancel never refunds twice", async () => {
    await autoRefundsOn();
    const s = await session();
    const b = await bookAndPay(s.id, 4);
    const record = await cancelSomeSeats(deps, b.id, [0]);
    expect(record.autoRefundedCents).toBe(5700);
    const full = await cancelBooking(deps, b.id);
    expect(full.refundCents).toBe(28500);
    const payments = await repo.listPaidPayments("booking", b.id);
    expect(payments.reduce((sum, p) => sum + (p.refundedCents ?? 0), 0)).toBe(34200);
  });

  it("turns the difference into a credit code in the credit window", async () => {
    const s = await session(8, "2026-11-13");
    const b = await bookAndPay(s.id, 2);
    const before = (await repo.listVouchers()).length;
    const record = await cancelSomeSeats(deps, b.id, [1]);
    expect(record).toMatchObject({ refundCents: 0, creditCents: 9500 });
    const vouchers = await repo.listVouchers();
    expect(vouchers).toHaveLength(before + 1);
    expect(vouchers.find((v) => v.kind === "credit")!.amountCents).toBe(9500);
    expect((await repo.getBookingById(b.id))!.amountPaidCents).toBe(9500);
  });

  it("gives a class pass credit back before money", async () => {
    const pass = await classPass();
    const s = await session();
    const b = await bookAndPay(s.id, 2, { passCode: pass.code });
    expect(b.passCredits).toBe(2);
    const record = await cancelSomeSeats(deps, b.id, [0]);
    expect(record).toMatchObject({ passCreditsReturned: 1, refundCents: 0 });
    expect((await repo.getPassById(pass.id))!.creditsLeft).toBe(2);
    expect((await repo.getBookingById(b.id))!.passCredits).toBe(1);
  });

  it("lets only one of two simultaneous cancels apply", async () => {
    const s = await session();
    const b = await bookAndPay(s.id, 3);
    const results = await Promise.allSettled([cancelSomeSeats(deps, b.id, [0]), cancelSomeSeats(deps, b.id, [1])]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await repo.getBookingById(b.id))!.seats).toBe(2);
    expect((await repo.getSession(s.id))!.booked).toBe(2);
  });

  it("refuses inside the no-refund window and for every seat", async () => {
    const s = await session(8, "2026-11-10");
    const b = await bookAndPay(s.id, 2);
    await expect(cancelSomeSeats(deps, b.id, [0])).rejects.toThrow(/message Emily/);
    const s2 = await session(8, "2026-11-28");
    const b2 = await bookAndPay(s2.id, 2);
    await expect(cancelSomeSeats(deps, b2.id, [0, 1])).rejects.toThrow(/whole booking/);
  });
});

describe("payments that arrive after an order expired", () => {
  const order = () =>
    orderRequestSchema.parse({
      config: { occasion: "occ-birthday", size: "size-6-round", flavour: "fl-vanilla", finish: "fin-buttercream", colour: "col-blush", decorations: [], extras: [], topperText: "" },
      pickupDate: "2026-11-28",
      pickupSlot: "10:00",
      customerName: "Sam Taylor",
      email: "sam@example.com",
      phone: "0400 000 000",
      acceptTerms: true,
    });
  const expire = (id: string) =>
    repo.cancelOrderOnce(id, { at: NOW.toISOString(), by: "expired", daysOut: 20, refundCents: 0, creditCents: 0, keptCents: 0, voucherReturnedCents: 0, summary: "expired" }, true);

  it("are refunded in full through Stripe when automatic refunds are on, once", async () => {
    await autoRefundsOn();
    const o = await createOrder(deps, order(), null);
    await expire(o.order.id);
    sent.length = 0;
    await pay(o.checkoutUrl);
    const [p] = await repo.listPaidPayments("order", o.order.id);
    expect(p.refundedCents).toBe(6500);
    const refunds = await repo.listRefunds([p.id]);
    expect(refunds).toMatchObject([{ status: "succeeded", amountCents: 6500, reason: "late-payment" }]);
    expect(sent.find((m) => m.to === "emily@example.com")!.subject).toBe(`Late payment refunded: ${o.order.reference}`);
    // Stripe retrying the same event changes nothing.
    expect(await handlePaidSession(deps, `evt5_${evt}`, sessionOf(o.checkoutUrl), "pi_x")).toBe(false);
    expect(await repo.listRefunds([p.id])).toHaveLength(1);
  });

  it("are left for Emily to refund by hand when automatic refunds are off, or Stripe refuses", async () => {
    const o = await createOrder(deps, order(), null);
    await expire(o.order.id);
    sent.length = 0;
    await pay(o.checkoutUrl);
    expect(sent.find((m) => m.to === "emily@example.com")!.subject).toBe(`Payment for expired order ${o.order.reference}`);

    await autoRefundsOn();
    const failing: PaymentsGateway = { ...fakeGateway, async refund() { throw new Error("nope"); } };
    const d = { ...deps, payments: failing };
    const o2 = await createOrder(deps, { ...order(), pickupSlot: "10:30" }, null);
    await expire(o2.order.id);
    sent.length = 0;
    await pay(o2.checkoutUrl, d);
    const [p] = await repo.listPaidPayments("order", o2.order.id);
    expect(await repo.listRefunds([p.id])).toMatchObject([{ status: "failed" }]);
    expect(sent.find((m) => m.to === "emily@example.com")!.subject).toBe(`Payment for expired order ${o2.order.reference}`);
  });
});

describe("setup page facts", () => {
  it("shows test mode on the memory adapter and passes on only the variables it checks", async () => {
    const checks = await runSetupChecks("localhost:3000", { memoryMode: true });
    expect(checks.find((c) => c.id === "db")).toMatchObject({ status: "warn", detail: "test mode (in-memory data)" });
    const env = pickEnv({ STRIPE_SECRET_KEY: "sk_test_x", SOMETHING_ELSE: "secret", ADMIN_REQUIRE_MFA: "true" });
    expect(env.STRIPE_SECRET_KEY).toBe("sk_test_x");
    expect("SOMETHING_ELSE" in env).toBe(false);
  });

  it("sends the test email to ADMIN_NOTIFY_EMAIL (the outbox, without a Resend key)", async () => {
    const before = outbox().length;
    expect(await sendSetupTestEmail()).toEqual({ to: "emily@example.com" });
    expect(outbox().length).toBe(before + 1);
    expect(outbox().at(-1)!.subject).toContain("Test email from");
  });
});
