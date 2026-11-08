import { beforeEach, describe, expect, it } from "vitest";
import { backdateMemoryRecord, memoryRepository as repo, resetMemoryStore } from "@/lib/data/memory";
import { slotAvailability } from "@/lib/services/calendar";
import { releaseStale, runDaily } from "@/lib/services/changes";
import {
  acceptPrivate,
  bookClass,
  cancelBooking,
  cancelClass,
  createSeries,
  declinePrivate,
  expireClassOffers,
  joinClassWaitlist,
  privateFromPayToken,
  requestPrivate,
  runClassMessages,
  setCheckIn,
  startPrivateDeposit,
} from "@/lib/services/classes";
import { createCorporateOrder, startCorporateBalance } from "@/lib/services/corporate";
import type { Mailer } from "@/lib/services/email";
import { runScheduledMessages } from "@/lib/services/messages";
import { advanceStage, createOrder, handlePaidSession } from "@/lib/services/orders";
import { fakeGateway } from "@/lib/services/payments";
import { referralCodeFor, stampCardFor } from "@/lib/services/referrals";
import { displayNameFor, orderForReview, submitReview } from "@/lib/services/reviews";
import { buildSnapshot } from "@/lib/services/snapshot";
import { linkToken } from "@/lib/services/tokens";
import { classBookingSchema, corporateRequestSchema, orderRequestSchema, privateRequestSchema, type ClassBookingRequest, type OrderRequest } from "@/lib/validation";

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

async function createAndPay(over: Partial<OrderRequest> = {}, d = deps) {
  const res = await createOrder(d, request(over), null);
  const s = sessionOf(res.checkoutUrl);
  if (s) await handlePaidSession(d, `evt_${s}`, s);
  return (await repo.getOrderById(res.order.id))!;
}

async function collect(orderId: string) {
  for (let i = 0; i < 5; i++) await advanceStage(deps, orderId);
}

beforeEach(() => {
  resetMemoryStore();
  sent.length = 0;
});

describe("party add-ons", () => {
  it("adds a stand with its bond, and reminds the customer to return it", async () => {
    const o = await createAndPay({ config: { ...request().config, addons: ["add-stand-hire", "add-sparklers"] }, pickupDate: "2026-11-20" });
    // 130 + 15 stand + 8 sparklers + 20 bond
    expect(o.totalCents).toBe(17300);
    expect(o.items.find((i) => i.category === "bond")?.amountCents).toBe(2000);
    await collect(o.id);
    sent.length = 0;
    const r = await runScheduledMessages(at("2026-11-23T22:00:00Z"));
    expect(r.stand_return).toBe(1);
    expect(sent.some((s) => s.subject === "Reminder: please return the cake stand")).toBe(true);
  });

  it("refuses hidden add-ons", async () => {
    await repo.updateCatalogueItem("add-sparklers", { visible: false });
    await expect(createOrder(deps, request({ config: { ...request().config, addons: ["add-sparklers"] } }), null)).rejects.toThrow(/no longer available: Sparkler/);
  });
});

describe("referrals", () => {
  it("gives the new customer money off and the referrer credit once the deposit is paid, once", async () => {
    const kim = await createAndPay({ email: "kim@example.com", customerName: "Kim Lee" });
    const code = await referralCodeFor(repo, kim.email, kim.customerName);
    expect(code).toMatch(/^KIM-[A-Z2-9]{4}$/);
    expect(await referralCodeFor(repo, kim.email, kim.customerName)).toBe(code);

    const res = await createOrder(deps, request({ email: "new@example.com", referralCode: code.toLowerCase(), pickupSlot: "10:30" }), null);
    expect(res.order.totalCents).toBe(12000);
    expect(res.order.items.find((i) => i.category === "referral")?.amountCents).toBe(-1000);
    sent.length = 0;
    await handlePaidSession(deps, "evt_ref", sessionOf(res.checkoutUrl));
    expect(sent.find((s) => s.to === "kim@example.com" && s.subject.startsWith("Your $10 credit"))).toBeTruthy();
    expect((await repo.listReferrals())[0].status).toBe("rewarded");
    // A retry of the webhook doesn't reward twice.
    expect(await handlePaidSession(deps, "evt_ref_2", sessionOf(res.checkoutUrl))).toBe(false);
    expect((await repo.listVouchers()).filter((v) => v.kind === "credit")).toHaveLength(1);
  });

  it("refuses self-referrals, existing customers and a second referral", async () => {
    const kim = await createAndPay({ email: "kim@example.com", customerName: "Kim Lee" });
    const code = await referralCodeFor(repo, kim.email, kim.customerName);
    await expect(createOrder(deps, request({ email: "kim@example.com", referralCode: code, pickupSlot: "11:00" }), null)).rejects.toThrow(/own referral code/);
    await createAndPay({ email: "old@example.com", pickupSlot: "11:00" });
    await expect(createOrder(deps, request({ email: "old@example.com", referralCode: code, pickupDate: "2026-11-27" }), null)).rejects.toThrow(/first order/);
    await createOrder(deps, request({ email: "new@example.com", referralCode: code, pickupDate: "2026-11-27" }), null);
    await expect(createOrder(deps, request({ email: "new@example.com", referralCode: code, pickupDate: "2026-11-26" }), null)).rejects.toThrow(/already been used/);
    await expect(createOrder(deps, request({ email: "x@example.com", referralCode: "NOPE-AAAA", pickupDate: "2026-11-26" }), null)).rejects.toThrow(/wasn't recognised/);
  });

  it("frees the customer to be referred again if the first order is never paid", async () => {
    const kim = await createAndPay({ email: "kim@example.com", customerName: "Kim Lee" });
    const code = await referralCodeFor(repo, kim.email, kim.customerName);
    const res = await createOrder(deps, request({ email: "new@example.com", referralCode: code, pickupSlot: "11:00" }), null);
    backdateMemoryRecord("order", res.order.id, "2026-11-07T20:00:00Z");
    await releaseStale(deps);
    expect((await repo.listReferrals())[0].status).toBe("void");
    await expect(createOrder(deps, request({ email: "new@example.com", referralCode: code, pickupDate: "2026-11-27" }), null)).resolves.toBeTruthy();
  });

  it("can be switched off", async () => {
    const kim = await createAndPay({ email: "kim@example.com", customerName: "Kim Lee" });
    const code = await referralCodeFor(repo, kim.email, kim.customerName);
    await repo.saveSettings({ ...(await repo.getSettings()), referralsEnabled: false });
    await expect(createOrder(deps, request({ email: "new@example.com", referralCode: code, pickupSlot: "11:00" }), null)).rejects.toThrow(/aren't available/);
  });
});

describe("stamp card", () => {
  it("adds a free reward to the next order after every 5th collected order, once", async () => {
    await repo.saveSettings({ ...(await repo.getSettings()), dailyCap: 10, weeklyCap: 50, slotCap: 10 });
    for (let i = 0; i < 5; i++) {
      const o = await createAndPay({ pickupDate: "2026-11-20" });
      expect(o.stampReward).toBe(false);
      await collect(o.id);
    }
    expect(await stampCardFor(repo, await repo.getSettings(), "sam@example.com")).toMatchObject({ stamps: 0, rewardsAvailable: 1 });
    const sixth = await createAndPay();
    expect(sixth.stampReward).toBe(true);
    expect(sixth.items.find((i) => i.category === "reward")?.name).toBe("Stamp card reward: 6 iced cookies");
    const seventh = await createAndPay({ pickupSlot: "10:30" });
    expect(seventh.stampReward).toBe(false);
  });
});

describe("reviews", () => {
  it("are opened by the token link, once per collected order, with only a first name and initial", async () => {
    const o = await createAndPay();
    const token = linkToken("review", o.id);
    expect(await orderForReview(deps, o.id, token)).toBeTruthy();
    expect(await orderForReview(deps, o.id, linkToken("review", "00000000-0000-4000-8000-000000000000"))).toBeNull();
    await expect(submitReview(deps, o, { rating: 5, text: "Wow", consentToPublish: true }, null)).rejects.toThrow(/once your cake has been collected/);
    await collect(o.id);
    const collected = (await repo.getOrderById(o.id))!;
    const review = await submitReview(deps, collected, { rating: 5, text: "Stunning cake!", consentToPublish: true }, { bytes: PNG, contentType: "image/png" });
    expect(review).toMatchObject({ displayName: "Sam T.", status: "pending", rating: 5 });
    expect(review.photoPath).toMatch(/^reviews\//);
    await expect(submitReview(deps, collected, { rating: 4, text: "", consentToPublish: false }, null)).rejects.toThrow(/already left a review/);
    expect(displayNameFor("Madonna")).toBe("Madonna");
  });

  it("links the thank-you email to the on-site form", async () => {
    const o = await createAndPay({ pickupDate: "2026-11-20" });
    await collect(o.id);
    sent.length = 0;
    await runScheduledMessages(at("2026-11-21T22:00:00Z"));
    expect(sent[0].text).toContain(`https://cakes.test/review/${o.id}/`);
  });

  it("refuses to publish a review without consent", async () => {
    const o = await createAndPay();
    await collect(o.id);
    const r = await submitReview(deps, (await repo.getOrderById(o.id))!, { rating: 3, text: "Private note", consentToPublish: false }, null);
    await expect(repo.setReviewStatus(r.id, "approved")).rejects.toThrow(/consent/);
  });
});

describe("corporate packages", () => {
  const corp = (over = {}) =>
    corporateRequestSchema.parse({
      packageId: "corp-cookies-48",
      companyName: "Acme Pty Ltd",
      abn: "12 345 678 901",
      contactName: "Pat Lee",
      email: "pat@acme.example",
      phone: "0400 222 333",
      pickupDate: "2026-11-27",
      pickupSlot: "09:00",
      acceptTerms: true,
      ...over,
    });

  it("takes a 50% deposit, then the balance, and holds a cake slot", async () => {
    const { order, checkoutUrl } = await createCorporateOrder(deps, corp(), { bytes: PNG, contentType: "image/png" });
    expect(order).toMatchObject({ totalCents: 33600, depositCents: 16800, abn: "12345678901", quantity: 48 });
    expect(order.logoPath).toMatch(/^corporate\/.+\/logo-.+\.png$/);
    expect(amountOf(checkoutUrl)).toBe(16800);
    expect((await slotAvailability(repo, "2026-11-27", NOW)).slots.find((s) => s.time === "09:00")?.remaining).toBe(1);
    sent.length = 0;
    await handlePaidSession(deps, "evt_corp", sessionOf(checkoutUrl));
    const paid = (await repo.getCorporateOrderById(order.id))!;
    expect(paid.status).toBe("confirmed");
    expect(sent.map((s) => s.to)).toEqual(["pat@acme.example", "emily@example.com"]);
    const balance = await startCorporateBalance(deps, paid);
    expect(amountOf(balance)).toBe(16800);
    await handlePaidSession(deps, "evt_corp_bal", sessionOf(balance));
    expect((await repo.getCorporateOrderById(order.id))?.amountPaidCents).toBe(33600);
  });

  it("refuses SVG logos, hidden packages, rush dates and bad ABNs", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(createCorporateOrder(deps, corp(), { bytes: svg, contentType: "image/svg+xml" })).rejects.toThrow(/PNG, JPG or WebP/);
    await repo.updateCorporatePackage("corp-cookies-48", { visible: false });
    await expect(createCorporateOrder(deps, corp(), null)).rejects.toThrow(/isn't available/);
    await expect(createCorporateOrder(deps, corp({ packageId: "corp-cupcakes-24", pickupDate: "2026-11-11" }), null)).rejects.toThrow(/standard notice/);
    expect(() => corp({ abn: "123" })).toThrow(/11 digits/);
  });

  it("releases unpaid corporate orders", async () => {
    const { order } = await createCorporateOrder(deps, corp(), null);
    backdateMemoryRecord("corporate", order.id, "2026-11-07T20:00:00Z");
    expect((await releaseStale(deps)).corporate).toBe(1);
    expect((await repo.getCorporateOrderById(order.id))?.status).toBe("cancelled");
  });
});

describe("classes", () => {
  async function session(seats = 8, date = "2026-11-21", type = "class-florals") {
    const [s] = await createSeries(deps, { classTypeId: type, date, startTime: "14:00", seats, everyDays: 7, count: 1 });
    return s;
  }
  const guests = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Guest ${i + 1}`, allergies: i === 0 ? "Nuts" : "" }));
  const book = (sessionId: string, seats: number, over: Partial<ClassBookingRequest> = {}) =>
    classBookingSchema.parse({ sessionId, seats, guests: guests(seats), contactName: "Ann Lee", email: "ann@example.com", phone: "0400 333 444", adultConfirmed: true, acceptTerms: true, ...over });

  async function bookAndPay(sessionId: string, seats: number, over: Partial<ClassBookingRequest> = {}) {
    const r = await bookClass(deps, book(sessionId, seats, over));
    await handlePaidSession(deps, `evt_${r.booking.id}`, sessionOf(r.checkoutUrl));
    return (await repo.getBookingById(r.booking.id))!;
  }

  it("books seats, applies the group discount, and sends the ticket", async () => {
    const s = await session();
    const r = await bookClass(deps, book(s.id, 4));
    expect(r.booking).toMatchObject({ totalCents: 34200, discountCents: 3800 });
    expect(amountOf(r.checkoutUrl)).toBe(34200);
    expect((await repo.getSession(s.id))?.booked).toBe(4);
    sent.length = 0;
    await handlePaidSession(deps, "evt_cls", sessionOf(r.checkoutUrl));
    expect((await repo.getBookingById(r.booking.id))?.status).toBe("paid");
    expect(sent[0].subject).toMatch(/^You're booked: Cake and Sip: Buttercream Florals/);
    expect(sent[1].text).toContain("ALLERGIES: Guest 1: Nuts");
  });

  it("needs the 18+ tick for sip classes but not the kids' class, and a name for every seat", async () => {
    const s = await session();
    await expect(bookClass(deps, book(s.id, 1, { adultConfirmed: false }))).rejects.toThrow(/18 or over/);
    const kids = await session(8, "2026-11-22", "class-kids");
    await expect(bookClass(deps, book(kids.id, 1, { adultConfirmed: false }))).resolves.toBeTruthy();
    expect(classBookingSchema.safeParse({ ...book(s.id, 2), guests: guests(1) }).success).toBe(false);
  });

  it("never overbooks, even with many people booking at once", async () => {
    const s = await session(8);
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => bookClass(deps, book(s.id, 2, { email: `p${i}@example.com` }))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    expect((await repo.getSession(s.id))?.booked).toBe(8);
  });

  it("runs the sold-out waitlist: the offer holds seats for 24 hours, then moves on", async () => {
    const s = await session(2);
    const first = await bookAndPay(s.id, 2);
    await expect(joinClassWaitlist(deps, { sessionId: s.id, seats: 1, customerName: "Bea Wu", email: "bea@example.com", phone: "0400111222" })).resolves.toEqual({ place: 1 });
    await joinClassWaitlist(deps, { sessionId: s.id, seats: 2, customerName: "Cal Ng", email: "cal@example.com", phone: "0400111333" });

    await cancelBooking(deps, first.id);
    // Bea's offer holds 1 seat; Cal (2 seats) can't fit until it's released.
    expect((await repo.getSession(s.id))?.booked).toBe(1);
    const offer = sent.find((m) => m.to === "bea@example.com" && m.subject.startsWith("Seats opened"))!;
    const token = /\/classes\/claim\/([A-Za-z0-9_-]{43})/.exec(offer.text)![1];

    // Someone else can only take the free seat, not the held one.
    await expect(bookClass(deps, book(s.id, 2, { email: "z@example.com" }))).rejects.toThrow(/only 1 seat is left/);

    // Bea doesn't claim in time: her seat is released and the offer goes to Cal (who needs 2).
    const later = at("2026-11-09T00:00:00Z");
    expect(await expireClassOffers(later)).toEqual({ expired: 1, offered: 1 });
    expect((await repo.getSession(s.id))?.booked).toBe(2);
    const calOffer = sent.find((m) => m.to === "cal@example.com" && m.subject.startsWith("Seats opened"))!;
    const calToken = /\/classes\/claim\/([A-Za-z0-9_-]{43})/.exec(calOffer.text)![1];
    await expect(bookClass(later, book(s.id, 2, { email: "cal@example.com", waitlistToken: token }))).rejects.toThrow(/expired/);
    const r = await bookClass(later, book(s.id, 2, { email: "cal@example.com", waitlistToken: calToken }));
    expect(r.booking.waitlistId).toBeTruthy();
    expect((await repo.getSession(s.id))?.booked).toBe(2); // the held seats became Cal's booking
  });

  it("cancels a whole class, recording every refund for Emily", async () => {
    const s = await session(8);
    const a = await bookAndPay(s.id, 2);
    const b = await bookAndPay(s.id, 1, { email: "b@example.com" });
    sent.length = 0;
    const { refunds } = await cancelClass(deps, s.id);
    expect(refunds).toEqual([
      { reference: a.reference, cents: 19000 },
      { reference: b.reference, cents: 9500 },
    ]);
    expect((await repo.getBookingById(a.id))?.cancellation).toMatchObject({ by: "emily", refundCents: 19000 });
    expect(sent.filter((m) => m.subject.startsWith("Class cancelled"))).toHaveLength(3);
    expect((await repo.getSession(s.id))?.status).toBe("cancelled");
  });

  it("checks guests in", async () => {
    const s = await session();
    const b = await bookAndPay(s.id, 2);
    await setCheckIn(repo, b.id, 1, true);
    expect((await repo.getBookingById(b.id))?.guests.map((g) => g.checkedIn)).toEqual([false, true]);
  });

  it("creates a weekly series, skipping days off", async () => {
    await repo.addDayOff({ date: "2026-11-28", note: "Away" });
    const created = await createSeries(deps, { classTypeId: "class-drip", date: "2026-11-21", startTime: "18:00", seats: 6, everyDays: 7, count: 4 });
    expect(created.map((s) => s.date)).toEqual(["2026-11-21", "2026-12-05", "2026-12-12"]);
    expect(new Set(created.map((s) => s.seriesId)).size).toBe(1);
  });

  it("blocks cake orders on class days (a setting)", async () => {
    await session(8, "2026-11-21");
    expect((await slotAvailability(repo, "2026-11-21", NOW)).bookable).toBe(false);
    await repo.saveSettings({ ...(await repo.getSettings()), classBlocksCakes: false });
    expect((await slotAvailability(repo, "2026-11-21", NOW)).bookable).toBe(true);
  });

  it("sends the class reminder and thank-you once each", async () => {
    const s = await session(8, "2026-11-21");
    await bookAndPay(s.id, 2);
    sent.length = 0;
    expect(await runClassMessages(at("2026-11-19T22:00:00Z"))).toEqual({ class_reminder: 1, class_thank_you: 0 });
    expect(await runClassMessages(at("2026-11-19T23:00:00Z"))).toEqual({ class_reminder: 0, class_thank_you: 0 });
    expect(await runClassMessages(at("2026-11-21T22:00:00Z"))).toEqual({ class_reminder: 0, class_thank_you: 1 });
    expect(sent.map((m) => m.subject)).toEqual(["See you soon: Cake and Sip: Buttercream Florals", "Thanks for coming to Cake and Sip: Buttercream Florals!"]);
  });

  it("releases unpaid bookings with the daily job", async () => {
    const s = await session(8);
    const r = await bookClass(deps, book(s.id, 3));
    backdateMemoryRecord("booking", r.booking.id, "2026-11-07T20:00:00Z");
    const daily = await runDaily(deps);
    expect(daily.released.bookings).toBe(1);
    expect((await repo.getSession(s.id))?.booked).toBe(0);
  });
});

describe("private group classes", () => {
  const ask = (over = {}) =>
    privateRequestSchema.parse({ packageKey: "deluxe", guests: 8, preferredDate: "2026-12-12", preferredTime: "14:00", occasion: "Hens", customerName: "Jo Park", email: "jo@example.com", phone: "0400555666", ...over });

  it("goes from request to accepted to deposit paid", async () => {
    const r = await requestPrivate(deps, ask());
    expect(r).toMatchObject({ estimateCents: 96000, depositCents: 15000, status: "requested" });
    expect(sent.map((s) => s.to)).toEqual(["jo@example.com", "emily@example.com"]);
    sent.length = 0;
    await acceptPrivate(deps, r.id);
    await expect(acceptPrivate(deps, r.id)).rejects.toThrow(/already been answered/);
    const token = /\/p\/([A-Za-z0-9_-]{43})/.exec(sent[0].text)![1];
    const found = (await privateFromPayToken(repo, token))!;
    const url = await startPrivateDeposit(deps, found, token);
    expect(amountOf(url)).toBe(15000);
    await handlePaidSession(deps, "evt_pvt", sessionOf(url));
    expect((await repo.getPrivateRequest(r.id))?.status).toBe("paid");
    // An accepted private class day takes no cake orders.
    expect((await slotAvailability(repo, "2026-12-12", NOW)).bookable).toBe(false);
  });

  it("checks group sizes and dates, and can be declined", async () => {
    await expect(requestPrivate(deps, ask({ guests: 12 }))).rejects.toThrow(/6 to 10/);
    await expect(requestPrivate(deps, ask({ preferredDate: "2026-11-10" }))).rejects.toThrow(/a week away/);
    const kids = await requestPrivate(deps, ask({ packageKey: "kids", guests: 6 }));
    expect(kids).toMatchObject({ estimateCents: 30000, depositCents: 10000 });
    await declinePrivate(deps, kids.id);
    expect((await repo.getPrivateRequest(kids.id))?.status).toBe("declined");
  });
});

describe("sales snapshot", () => {
  it("summarises this month, balances owed, capacity and credit", async () => {
    await createAndPay();
    await createAndPay({ pickupSlot: "10:30", config: { ...request().config, flavour: "fl-chocolate" } });
    const snap = await buildSnapshot(repo, NOW);
    expect(snap.month).toBe("2026-11");
    expect(snap.thisMonth).toMatchObject({ orders: 2, revenueCents: 26000, depositsCents: 13000, averageCents: 13000 });
    expect(snap.thisMonth.topFlavours.map((f) => f.name).sort()).toEqual(["Chocolate mud", "Vanilla bean"]);
    expect(snap.balances).toHaveLength(2);
    expect(snap.balancesTotalCents).toBe(13000);
    expect(snap.capacity).toHaveLength(4);
    expect(snap.capacity.reduce((s, w) => s + w.booked, 0)).toBe(2);
    expect(snap.lastMonth.orders).toBe(0);
  });
});
