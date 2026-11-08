import { beforeEach, describe, expect, it } from "vitest";
import { backdateMemoryRecord, memoryRepository as repo, resetMemoryStore } from "@/lib/data/memory";
import { createBoxOrder } from "@/lib/services/boxes";
import { approveDesign, cancelWithTerms, changeDate, releaseStale, requestDesignChange, runDaily, sendForApproval } from "@/lib/services/changes";
import type { Mailer } from "@/lib/services/email";
import { runScheduledMessages, sendOnce } from "@/lib/services/messages";
import { advanceStage, createOrder, handlePaidSession, slotAvailability } from "@/lib/services/orders";
import { fakeGateway } from "@/lib/services/payments";
import { hashCode, voucherCode } from "@/lib/services/tokens";
import { checkCode, issueCredit, startVoucherPurchase } from "@/lib/services/vouchers";
import { expireOffers, joinWaitlist, offerFromToken } from "@/lib/services/waitlist";
import { boxOrderRequestSchema, orderRequestSchema, voucherPurchaseSchema, type OrderRequest } from "@/lib/validation";

process.env.DATA_ADAPTER = "memory";
process.env.ADMIN_NOTIFY_EMAIL = "emily@example.com";

const sent: { to: string; subject: string; text: string }[] = [];
let failNext = false;
const mailer: Mailer = {
  async send(e) {
    if (failNext) {
      failNext = false;
      throw new Error("mail down");
    }
    sent.push({ to: e.to, subject: e.subject, text: e.text });
  },
};

// 10am Sun 8 Nov 2026 in Sydney.
const NOW = new Date("2026-11-07T23:00:00Z");
const deps = { repo, payments: fakeGateway, mailer, baseUrl: "https://cakes.test", now: NOW };
const at = (iso: string) => ({ ...deps, now: new Date(iso) });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function request(over: Partial<OrderRequest> = {}): OrderRequest {
  return orderRequestSchema.parse({
    config: { occasion: "occ-birthday", size: "size-6-round", flavour: "fl-vanilla", finish: "fin-drip", colour: "col-blush", decorations: [], extras: [], topperText: "" },
    dietary: [],
    pickupDate: "2026-11-28",
    pickupSlot: "10:00",
    customerName: "Sam Taylor",
    email: "sam@example.com",
    phone: "0400 000 000",
    acceptTerms: true,
    ...over,
  });
}

const sessionOf = (url: string) => new URL(url, "https://x").searchParams.get("session")!;

async function createAndPay(over: Partial<OrderRequest> = {}, d = deps) {
  const res = await createOrder(d, request(over), null);
  const s = sessionOf(res.checkoutUrl);
  if (s) await handlePaidSession(d, `evt_${s}`, s);
  return (await repo.getOrderById(res.order.id))!;
}

/** A paid gift voucher; returns its code. */
async function giftVoucher(amountCents = 10000) {
  const { checkoutUrl, voucher } = await startVoucherPurchase(
    deps,
    voucherPurchaseSchema.parse({ amountCents, buyerName: "Kim Lee", buyerEmail: "kim@example.com", recipientName: "Sam", recipientEmail: "sam@example.com", acceptTerms: true }),
  );
  await handlePaidSession(deps, `evt_${voucher.id}`, sessionOf(checkoutUrl));
  return voucherCode(voucher.id);
}

beforeEach(() => {
  resetMemoryStore();
  sent.length = 0;
  failNext = false;
});

describe("gift vouchers", () => {
  it("are emailed to buyer and recipient after payment, storing only a hash", async () => {
    const code = await giftVoucher(5000);
    expect(sent.map((s) => s.to)).toEqual(["kim@example.com", "sam@example.com"]);
    expect(sent[0].text).toContain(code);
    const [v] = await repo.listVouchers();
    expect(v).toMatchObject({ status: "active", balanceCents: 5000, codeLast4: code.slice(-4), expiresOn: "2027-11-08" });
    expect(JSON.stringify(v)).not.toContain(code.replace(/-/g, ""));
    expect(await checkCode(repo, code.toLowerCase(), "2026-11-08")).toMatchObject({ ok: true, balanceCents: 5000 });
  });

  it("only sells the amounts Emily offers", async () => {
    const s = await repo.getSettings();
    await repo.saveSettings({ ...s, voucherOptions: s.voucherOptions.map((o) => (o.cents === 5000 ? { ...o, visible: false } : o)), voucherCustomEnabled: false });
    const buy = (amountCents: number) =>
      startVoucherPurchase(deps, voucherPurchaseSchema.parse({ amountCents, buyerName: "Kim Lee", buyerEmail: "kim@example.com", recipientName: "Sam", acceptTerms: true }));
    await expect(buy(5000)).rejects.toThrow(/voucher amounts/);
    await expect(buy(7700)).rejects.toThrow(/voucher amounts/);
    await expect(buy(10000)).resolves.toBeTruthy();
  });

  it("can be used in part, with the rest kept for next time", async () => {
    const code = await giftVoucher(10000);
    const res = await createOrder(deps, request({ voucherCode: code }), null);
    // $155 total, $78 deposit: the voucher covers the deposit, nothing to pay at checkout.
    expect(res.checkoutUrl).toMatch(/\/o\/.+\?paid=1$/);
    const o = (await repo.getOrderById(res.order.id))!;
    expect(o).toMatchObject({ stage: "received", voucherAppliedCents: 10000, amountPaidCents: 0 });
    expect((await checkCode(repo, code, "2026-11-08")).ok).toBe(false);

    const code2 = await giftVoucher(5000);
    const res2 = await createOrder(deps, request({ voucherCode: code2, email: "b@example.com" }), null);
    expect(new URL(res2.checkoutUrl, "https://x").searchParams.get("amount")).toBe("2800"); // 78 - 50
    await handlePaidSession(deps, "evt_p2", sessionOf(res2.checkoutUrl));
    const o2 = (await repo.getOrderById(res2.order.id))!;
    expect(o2).toMatchObject({ amountPaidCents: 2800, voucherAppliedCents: 5000 });
  });

  it("refuses bad codes before creating anything", async () => {
    await expect(createOrder(deps, request({ voucherCode: "nope" }), null)).rejects.toThrow(/wasn't recognised/);
    await expect(createOrder(deps, request({ voucherCode: "AAAA-BBBB-CCCC-DDDD" }), null)).rejects.toThrow(/wasn't recognised/);
    expect(await repo.listOrders({ includeUnpaid: true })).toHaveLength(0);
  });

  it("can't be spent twice at the same time", async () => {
    const code = await giftVoucher(5000);
    const results = await Promise.allSettled([
      createOrder(deps, request({ voucherCode: code }), null),
      createOrder(deps, request({ voucherCode: code, email: "b@example.com", pickupSlot: "10:30" }), null),
    ]);
    const orders = await repo.listOrders({ includeUnpaid: true });
    const applied = orders.reduce((s, o) => s + o.voucherAppliedCents, 0);
    expect(applied).toBe(5000);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("cancelling with terms", () => {
  it("records the refund for Emily to make in Stripe, 14+ days out", async () => {
    const o = await createAndPay(); // pickup 28 Nov, 20 days out, $78 paid
    sent.length = 0;
    const r = await cancelWithTerms(deps, o.id, "customer");
    expect(r).toMatchObject({ by: "customer", daysOut: 20, refundCents: 5800, keptCents: 2000 });
    expect((await repo.getOrderById(o.id))?.stage).toBe("cancelled");
    expect(sent.map((s) => s.subject)).toEqual([`Order ${o.reference} cancelled`, `Cancelled: ${o.reference} (refund $58 in Stripe)`]);
    await expect(cancelWithTerms(deps, o.id, "customer")).rejects.toThrow(/cancelled/);
  });

  it("issues a credit code 7 to 13 days out", async () => {
    const o = await createAndPay();
    sent.length = 0;
    const r = await cancelWithTerms(at("2026-11-17T23:00:00Z"), o.id, "customer"); // 10 days out
    expect(r).toMatchObject({ refundCents: 0, creditCents: 7800 });
    const [credit] = await repo.listVouchers();
    expect(credit).toMatchObject({ kind: "credit", balanceCents: 7800, buyerEmail: "sam@example.com", sourceOrderId: o.id });
    const email = sent.find((s) => s.subject.startsWith("Your $78 credit"));
    expect(email?.text).toContain(voucherCode(credit.id));
  });

  it("returns voucher money as credit, even inside 7 days", async () => {
    const code = await giftVoucher(5000);
    const res = await createOrder(deps, request({ voucherCode: code }), null);
    await handlePaidSession(deps, "evt_x", sessionOf(res.checkoutUrl));
    const r = await cancelWithTerms(at("2026-11-23T23:00:00Z"), res.order.id, "customer"); // 4 days out
    expect(r).toMatchObject({ refundCents: 0, creditCents: 0, keptCents: 2800, voucherReturnedCents: 5000 });
    expect(await checkCode(repo, code, "2026-11-24")).toMatchObject({ ok: true, balanceCents: 5000 });
  });

  it("reissues voucher money as a new credit code if the voucher has expired", async () => {
    const code = await giftVoucher(5000);
    const res = await createOrder(deps, request({ voucherCode: code }), null);
    const v = (await repo.getVoucherByCodeHash(hashCode(code)))!;
    await repo.setVoucherStatus(v.id, "void");
    await cancelWithTerms(deps, res.order.id, "emily");
    const credits = (await repo.listVouchers()).filter((x) => x.kind === "credit");
    expect(credits).toHaveLength(1);
    expect(credits[0].balanceCents).toBe(5000);
  });

  it("refunds everything when Emily cancels and offers the date to the waitlist", async () => {
    const s = await repo.getSettings();
    await repo.saveSettings({ ...s, dailyCap: 1 });
    const o = await createAndPay();
    const { place } = await joinWaitlist(deps, { date: "2026-11-28", config: request().config, dietary: [], customerName: "Ann Lee", email: "ann@example.com", phone: "0400111222" });
    expect(place).toBe(1);
    sent.length = 0;
    const r = await cancelWithTerms(deps, o.id, "emily");
    expect(r).toMatchObject({ by: "emily", refundCents: 7800 });
    expect(sent.some((m) => m.to === "ann@example.com" && m.subject.startsWith("A spot opened"))).toBe(true);
  });
});

describe("waitlist", () => {
  async function fullDay() {
    const s = await repo.getSettings();
    await repo.saveSettings({ ...s, dailyCap: 1 });
    return createAndPay();
  }
  const join = (email: string) =>
    joinWaitlist(deps, { date: "2026-11-28", config: request().config, dietary: [], customerName: "Wait Person", email, phone: "0400111222" });

  it("only takes names for full dates, once each", async () => {
    await expect(join("a@example.com")).rejects.toThrow(/has room/);
    await fullDay();
    expect((await join("a@example.com")).place).toBe(1);
    expect((await join("b@example.com")).place).toBe(2);
    await expect(join("a@example.com")).rejects.toThrow(/already on the waitlist/);
  });

  it("holds the place for 24 hours, then moves to the next person", async () => {
    const o = await fullDay();
    await join("a@example.com");
    await join("b@example.com");
    await cancelWithTerms(deps, o.id, "emily");
    const list = await repo.listWaitlist({ date: "2026-11-28" });
    expect(list.map((e) => e.status)).toEqual(["offered", "waiting"]);
    // The held place is not open to anyone else.
    expect((await slotAvailability(repo, "2026-11-28", NOW)).bookable).toBe(false);
    // 25 hours later nobody has claimed it.
    const later = at("2026-11-09T00:00:00Z");
    expect(await expireOffers(later)).toEqual({ expired: 1, offered: 1 });
    expect((await repo.listWaitlist({ date: "2026-11-28" })).map((e) => e.status)).toEqual(["expired", "offered"]);
    expect(await expireOffers(later)).toEqual({ expired: 0, offered: 0 });
  });

  it("lets the person with the offer book it with their saved cake", async () => {
    const o = await fullDay();
    await join("a@example.com");
    await cancelWithTerms(deps, o.id, "emily");
    const offer = sent.find((m) => m.subject.startsWith("A spot opened"))!;
    const token = /\/waitlist\/([A-Za-z0-9_-]{43})/.exec(offer.text)![1];
    expect(await offerFromToken(deps, token)).toBeTruthy();
    // Someone else can't take it...
    await expect(createOrder(deps, request({ email: "c@example.com" }), null)).rejects.toThrow(/not available/);
    // ...but the holder can.
    const claimed = await createAndPay({ email: "a@example.com", waitlistToken: token });
    expect(claimed.waitlistId).toBeTruthy();
    expect((await repo.getWaitlistById(claimed.waitlistId!))?.status).toBe("claimed");
    expect(await offerFromToken(deps, token)).toBeNull();
    await expect(createOrder(deps, request({ email: "d@example.com", waitlistToken: token }), null)).rejects.toThrow(/expired/);
  });
});

describe("automatic messages", () => {
  it("never sends the same message twice, even if the job runs twice at once", async () => {
    const o = await createAndPay({ pickupDate: "2026-11-20" });
    sent.length = 0;
    const d = at("2026-11-15T22:00:00Z");
    const [a, b] = await Promise.all([runScheduledMessages(d), runScheduledMessages(d)]);
    expect(a.balance_reminder + b.balance_reminder).toBe(1);
    expect(sent.filter((s) => s.subject.startsWith("Balance due"))).toHaveLength(1);
    expect(await sendOnce(d, o.id, "balance_reminder", { to: "x", subject: "x", text: "", html: "" })).toBe(false);
  });

  it("tries again next time if sending failed", async () => {
    const o = await createAndPay({ pickupDate: "2026-11-20" });
    failNext = true;
    expect((await runScheduledMessages(at("2026-11-15T22:00:00Z"))).balance_reminder).toBe(0);
    expect((await runScheduledMessages(at("2026-11-15T23:00:00Z"))).balance_reminder).toBe(1);
    expect((await repo.listMessages(o.id)).filter((m) => m.key === "balance_reminder")).toHaveLength(1);
  });

  it("respects Emily's switches", async () => {
    await repo.saveAutomation({ key: "order_received", enabled: false, days: 0 });
    await createAndPay();
    expect(sent.find((s) => s.to === "sam@example.com")).toBeUndefined();
    expect(sent.find((s) => s.to === "emily@example.com")).toBeTruthy(); // Emily still hears about new orders
  });

  it("sends the thank-you with the review link, and the birthday reminder next year", async () => {
    const s = await repo.getSettings();
    await repo.saveSettings({ ...s, reviewUrl: "https://g.page/r/example/review" });
    const o = await createAndPay({ remindNextYear: true, pickupDate: "2026-11-20" });
    expect(o.remindNextYear).toBe(true);
    for (let i = 0; i < 5; i++) await advanceStage(deps, o.id); // through to collected
    expect((await repo.getOrderById(o.id))?.stage).toBe("collected");
    sent.length = 0;
    const r = await runScheduledMessages(at("2026-11-21T22:00:00Z"));
    expect(r.thank_you).toBe(1);
    expect(sent[0].text).toContain("https://g.page/r/example/review");
    expect((await runScheduledMessages(at("2027-10-21T22:00:00Z"))).rebook_reminder).toBe(1);
  });

  it("only keeps the birthday reminder for birthday orders", async () => {
    const o = await createAndPay({ remindNextYear: true, config: { ...request().config, occasion: "occ-baptism" } });
    expect(o.remindNextYear).toBe(false);
  });
});

describe("design approval", () => {
  it("goes from sketch to approval, with one free change round", async () => {
    const o = await createAndPay();
    sent.length = 0;
    await sendForApproval(deps, o.id, "Pink drip with gold", { bytes: PNG, contentType: "image/png" });
    expect((await repo.getOrderById(o.id))?.stage).toBe("awaiting_approval");
    expect(sent[0].subject).toBe("Your cake design is ready to approve");

    expect(await requestDesignChange(deps, o.id, "More gold please")).toEqual({ extraRound: false });
    expect((await repo.getOrderById(o.id))?.stage).toBe("received");
    await sendForApproval(deps, o.id, "Now with more gold", null);
    expect(await requestDesignChange(deps, o.id, "Actually blue")).toEqual({ extraRound: true });
    await sendForApproval(deps, o.id, "Blue", null);
    sent.length = 0;
    await approveDesign(deps, o.id);
    const after = (await repo.getOrderById(o.id))!;
    expect(after.stage).toBe("design_confirmed");
    expect(after.approvedAt).toBeTruthy();
    expect(sent.map((s) => s.subject).sort()).toEqual([`Design approved: ${o.reference}`, "Your cake update: Design confirmed"].sort());
    await expect(approveDesign(deps, o.id)).rejects.toThrow(/no design waiting/);
  });

  it("closes design changes at the cut-off", async () => {
    const o = await createAndPay();
    await sendForApproval(deps, o.id, "Sketch", null);
    await expect(requestDesignChange(at("2026-11-23T23:00:00Z"), o.id, "Change it")).rejects.toThrow(/closed 7 days/);
  });
});

describe("changing the date", () => {
  it("moves once for free, capacity-checked, and frees the old slot", async () => {
    const o = await createAndPay();
    await changeDate(deps, o.id, "2026-11-27", "11:00");
    const moved = (await repo.getOrderById(o.id))!;
    expect(moved).toMatchObject({ pickupDate: "2026-11-27", pickupSlot: "11:00", dateChangesUsed: 1 });
    expect((await slotAvailability(repo, "2026-11-28", NOW)).slots.find((s) => s.time === "10:00")?.remaining).toBe(2);
    await expect(changeDate(deps, o.id, "2026-11-26", "11:00")).rejects.toThrow(/used your free date change/);
  });

  it("refuses closed days, full slots, rush dates and different prices", async () => {
    const o = await createAndPay();
    await expect(changeDate(deps, o.id, "2026-11-30", "10:00")).rejects.toThrow(/not available/); // Monday
    await expect(changeDate(deps, o.id, "2026-11-12", "10:00")).rejects.toThrow(/notice period/);
    await expect(changeDate(deps, o.id, "2026-12-24", "10:00")).rejects.toThrow(/different price/);
    await createAndPay({ email: "b@example.com", pickupDate: "2026-11-27" });
    await createAndPay({ email: "c@example.com", pickupDate: "2026-11-27" });
    await expect(changeDate(deps, o.id, "2026-11-27", "10:00")).rejects.toThrow(/full/);
  });
});

describe("seasonal boxes", () => {
  const BOX = "b0000000-0000-4000-8000-000000000001";
  const boxReq = (quantity: number, over = {}) =>
    boxOrderRequestSchema.parse({ boxId: BOX, quantity, pickupDate: "2026-12-19", pickupSlot: "10:00", customerName: "Kim Lee", email: "kim@example.com", phone: "0400000000", acceptTerms: true, ...over });

  it("takes stock at checkout, confirms on payment and never oversells", async () => {
    await repo.updateBox(BOX, { cap: 3 });
    const a = await createBoxOrder(deps, boxReq(2));
    await expect(createBoxOrder(deps, boxReq(2))).rejects.toThrow(/aren't enough/);
    await createBoxOrder(deps, boxReq(1));
    expect((await repo.getBox(BOX))?.sold).toBe(3);
    sent.length = 0;
    await handlePaidSession(deps, "evt_box", sessionOf(a.checkoutUrl));
    expect((await repo.getBoxOrderById(a.order.id))?.status).toBe("paid");
    expect(sent.map((s) => s.to)).toEqual(["kim@example.com", "emily@example.com"]);
  });

  it("puts stock back when a checkout is abandoned", async () => {
    const a = await createBoxOrder(deps, boxReq(2));
    backdateMemoryRecord("box", a.order.id, "2026-11-07T20:00:00Z");
    expect(await releaseStale(deps)).toMatchObject({ orders: 0, boxes: 1 });
    expect((await repo.getBox(BOX))?.sold).toBe(0);
    expect((await repo.getBoxOrderById(a.order.id))?.status).toBe("cancelled");
  });

  it("checks the pickup window, closed days and hidden boxes", async () => {
    await expect(createBoxOrder(deps, boxReq(1, { pickupDate: "2026-12-10" }))).rejects.toThrow(/pickup window/);
    await expect(createBoxOrder(deps, boxReq(1, { pickupDate: "2026-12-21" }))).rejects.toThrow(/closed/); // Monday
    await repo.updateBox(BOX, { visible: false });
    await expect(createBoxOrder(deps, boxReq(1))).rejects.toThrow(/isn't available/);
  });
});

describe("the daily job", () => {
  it("releases abandoned cake checkouts, giving back voucher money", async () => {
    const code = await giftVoucher(5000);
    const res = await createOrder(deps, request({ voucherCode: code }), null);
    backdateMemoryRecord("order", res.order.id, "2026-11-07T20:00:00Z");
    const result = await runDaily(deps);
    expect(result.released.orders).toBe(1);
    expect((await repo.getOrderById(res.order.id))?.cancellation?.by).toBe("expired");
    expect(await checkCode(repo, code, "2026-11-08")).toMatchObject({ ok: true, balanceCents: 5000 });
    // Running again changes nothing.
    expect((await runDaily(deps)).released.orders).toBe(0);
  });

  it("issues credit codes that can be spent like vouchers", async () => {
    const v = await issueCredit(deps, { email: "sam@example.com", name: "Sam", amountCents: 3000, reason: "test.", sourceOrderId: null });
    const res = await createOrder(deps, request({ voucherCode: voucherCode(v!.id) }), null);
    expect(new URL(res.checkoutUrl, "https://x").searchParams.get("amount")).toBe("4800");
  });
});
