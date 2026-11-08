import { beforeEach, describe, expect, it } from "vitest";
import { memoryRepository as repo, resetMemoryStore } from "@/lib/data/memory";
import { acceptPrivate, bookClass, cancelSomeSeats, createSeries, privateFromPayToken, requestPrivate, startPrivateDeposit } from "@/lib/services/classes";
import type { Mailer } from "@/lib/services/email";
import { createOrder, handlePaidSession } from "@/lib/services/orders";
import { fakeGateway } from "@/lib/services/payments";
import { reduceGuests, reduceGuestsPreview } from "@/lib/services/private-reduce";
import { applyCodeToShare, joinAsGuest } from "@/lib/services/split";
import { linkToken, voucherCode } from "@/lib/services/tokens";
import { startVoucherPurchase } from "@/lib/services/vouchers";
import { classBookingSchema, orderRequestSchema, privateRequestSchema, voucherPurchaseSchema } from "@/lib/validation";

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
let evt = 0;
async function pay(url: string, d: typeof deps = deps) {
  const s = sessionOf(url);
  return handlePaidSession(d, `evtg_${++evt}`, s, `pi_fake_${s.slice(8)}`);
}
const autoRefundsOn = async () => repo.saveSettings({ ...(await repo.getSettings()), autoRefunds: true });

/** A paid deluxe private class ($120pp, $150 deposit) for 8 guests on Sat 12 Dec: shares are $101.25 each. */
async function paidPrivate(guests = 8, date = "2026-12-12") {
  const r = await requestPrivate(
    deps,
    privateRequestSchema.parse({ packageKey: "deluxe", guests, preferredDate: date, preferredTime: "14:00", customerName: "Jo Park", email: "jo@example.com", phone: "0400555666" }),
  );
  await acceptPrivate(deps, r.id);
  const token = linkToken("organiser", r.id);
  const found = (await privateFromPayToken(repo, token))!;
  await pay(await startPrivateDeposit(deps, found, token));
  return (await repo.getPrivateRequest(r.id))!;
}

/** A guest joins and pays their share by card. */
async function paidGuest(requestId: string, name: string) {
  const g = await joinAsGuest(deps, { shareToken: linkToken("share", requestId), name, email: `${name.toLowerCase()}@example.com`, allergies: "", dietary: [], messageOptIn: false, pay: true });
  await pay(g.checkoutUrl!);
}

beforeEach(() => {
  resetMemoryStore();
  sent.length = 0;
});

describe("saving the automatic refund onto a partial seat cancellation", () => {
  it("stores the Stripe refund ids on the booking's record", async () => {
    await autoRefundsOn();
    const [s] = await createSeries(deps, { classTypeId: "class-florals", date: "2026-11-21", startTime: "14:00", seats: 8, everyDays: 7, count: 1 });
    const r = await bookClass(
      deps,
      classBookingSchema.parse({
        sessionId: s.id,
        seats: 3,
        guests: [{ name: "A" }, { name: "B" }, { name: "C" }].map((g) => ({ ...g, allergies: "" })),
        contactName: "Ann Lee",
        email: "ann@example.com",
        phone: "0400 333 444",
        adultConfirmed: true,
        acceptTerms: true,
      }),
    );
    await pay(r.checkoutUrl);
    const record = await cancelSomeSeats(deps, r.booking.id, [2]);
    expect(record.refundIds?.length).toBeGreaterThan(0);
    const saved = (await repo.getBookingById(r.booking.id))!.partialCancellations![0];
    expect(saved.autoRefundedCents).toBe(9500);
    expect(saved.refundIds).toEqual(record.refundIds);
  });

  it("leaves the record without refund ids when refunds are by hand", async () => {
    const [s] = await createSeries(deps, { classTypeId: "class-florals", date: "2026-11-21", startTime: "14:00", seats: 8, everyDays: 7, count: 1 });
    const r = await bookClass(
      deps,
      classBookingSchema.parse({
        sessionId: s.id,
        seats: 2,
        guests: [{ name: "A", allergies: "" }, { name: "B", allergies: "" }],
        contactName: "Ann Lee",
        email: "ann@example.com",
        phone: "0400 333 444",
        adultConfirmed: true,
        acceptTerms: true,
      }),
    );
    await pay(r.checkoutUrl);
    await cancelSomeSeats(deps, r.booking.id, [1]);
    const saved = (await repo.getBookingById(r.booking.id))!.partialCancellations![0];
    expect(saved.refundIds).toBeUndefined();
  });
});

describe("fewer guests for a private class", () => {
  it("the organiser removes unpaid places and the rest are worked out again", async () => {
    const r = await paidPrivate();
    await paidGuest(r.id, "Bea");
    await paidGuest(r.id, "Cal");
    sent.length = 0;
    const { quote } = await reduceGuestsPreview(deps, r, 6, { by: "organiser" });
    expect(quote).toMatchObject({ ok: true, newTotalCents: 72000, refundCents: 0 });
    expect(quote.removeOpenIds).toHaveLength(2);
    expect(quote.removePaid).toHaveLength(0);

    const rec = await reduceGuests(deps, r.id, 6, { by: "organiser" });
    expect(rec).toMatchObject({ from: 8, to: 6, by: "organiser" });
    const after = (await repo.getPrivateRequest(r.id))!;
    expect(after).toMatchObject({ guests: 6, estimateCents: 72000 });
    expect(after.guestReductions).toHaveLength(1);
    const guests = await repo.listGuests(r.id);
    expect(guests).toHaveLength(6);
    // $720 - $150 deposit - 2 x $101.25 paid = $367.50 across 4 open places.
    const open = guests.filter((g) => g.status === "open");
    expect(open.map((g) => g.shareCents).reduce((a, b) => a + b, 0)).toBe(36750);
    expect(open).toHaveLength(4);
    expect(guests.filter((g) => g.status === "paid").map((g) => g.name)).toEqual(["Bea", "Cal"]);
    expect(sent.some((m) => m.to === "jo@example.com" && m.subject.startsWith("Guest numbers updated"))).toBe(true);
    expect(sent.some((m) => m.to === "emily@example.com" && m.subject.startsWith("Guest numbers lowered"))).toBe(true);
  });

  it("never goes below the package minimum, and the organiser can't remove paid places", async () => {
    const r = await paidPrivate();
    expect((await reduceGuestsPreview(deps, r, 5, { by: "emily" })).quote.problem).toMatch(/at least 6/);
    for (const n of ["Ann", "Bo", "Cy"]) await paidGuest(r.id, n);
    const r2 = (await repo.getPrivateRequest(r.id))!;
    // 8 places, 3 paid, 5 open: going to 6 only needs open places, so it's fine...
    expect((await reduceGuestsPreview(deps, r2, 6, { by: "organiser" })).quote.ok).toBe(true);
    // ...but if 6 have paid, going to 6 from 8 needs only the 2 open places; going lower than paid needs Emily.
    for (const n of ["Di", "Ed", "Fi"]) await paidGuest(r.id, n);
    const r3 = (await repo.getPrivateRequest(r.id))!;
    await paidGuest(r.id, "Gus");
    const q = (await reduceGuestsPreview(deps, r3, 6, { by: "organiser" })).quote;
    expect(q.ok).toBe(false);
    expect(q.problem).toMatch(/already paid/);
  });

  it("the organiser can only do it until the shares are due", async () => {
    const r = await paidPrivate();
    // Shares are due 7 days before 12 Dec, so on 5 Dec it's too late.
    const late = at("2026-12-04T23:00:00Z");
    const { quote } = await reduceGuestsPreview(late, r, 6, { by: "organiser" });
    expect(quote.ok).toBe(false);
    expect(quote.problem).toMatch(/message Emily/);
    // Emily still can.
    expect((await reduceGuestsPreview(late, r, 6, { by: "emily" })).quote.ok).toBe(true);
  });

  it("Emily removes paid places: refunds under the terms, and the organiser gets back what's over the new total", async () => {
    await autoRefundsOn();
    const r = await paidPrivate();
    for (const n of ["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8"]) await paidGuest(r.id, n);
    const full = (await repo.getPrivateRequest(r.id))!;
    const { quote } = await reduceGuestsPreview(deps, full, 6, { by: "emily" });
    // 34 days out: full refund window. Two paid places refunded ($101.25 each), and the
    // deposit plus 6 paid places ($757.50) is $37.50 over the new $720 total.
    expect(quote).toMatchObject({ ok: true, window: "full", refundCents: 2 * 10125 + 3750 });
    expect(quote.removePaid.map((p) => p.name)).toEqual(["H8", "G7"]);
    expect(quote.organiser.refundCents).toBe(3750);

    const rec = await reduceGuests(deps, r.id, 6, { by: "emily" });
    expect(rec.autoRefundedCents).toBe(2 * 10125 + 3750);
    const saved = (await repo.getPrivateRequest(r.id))!;
    expect(saved.guestReductions![0].refundIds).toEqual(rec.refundIds);
    expect(saved.amountPaidCents).toBe(72000);
    const payments = await repo.listPaidPayments("private", r.id);
    expect(payments.reduce((s, p) => s + (p.refundedCents ?? 0), 0)).toBe(2 * 10125 + 3750);
    // The deposit payment carries the organiser's refund.
    expect(payments.find((p) => p.kind === "private_deposit")!.refundedCents).toBe(3750);
    expect(sent.some((m) => m.to === "h8@example.com" && m.subject.startsWith("Your place in the private class"))).toBe(true);
  });

  it("in the credit window paid places become credit, unless Emily waives the terms", async () => {
    const r = await paidPrivate();
    for (const n of ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]) await paidGuest(r.id, n);
    const full = (await repo.getPrivateRequest(r.id))!;
    // Mon 7 Dec: 5 days before the class, inside the credit window.
    const later = at("2026-12-06T23:00:00Z");
    const q = (await reduceGuestsPreview(later, full, 7, { by: "emily" })).quote;
    expect(q).toMatchObject({ ok: true, window: "credit", refundCents: 0 });
    // One place ($101.25) plus what the deposit and 7 paid places are over the new $840 total ($18.75).
    expect(q.creditCents).toBe(10125 + 1875);
    const waived = (await reduceGuestsPreview(later, full, 7, { by: "emily", waive: true })).quote;
    expect(waived).toMatchObject({ window: "full", creditCents: 0, refundCents: 10125 + 1875, waived: true });

    const before = (await repo.listVouchers()).filter((v) => v.kind === "credit").length;
    await reduceGuests(later, r.id, 7, { by: "emily" });
    const credits = (await repo.listVouchers()).filter((v) => v.kind === "credit");
    expect(credits.length).toBe(before + 2);
    expect(credits.map((v) => v.amountCents).sort((x, y) => x - y)).toEqual([1875, 10125]);
  });

  it("gives back a voucher used on a removed unpaid place", async () => {
    const r = await paidPrivate();
    const { checkoutUrl, voucher } = await startVoucherPurchase(
      deps,
      voucherPurchaseSchema.parse({ amountCents: 5000, buyerName: "Kim Lee", buyerEmail: "kim@example.com", recipientName: "Vic", acceptTerms: true }),
    );
    await pay(checkoutUrl);
    for (const n of ["P1", "P2", "P3", "P4", "P5", "P6"]) await paidGuest(r.id, n);
    const g = await joinAsGuest(deps, { shareToken: linkToken("share", r.id), name: "Vic", email: "vic@example.com", allergies: "", dietary: [], messageOptIn: false, pay: false });
    const guestId = new URL(g.guestUrl).pathname.split("/")[3];
    await applyCodeToShare(deps, r, (await repo.getGuest(guestId))!, voucherCode(voucher.id));
    expect((await repo.getVoucherById(voucher.id))!.balanceCents).toBe(0);
    // 6 paid, Vic (unpaid, with the voucher) and one empty place: going to 6 removes both unpaid places.
    const rec = await reduceGuests(deps, r.id, 6, { by: "emily" });
    expect(rec.voucherReturnedCents).toBe(5000);
    expect((await repo.getVoucherById(voucher.id))!.balanceCents).toBe(5000);
    expect((await repo.listGuests(r.id)).some((x) => x.id === guestId)).toBe(false);
    expect((await repo.getGuest(guestId))!.status).toBe("removed");
  });

  it("refuses while a guest is mid-checkout, and refuses a stale quote", async () => {
    const r = await paidPrivate();
    const g = await joinAsGuest(deps, { shareToken: linkToken("share", r.id), name: "Mid", email: "mid@example.com", allergies: "", dietary: [], messageOptIn: false, pay: true });
    expect(g.checkoutUrl).toBeTruthy();
    const q = (await reduceGuestsPreview(deps, r, 6, { by: "emily" })).quote;
    expect(q.ok).toBe(false);
    expect(q.problem).toMatch(/paying right now/);
    // A write based on an old guest count is refused by the store.
    const ok = await repo.reducePrivateGuests({
      requestId: r.id,
      expectedGuests: 9,
      newGuests: 6,
      newEstimateCents: 72000,
      removeOpenIds: [],
      removePaidIds: [],
      shareUpdates: [],
      freeIds: [],
      cashOutCents: 0,
      record: { at: NOW.toISOString(), by: "emily", daysOut: 34, from: 9, to: 6, removedNames: [], refundCents: 0, creditCents: 0, keptCents: 0, voucherReturnedCents: 0, passCreditsReturned: 0, summary: "" },
    });
    expect(ok).toBe(false);
  });

  it("a removed place can't be claimed by a new guest", async () => {
    const r = await paidPrivate();
    await reduceGuests(deps, r.id, 6, { by: "organiser" });
    for (let i = 0; i < 6; i++) {
      await joinAsGuest(deps, { shareToken: linkToken("share", r.id), name: `G${i}`, email: `g${i}@example.com`, allergies: "", dietary: [], messageOptIn: false, pay: false });
    }
    await expect(
      joinAsGuest(deps, { shareToken: linkToken("share", r.id), name: "Extra", email: "x@example.com", allergies: "", dietary: [], messageOptIn: false, pay: false }),
    ).rejects.toThrow();
  });
});

describe("photo opt-out", () => {
  const order = (over: Record<string, unknown> = {}) =>
    orderRequestSchema.parse({
      config: { occasion: "occ-birthday", size: "size-6-round", flavour: "fl-vanilla", finish: "fin-buttercream", colour: "col-blush", decorations: [], extras: [], topperText: "" },
      pickupDate: "2026-11-28",
      pickupSlot: "10:00",
      customerName: "Pat Lee",
      email: "pat@example.com",
      phone: "0400 111 222",
      acceptTerms: true,
      ...over,
    });

  it("is stored on the order, and defaults to off", async () => {
    const yes = await createOrder(deps, order({ photoOptOut: true }), null);
    expect((await repo.getOrderById(yes.order.id))!.photoOptOut).toBe(true);
    const no = await createOrder(deps, order({ pickupSlot: "10:30" }), null);
    expect((await repo.getOrderById(no.order.id))!.photoOptOut).toBe(false);
  });
});
