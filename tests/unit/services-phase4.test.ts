import { beforeEach, describe, expect, it } from "vitest";
import { memoryRepository as repo, resetMemoryStore } from "@/lib/data/memory";
import { cancelBoxByEmily, createBoxOrder } from "@/lib/services/boxes";
import { cancelWithTerms } from "@/lib/services/changes";
import {
  acceptPrivate,
  bookClass,
  cancelBooking,
  cancelClass,
  cancelPrivate,
  createSeries,
  joinClassWaitlist,
  privateFromPayToken,
  requestPrivate,
  selfCancelBooking,
  startPrivateDeposit,
} from "@/lib/services/classes";
import { cancelCorporate, corporateOwing, createCorporateOrder } from "@/lib/services/corporate";
import type { Mailer } from "@/lib/services/email";
import { emailGallery, removeClassPhoto, sessionForGallery, uploadClassPhoto } from "@/lib/services/gallery";
import { advanceStage, createOrder, handlePaidSession } from "@/lib/services/orders";
import { startPassPurchase } from "@/lib/services/passes";
import { fakeGateway, type PaymentsGateway } from "@/lib/services/payments";
import { refundTarget } from "@/lib/services/refunds";
import { stampCardFor } from "@/lib/services/referrals";
import { guestFromTokens, joinAsGuest, nudgeGuests, payOwnShare, payRemainingShares, requestFromShareToken } from "@/lib/services/split";
import { linkToken, passCode, voucherCode } from "@/lib/services/tokens";
import { startVoucherPurchase } from "@/lib/services/vouchers";
import {
  boxOrderRequestSchema,
  classBookingSchema,
  corporateRequestSchema,
  orderRequestSchema,
  privateRequestSchema,
  voucherPurchaseSchema,
  type ClassBookingRequest,
  type OrderRequest,
} from "@/lib/validation";

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
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const sessionOf = (url: string) => new URL(url, "https://x").searchParams.get("session")!;
const amountOf = (url: string) => Number(new URL(url, "https://x").searchParams.get("amount"));
let evt = 0;
/** Pay at the fake checkout the way the webhook would, including the PaymentIntent. */
async function pay(url: string, d = deps) {
  const s = sessionOf(url);
  return handlePaidSession(d, `evt_${++evt}`, s, `pi_fake_${s.slice(8)}`);
}
const autoRefundsOn = async () => repo.saveSettings({ ...(await repo.getSettings()), autoRefunds: true });

function request(over: Partial<OrderRequest> = {}): OrderRequest {
  return orderRequestSchema.parse({
    config: { occasion: "occ-birthday", size: "size-6-round", flavour: "fl-vanilla", finish: "fin-buttercream", colour: "col-blush", decorations: [], extras: [], topperText: "" },
    pickupDate: "2026-11-28",
    pickupSlot: "10:00",
    customerName: "Sam Taylor",
    email: "sam@example.com",
    phone: "0400 000 000",
    acceptTerms: true,
    ...over,
  });
}

async function giftVoucher(amountCents = 10000) {
  const { checkoutUrl, voucher } = await startVoucherPurchase(
    deps,
    voucherPurchaseSchema.parse({ amountCents, buyerName: "Kim Lee", buyerEmail: "kim@example.com", recipientName: "Sam", acceptTerms: true }),
  );
  await pay(checkoutUrl);
  return voucherCode(voucher.id);
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
async function bookAndPay(sessionId: string, seats: number, over: Partial<ClassBookingRequest> = {}, d = deps) {
  const r = await bookClass(d, book(sessionId, seats, over));
  if (sessionOf(r.checkoutUrl)) await pay(r.checkoutUrl, d);
  return (await repo.getBookingById(r.booking.id))!;
}

async function paidPrivate(guests = 4) {
  const r = await requestPrivate(
    deps,
    privateRequestSchema.parse({ packageKey: "deluxe", guests: Math.max(6, guests), preferredDate: "2026-12-12", preferredTime: "14:00", customerName: "Jo Park", email: "jo@example.com", phone: "0400555666" }),
  );
  await acceptPrivate(deps, r.id);
  const token = linkToken("organiser", r.id);
  const found = (await privateFromPayToken(repo, token))!;
  await pay(await startPrivateDeposit(deps, found, token));
  return { request: (await repo.getPrivateRequest(r.id))!, token };
}

beforeEach(() => {
  resetMemoryStore();
  sent.length = 0;
});

describe("split payments for private classes", () => {
  it("creates guest places with equal shares and emails the organiser a share link", async () => {
    const { request } = await paidPrivate();
    const guests = await repo.listGuests(request.id);
    // Deluxe x 6: $720 estimate, $150 deposit, so 6 shares of $95.
    expect(guests.map((g) => g.shareCents)).toEqual(Array(6).fill(9500));
    const mail = sent.find((m) => m.subject.startsWith("Deposit received: share this link"))!;
    expect(mail.text).toContain(`https://cakes.test/g/${linkToken("share", request.id)}`);
    expect(mail.text).toContain(`https://cakes.test/p/${linkToken("organiser", request.id)}`);
    expect(await requestFromShareToken(deps, linkToken("share", request.id))).toBeTruthy();
    expect(await requestFromShareToken(deps, linkToken("share", "00000000-0000-4000-8000-000000000000"))).toBeNull();
  });

  it("lets a guest add details and pay their share, once", async () => {
    const { request } = await paidPrivate();
    const share = linkToken("share", request.id);
    const r = await joinAsGuest(deps, { shareToken: share, name: "Bea Wu", email: "bea@example.com", allergies: "Peanuts", dietary: ["egg-free"], messageOptIn: true, pay: true });
    expect(amountOf(r.checkoutUrl!)).toBe(9500);
    sent.length = 0;
    await pay(r.checkoutUrl!);
    const guests = await repo.listGuests(request.id);
    expect(guests[0]).toMatchObject({ name: "Bea Wu", status: "paid", allergies: "Peanuts", dietary: ["egg-free"], messageOptIn: true });
    expect(sent.map((m) => m.subject)).toEqual(["Share paid for Jo's class", "1 of 6 shares paid"]);
    // The organiser's progress email never includes guests' allergies.
    expect(sent.map((m) => m.text).join(" ")).not.toContain("Peanuts");
    const [, guestId, guestToken] = new URL(r.guestUrl).pathname.split("/").slice(2);
    const found = (await guestFromTokens(deps, share, guestId, guestToken))!;
    await expect(payOwnShare(deps, found.request, found.guest)).rejects.toThrow(/already paid/);
    expect(await guestFromTokens(deps, share, guestId, linkToken("guest", "00000000-0000-4000-8000-000000000000"))).toBeNull();
  });

  it("never lets two checkouts pay the same share", async () => {
    const { request, token } = await paidPrivate();
    const share = linkToken("share", request.id);
    const g = await joinAsGuest(deps, { shareToken: share, name: "Bea", email: "bea@example.com", allergies: "", dietary: [], messageOptIn: false, pay: false });
    const [, guestId, guestToken] = new URL(g.guestUrl).pathname.split("/").slice(2);
    const found = (await guestFromTokens(deps, share, guestId, guestToken))!;
    const results = await Promise.allSettled([payOwnShare(deps, found.request, found.guest), payOwnShare(deps, found.request, found.guest)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // After the due date the organiser pays the rest, skipping the share mid-payment.
    const due = at("2026-12-05T01:00:00Z");
    const url = await payRemainingShares(due, request, `https://cakes.test/p/${token}`);
    expect(amountOf(url)).toBe(5 * 9500);
    await pay(url, due);
    expect((await repo.listGuests(request.id)).filter((x) => x.status === "paid")).toHaveLength(5);
  });

  it("only lets the organiser pay the rest from the due date", async () => {
    const { request, token } = await paidPrivate();
    await expect(payRemainingShares(deps, request, `https://cakes.test/p/${token}`)).rejects.toThrow(/from the due date/);
  });

  it("stops at the number of guests", async () => {
    const { request } = await paidPrivate();
    const share = linkToken("share", request.id);
    for (let i = 0; i < 6; i++) await joinAsGuest(deps, { shareToken: share, name: `G${i}`, email: `g${i}@example.com`, allergies: "", dietary: [], messageOptIn: false, pay: false });
    await expect(joinAsGuest(deps, { shareToken: share, name: "Late", email: "late@example.com", allergies: "", dietary: [], messageOptIn: false, pay: false })).rejects.toThrow(/All 6 places/);
  });

  it("sends a reminder nudge at most once a day, only to guests still to pay", async () => {
    const { request } = await paidPrivate();
    const share = linkToken("share", request.id);
    await joinAsGuest(deps, { shareToken: share, name: "Bea", email: "bea@example.com", allergies: "", dietary: [], messageOptIn: false, pay: false });
    const paid = await joinAsGuest(deps, { shareToken: share, name: "Cy", email: "cy@example.com", allergies: "", dietary: [], messageOptIn: false, pay: true });
    await pay(paid.checkoutUrl!);
    sent.length = 0;
    expect(await nudgeGuests(deps, request)).toBe(1);
    expect(sent.map((m) => m.to)).toEqual(["bea@example.com"]);
    expect(sent[0].text).toMatch(/\/g\/[A-Za-z0-9_-]{43}\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{43}/);
    const fresh = (await repo.getPrivateRequest(request.id))!;
    await expect(nudgeGuests(deps, fresh)).rejects.toThrow(/one reminder every 24 hours/);
    // A stale copy of the request can't get round the limit either (the database claim is atomic).
    await expect(nudgeGuests(at("2026-11-08T05:00:00Z"), request)).rejects.toThrow(/one reminder every 24 hours/);
    expect(await nudgeGuests(at("2026-11-09T00:00:00Z"), (await repo.getPrivateRequest(request.id))!)).toBe(1);
  });

  it("refunds the deposit and every share through Stripe when Emily cancels (auto refunds on)", async () => {
    await autoRefundsOn();
    const { request } = await paidPrivate();
    const share = linkToken("share", request.id);
    for (const name of ["Bea", "Cy"]) {
      const r = await joinAsGuest(deps, { shareToken: share, name, email: `${name}@example.com`, allergies: "", dietary: [], messageOptIn: false, pay: true });
      await pay(r.checkoutUrl!);
    }
    const record = await cancelPrivate(deps, request.id);
    expect(record).toMatchObject({ refundCents: 15000 + 2 * 9500, autoRefundedCents: 34000 });
    expect(record.refundIds).toHaveLength(3);
    const payments = await repo.listPaidPayments("private", request.id);
    expect(payments.every((p) => p.refundedCents === p.amountCents)).toBe(true);
  });
});

describe("class photo galleries", () => {
  it("uploads photos, opens only with the class token, emails each booking once, and deletes", async () => {
    const s = await session();
    await bookAndPay(s.id, 2);
    await expect(emailGallery(deps, s.id)).rejects.toThrow(/Upload some photos/);
    const photo = await uploadClassPhoto(deps, s.id, { bytes: PNG, contentType: "image/png" }, "Florals!");
    expect(photo.path).toMatch(new RegExp(`^classes/${s.id}/photo-[0-9a-f-]{36}\\.png$`));
    await expect(uploadClassPhoto(deps, s.id, { bytes: new Uint8Array([1, 2, 3, 4]), contentType: "image/png" }, "")).rejects.toThrow(/valid image/);
    expect(await sessionForGallery(deps, s.id, linkToken("gallery", s.id))).toBeTruthy();
    expect(await sessionForGallery(deps, s.id, linkToken("booking", s.id))).toBeNull();
    sent.length = 0;
    expect(await emailGallery(deps, s.id)).toBe(1);
    expect(await emailGallery(deps, s.id)).toBe(0);
    expect(sent[0].text).toContain(`/gallery/${s.id}/${linkToken("gallery", s.id)}`);
    await removeClassPhoto(deps, photo.id);
    expect(await repo.listClassPhotos(s.id)).toHaveLength(0);
    expect(await repo.mediaUrl(photo.path)).toBeNull();
  });
});

describe("class passes", () => {
  async function buyPass() {
    const { checkoutUrl, pass } = await startPassPurchase(deps, { buyerName: "Ann Lee", buyerEmail: "ann@example.com" });
    expect(amountOf(checkoutUrl)).toBe(25500);
    await pay(checkoutUrl);
    return { pass: (await repo.getPassById(pass.id))!, code: passCode(pass.id) };
  }

  it("is bought, emailed, and covers whole seats", async () => {
    const { pass, code } = await buyPass();
    expect(pass).toMatchObject({ status: "active", creditsLeft: 3, creditsTotal: 3, expiresOn: "2027-11-08" });
    expect(sent.find((m) => m.subject === "Your 3-class pass")?.text).toContain(code);
    const s = await session();
    // 2 seats, both covered: no checkout.
    const r = await bookClass(deps, book(s.id, 2, { passCode: code.toLowerCase() }));
    expect(r.checkoutUrl).toMatch(/\/t\/.+\?paid=1$/);
    expect((await repo.getBookingById(r.booking.id))).toMatchObject({ status: "paid", passCredits: 2, totalCents: 0 });
    // 2 more seats with 1 credit left: pays for one.
    const r2 = await bookClass(deps, book(s.id, 2, { passCode: code, email: "b@example.com" }));
    expect(amountOf(r2.checkoutUrl)).toBe(9500);
    expect((await repo.getPassById(pass.id))?.creditsLeft).toBe(0);
    await expect(bookClass(deps, book(s.id, 1, { passCode: code }))).rejects.toThrow(/no credits left/);
  });

  it("gives credits back when the class is cancelled, but not inside the no-refund window", async () => {
    const { pass, code } = await buyPass();
    const s = await session(8, "2026-11-21");
    const b = await bookAndPay(s.id, 1, { passCode: code });
    await cancelBooking(deps, b.id);
    expect((await repo.getPassById(pass.id))?.creditsLeft).toBe(3);
    const b2 = await bookAndPay(s.id, 1, { passCode: code });
    await selfCancelBooking(at("2026-11-19T23:00:00Z"), b2.id); // 1 day out
    expect((await repo.getPassById(pass.id))?.creditsLeft).toBe(2);
  });

  it("gives the seats back if a pass can't be used", async () => {
    const s = await session(8);
    await expect(bookClass(deps, book(s.id, 2, { passCode: "AAAA-BBBB-CCCC-DDDD" }))).rejects.toThrow(/wasn't recognised/);
    expect((await repo.getSession(s.id))?.booked).toBe(0);
  });
});

describe("vouchers everywhere", () => {
  it("pay for class bookings, and come back when the booking is cancelled", async () => {
    const code = await giftVoucher(5000);
    const s = await session();
    const r = await bookClass(deps, book(s.id, 1, { voucherCode: code }));
    expect(amountOf(r.checkoutUrl)).toBe(4500);
    await pay(r.checkoutUrl);
    await cancelBooking(deps, r.booking.id);
    expect((await repo.listVouchers()).find((v) => v.kind === "gift")?.balanceCents).toBe(5000);
  });

  it("pay for a whole seasonal box, and come back if Emily cancels it", async () => {
    const code = await giftVoucher(10000);
    const r = await createBoxOrder(
      deps,
      boxOrderRequestSchema.parse({ boxId: "b0000000-0000-4000-8000-000000000001", quantity: 2, pickupDate: "2026-12-19", pickupSlot: "10:00", customerName: "Kim Lee", email: "kim@example.com", phone: "0400000000", acceptTerms: true, voucherCode: code }),
    );
    expect(r.checkoutUrl).toMatch(/\/b\/.+\?paid=1$/);
    expect(await repo.getBoxOrderById(r.order.id)).toMatchObject({ status: "paid", voucherAppliedCents: 9000, amountPaidCents: 0 });
    await cancelBoxByEmily(deps, r.order.id);
    expect((await repo.listVouchers())[0].balanceCents).toBe(10000);
    expect((await repo.getBox("b0000000-0000-4000-8000-000000000001"))?.sold).toBe(0);
  });

  it("come off a corporate deposit first, then the balance", async () => {
    const code = await giftVoucher(20000);
    const r = await createCorporateOrder(
      deps,
      corporateRequestSchema.parse({ packageId: "corp-cookies-48", companyName: "Acme", contactName: "Pat Lee", email: "pat@acme.example", phone: "0400222333", pickupDate: "2026-11-27", pickupSlot: "09:00", acceptTerms: true, voucherCode: code }),
      null,
    );
    // $336 total, $168 deposit, $200 voucher: deposit covered, $136 still owing.
    expect(r.checkoutUrl).toMatch(/\/c\/.+\?paid=1$/);
    const o = (await repo.getCorporateOrderById(r.order.id))!;
    expect(o).toMatchObject({ status: "confirmed", voucherAppliedCents: 20000 });
    expect(corporateOwing(o)).toBe(13600);
    await cancelCorporate(deps, o.id);
    expect((await repo.listVouchers())[0].balanceCents).toBe(20000);
  });

  it("are refused when used up", async () => {
    const code = await giftVoucher(5000);
    const s = await session();
    await bookAndPay(s.id, 1, { voucherCode: code });
    await expect(bookClass(deps, book(s.id, 1, { voucherCode: code, email: "b@example.com" }))).rejects.toThrow(/no balance left/);
  });
});

describe("customer self-cancel of class bookings", () => {
  it("refunds in full 7+ days out, frees the seats and offers them to the waitlist", async () => {
    const s = await session(2, "2026-11-21"); // 13 days out
    const b = await bookAndPay(s.id, 2);
    await joinClassWaitlist(deps, { sessionId: s.id, seats: 2, customerName: "Cy Ng", email: "cy@example.com", phone: "0400111333" });
    sent.length = 0;
    const record = await selfCancelBooking(deps, b.id);
    expect(record).toMatchObject({ by: "customer", refundCents: 19000, creditCents: 0 });
    expect(sent.some((m) => m.to === "cy@example.com" && m.subject.startsWith("Seats opened"))).toBe(true);
    expect(sent.some((m) => m.to === "emily@example.com" && m.subject.includes("(refund $190 in Stripe)"))).toBe(true);
    await expect(selfCancelBooking(deps, b.id)).rejects.toThrow(/already cancelled/);
  });

  it("turns the payment into credit 3 to 6 days out, and refuses on the day", async () => {
    const s = await session(8, "2026-11-21");
    const b = await bookAndPay(s.id, 1);
    const record = await selfCancelBooking(at("2026-11-16T23:00:00Z"), b.id); // 4 days out
    expect(record).toMatchObject({ refundCents: 0, creditCents: 9500 });
    expect((await repo.listVouchers()).find((v) => v.kind === "credit")?.balanceCents).toBe(9500);
    const b2 = await bookAndPay(s.id, 1, { email: "b@example.com" });
    await expect(selfCancelBooking(at("2026-11-20T23:00:00Z"), b2.id)).rejects.toThrow(/too close/);
  });
});

describe("automated refunds", () => {
  it("are off by default: the refund is recorded for Emily to make by hand", async () => {
    const o = await createOrder(deps, request(), null);
    await pay(o.checkoutUrl);
    const record = await cancelWithTerms(deps, o.order.id, "emily");
    expect(record.refundCents).toBe(6500);
    expect(record.autoRefundedCents ?? 0).toBe(0);
    expect(sent.some((m) => m.subject.includes("(refund $65 in Stripe)"))).toBe(true);
  });

  it("split a refund across the deposit and the balance, newest first", async () => {
    await autoRefundsOn();
    const o = await createOrder(deps, request({ pickupDate: "2026-11-20" }), null);
    await pay(o.checkoutUrl);
    const { startBalancePayment } = await import("@/lib/services/orders");
    await pay(await startBalancePayment(deps, (await repo.getOrderById(o.order.id))!));
    sent.length = 0;
    const record = await cancelWithTerms(deps, o.order.id, "emily");
    expect(record).toMatchObject({ refundCents: 13000, autoRefundedCents: 13000 });
    expect(record.refundIds).toHaveLength(2);
    expect((await repo.getOrderById(o.order.id))?.cancellation?.autoRefundedCents).toBe(13000);
    expect(sent.some((m) => m.subject.includes("in Stripe)"))).toBe(false);
    expect(sent.find((m) => m.to === "emily@example.com")?.text).toContain("refunded through Stripe automatically");
  });

  it("never refund more than was paid, and reuse idempotency keys", async () => {
    await autoRefundsOn();
    const s = await session();
    const b = await bookAndPay(s.id, 1);
    const first = await refundTarget(deps, "booking", b.id, 9500, "test", "booking");
    expect(first).toMatchObject({ refundedCents: 9500, manualCents: 0 });
    const again = await refundTarget(deps, "booking", b.id, 9500, "test", "booking");
    expect(again).toMatchObject({ refundedCents: 0, manualCents: 9500 });
  });

  it("fall back to a manual record and an email when Stripe refuses", async () => {
    await autoRefundsOn();
    const failing: PaymentsGateway = { ...fakeGateway, async refund() { throw new Error("card_declined"); } };
    const d = { ...deps, payments: failing };
    const s = await session();
    const b = await bookAndPay(s.id, 2, {}, d);
    sent.length = 0;
    const record = await cancelBooking(d, b.id);
    expect(record.autoRefundedCents ?? 0).toBe(0);
    expect(sent.some((m) => m.subject.startsWith("Refund needed by hand") && m.text.includes("$190"))).toBe(true);
    const refunds = await repo.listRefunds((await repo.listPaidPayments("booking", b.id)).map((p) => p.id));
    expect(refunds).toMatchObject([{ status: "failed", amountCents: 19000 }]);
  });

  it("refund a whole cancelled class", async () => {
    await autoRefundsOn();
    const s = await session();
    await bookAndPay(s.id, 2);
    await bookAndPay(s.id, 1, { email: "b@example.com" });
    const r = await cancelClass(deps, s.id);
    expect(r).toEqual({ refunds: [], autoRefundedCents: 28500 });
  });

  it("record Stripe's charge.refunded totals once", async () => {
    const o = await createOrder(deps, request(), null);
    await pay(o.checkoutUrl);
    const [p] = await repo.listPaidPayments("order", o.order.id);
    expect(await repo.recordChargeRefunded("evt_refund_1", p.stripePaymentIntent!, 3000)).toBe(true);
    expect(await repo.recordChargeRefunded("evt_refund_1", p.stripePaymentIntent!, 6000)).toBe(false);
    expect((await repo.listPaidPayments("order", o.order.id))[0].refundedCents).toBe(3000);
  });
});

describe("stamp card reward claims", () => {
  it("let only one of two simultaneous orders use a reward, and give it back on cancellation", async () => {
    await repo.saveSettings({ ...(await repo.getSettings()), dailyCap: 10, weeklyCap: 50, slotCap: 10 });
    for (let i = 0; i < 5; i++) {
      const r = await createOrder(deps, request({ pickupDate: "2026-11-20" }), null);
      await pay(r.checkoutUrl);
      for (let k = 0; k < 5; k++) await advanceStage(deps, r.order.id);
    }
    const [a, b] = await Promise.all([createOrder(deps, request(), null), createOrder(deps, request({ pickupSlot: "10:30" }), null)]);
    expect([a.order.stampReward, b.order.stampReward].filter(Boolean)).toHaveLength(1);
    const winner = a.order.stampReward ? a : b;
    await pay(winner.checkoutUrl);
    expect((await stampCardFor(repo, await repo.getSettings(), "SAM@example.com")).rewardsAvailable).toBe(0);
    await cancelWithTerms(deps, winner.order.id, "emily");
    expect((await stampCardFor(repo, await repo.getSettings(), "sam@example.com")).rewardsAvailable).toBe(1);
  });
});
