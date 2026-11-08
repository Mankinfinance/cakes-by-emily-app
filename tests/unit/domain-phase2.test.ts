import { describe, expect, it } from "vitest";
import { SAMPLE_BOXES, SAMPLE_SETTINGS } from "@/lib/data/sample-data";
import { DEFAULT_AUTOMATIONS, dueScheduledMessages, messageTimeline } from "@/lib/domain/automations";
import { boxPickupOk, boxStatus } from "@/lib/domain/boxes";
import { addMonths } from "@/lib/domain/dates";
import { kitchenRange, kitchenSheet } from "@/lib/domain/kitchen";
import { balanceOwing, dueAtCheckout } from "@/lib/domain/pricing";
import { nextStage, stageIndex } from "@/lib/domain/stages";
import { cancellationOutcome, termsCheck, termsLines } from "@/lib/domain/terms";
import type { BoxOrder, Order, WaitlistEntry } from "@/lib/domain/types";
import { formatCode, looksLikeCode, normalizeCode, redemptionAmount, voucherProblem } from "@/lib/domain/vouchers";
import { expiredOffers, nextInLine, placeInLine } from "@/lib/domain/waitlist";

const S = SAMPLE_SETTINGS;

function order(over: Partial<Order> = {}): Order {
  return {
    id: "o1",
    reference: "CBE-AAAAA",
    tokenHash: "h",
    stage: "received",
    customerName: "Sam Taylor",
    email: "sam@example.com",
    phone: "0400000000",
    marketingOptIn: false,
    pickupDate: "2026-11-28",
    pickupSlot: "10:00",
    config: { occasion: "occ-birthday", size: "size-6-round", flavour: "fl-vanilla", finish: "fin-drip", colour: "col-blush", decorations: [], extras: [], topperText: "" },
    allergyNotes: "",
    notes: "",
    inspirationPath: null,
    items: [
      { itemId: "size-6-round", category: "size", name: '6" round', amountCents: 13000 },
      { itemId: "fl-vanilla", category: "flavour", name: "Vanilla bean", amountCents: 0 },
      { itemId: "fin-drip", category: "finish", name: "Drip", amountCents: 2500 },
      { itemId: "col-blush", category: "colour", name: "Blush pink", amountCents: 0 },
    ],
    subtotalCents: 15500,
    rushFeeCents: 0,
    peakSurchargeCents: 0,
    totalCents: 15500,
    depositCents: 7800,
    amountPaidCents: 7800,
    isRush: false,
    termsAcceptedAt: "2026-11-01T00:00:00Z",
    createdAt: "2026-11-01T00:00:00Z",
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
    ...over,
  };
}

describe("cancellation terms", () => {
  it("refunds the deposit minus the admin fee 14 or more days out", () => {
    const r = cancellationOutcome(order({ amountPaidCents: 6500 }), S, 20);
    expect(r).toMatchObject({ window: "full", refundCents: 4500, creditCents: 0, keptCents: 2000 });
    expect(r.summary).toBe("Today is 20 days before pickup. If you cancel, you'll get $45 back ($65 paid minus the $20 admin fee).");
    expect(cancellationOutcome(order({ amountPaidCents: 6500 }), S, 14).window).toBe("full");
  });

  it("turns what was paid into credit from 7 to 13 days out", () => {
    expect(cancellationOutcome(order(), S, 13)).toMatchObject({ window: "credit", refundCents: 0, creditCents: 7800 });
    expect(cancellationOutcome(order(), S, 7)).toMatchObject({ window: "credit", creditCents: 7800 });
  });

  it("gives nothing back inside 7 days", () => {
    const r = cancellationOutcome(order(), S, 6);
    expect(r).toMatchObject({ window: "none", refundCents: 0, creditCents: 0, keptCents: 7800 });
    expect(r.summary).toContain("not refundable");
  });

  it("never refunds rush or peak fees, and never lets the fee go negative", () => {
    const rush = order({ rushFeeCents: 4000, peakSurchargeCents: 3000, amountPaidCents: 22500 });
    expect(cancellationOutcome(rush, S, 30)).toMatchObject({ refundCents: 13500, keptCents: 9000 });
    expect(cancellationOutcome(order({ amountPaidCents: 1000 }), S, 30)).toMatchObject({ refundCents: 0, keptCents: 1000 });
  });

  it("always gives back voucher or credit used, and refunds everything when Emily cancels", () => {
    const v = order({ amountPaidCents: 5000, voucherAppliedCents: 4000 });
    expect(cancellationOutcome(v, S, 3)).toMatchObject({ window: "none", voucherReturnedCents: 4000 });
    expect(cancellationOutcome(v, S, 3, "emily")).toMatchObject({ window: "emily", refundCents: 5000, voucherReturnedCents: 4000 });
  });

  it("reports what the customer can change today", () => {
    const early = termsCheck(order(), S, 20);
    expect(early).toMatchObject({ canChangeDesign: true, canChangeDate: true, canCancel: true });
    const late = termsCheck(order(), S, 5);
    expect(late.canChangeDesign).toBe(false);
    expect(late.designReason).toBe("Design changes closed 7 days before pickup.");
    expect(late.canChangeDate).toBe(false);
    expect(termsCheck(order({ dateChangesUsed: 1 }), S, 20).dateReason).toMatch(/used your free date change/);
    expect(termsCheck(order({ stage: "baking" }), S, 20).canChangeDesign).toBe(false);
    expect(termsCheck(order({ stage: "collected" }), S, 20).canCancel).toBe(false);
    expect(termsCheck(order(), S, 0).cancelReason).toMatch(/too close/);
  });

  it("writes the terms from the settings", () => {
    const lines = termsLines(S);
    expect(lines).toContain("Cancel 14 days or more before pickup: your deposit back, minus a $20 admin fee.");
    expect(lines).toContain("Cancel inside 7 days: not refundable.");
    expect(termsLines({ ...S, cancelAdminFeeCents: 2500 }).join(" ")).toContain("$25 admin fee");
  });
});

describe("automatic messages", () => {
  const A = DEFAULT_AUTOMATIONS;

  it("works out the scheduled messages due today", () => {
    const o = order({ pickupDate: "2026-11-20" });
    expect(dueScheduledMessages(o, A, [], "2026-11-16")).toEqual(["balance_reminder"]);
    expect(dueScheduledMessages(o, A, ["balance_reminder"], "2026-11-19")).toEqual(["pickup_details"]);
    expect(dueScheduledMessages(o, A, ["balance_reminder", "pickup_details"], "2026-11-19")).toEqual([]);
    expect(dueScheduledMessages(order({ pickupDate: "2026-11-20", amountPaidCents: 15500 }), A, [], "2026-11-16")).toEqual([]);
  });

  it("respects the switches and the days", () => {
    const o = order({ pickupDate: "2026-11-20" });
    const off = A.map((a) => (a.key === "balance_reminder" ? { ...a, enabled: false } : a));
    expect(dueScheduledMessages(o, off, [], "2026-11-16")).toEqual([]);
    const sooner = A.map((a) => (a.key === "balance_reminder" ? { ...a, days: 2 } : a));
    expect(dueScheduledMessages(o, sooner, [], "2026-11-16")).toEqual([]);
    expect(dueScheduledMessages(o, sooner, [], "2026-11-18")).toEqual(["balance_reminder"]);
  });

  it("thanks customers after collection and reminds birthday customers who asked", () => {
    const o = order({ stage: "collected", pickupDate: "2026-11-20", amountPaidCents: 15500 });
    expect(dueScheduledMessages(o, A, [], "2026-11-20")).toEqual([]);
    expect(dueScheduledMessages(o, A, [], "2026-11-21")).toEqual(["thank_you"]);
    const remind = { ...o, remindNextYear: true };
    expect(dueScheduledMessages(remind, A, ["thank_you"], "2027-10-22")).toEqual(["rebook_reminder"]);
    const notBirthday = { ...remind, config: { ...remind.config, occasion: "occ-baptism" } };
    expect(dueScheduledMessages(notBirthday, A, ["thank_you"], "2027-10-22")).toEqual([]);
  });

  it("sends nothing for cancelled or unpaid orders", () => {
    expect(dueScheduledMessages(order({ stage: "cancelled", pickupDate: "2026-11-20" }), A, [], "2026-11-19")).toEqual([]);
    expect(dueScheduledMessages(order({ stage: "awaiting_payment", pickupDate: "2026-11-20" }), A, [], "2026-11-19")).toEqual([]);
  });

  it("builds the customer's timeline", () => {
    const t = messageTimeline(order({ pickupDate: "2026-11-20" }), A, [{ key: "order_received", sentAt: "2026-11-01T01:00:00Z" }]);
    expect(t.map((x) => [x.key, x.status, x.date])).toEqual([
      ["order_received", "sent", "2026-11-01"],
      ["design_confirmed", "waiting", null],
      ["balance_reminder", "scheduled", "2026-11-16"],
      ["pickup_details", "scheduled", "2026-11-19"],
      ["thank_you", "scheduled", "2026-11-21"],
      ["rebook_reminder", "not_needed", null],
    ]);
    const off = messageTimeline(order(), A.map((a) => ({ ...a, enabled: a.key !== "thank_you" })), []);
    expect(off.find((x) => x.key === "thank_you")?.status).toBe("off");
  });
});

describe("design approval stage", () => {
  it("is an optional side step", () => {
    expect(nextStage("received")).toBe("design_confirmed");
    expect(nextStage("awaiting_approval")).toBe("design_confirmed");
    expect(stageIndex("awaiting_approval")).toBe(stageIndex("received"));
  });
});

describe("waitlist order", () => {
  const now = new Date("2026-11-08T00:00:00Z");
  const e = (id: string, createdAt: string, over: Partial<WaitlistEntry> = {}): WaitlistEntry => ({
    id,
    date: "2026-12-05",
    customerName: "A",
    email: `${id}@x.com`,
    phone: "0400000000",
    config: order().config,
    dietary: [],
    status: "waiting",
    offerTokenHash: null,
    offeredAt: null,
    offerExpiresAt: null,
    orderId: null,
    createdAt,
    ...over,
  });

  it("offers to the earliest person, one offer at a time", () => {
    const list = [e("b", "2026-11-02"), e("a", "2026-11-01"), e("c", "2026-11-03")];
    expect(nextInLine(list, "2026-12-05", now)?.id).toBe("a");
    const offered = [e("a", "2026-11-01", { status: "offered", offerExpiresAt: "2026-11-08T12:00:00Z" }), e("b", "2026-11-02")];
    expect(nextInLine(offered, "2026-12-05", now)).toBeNull();
    expect(placeInLine(list, "c")).toBe(3);
  });

  it("finds expired offers and moves on to the next person", () => {
    const list = [e("a", "2026-11-01", { status: "offered", offerExpiresAt: "2026-11-07T12:00:00Z" }), e("b", "2026-11-02")];
    expect(expiredOffers(list, now).map((x) => x.id)).toEqual(["a"]);
    const after = list.map((x) => (x.id === "a" ? { ...x, status: "expired" as const } : x));
    expect(nextInLine(after, "2026-12-05", now)?.id).toBe("b");
  });
});

describe("voucher codes", () => {
  it("formats 80 bits as four groups and normalises input", () => {
    const code = formatCode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normalizeCode(` ${code.toLowerCase().replace(/-/g, " ")} `)).toBe(code.replace(/-/g, ""));
    expect(looksLikeCode(code)).toBe(true);
    expect(looksLikeCode("ABCD-EFGH")).toBe(false);
    expect(looksLikeCode("0000-0000-0000-0000")).toBe(false); // 0 is not in the alphabet
  });

  it("explains why a code can't be used, and uses only what's owed", () => {
    const v = { status: "active", expiresOn: "2027-01-01", balanceCents: 1000 } as Parameters<typeof voucherProblem>[0];
    expect(voucherProblem(v, "2026-11-08")).toBeNull();
    expect(voucherProblem(null, "2026-11-08")).toBe("not_found");
    expect(voucherProblem({ ...v!, status: "pending" }, "2026-11-08")).toBe("not_paid");
    expect(voucherProblem(v, "2027-01-02")).toBe("expired");
    expect(voucherProblem({ ...v!, balanceCents: 0 }, "2026-11-08")).toBe("used_up");
    expect(redemptionAmount(5000, 3000)).toBe(3000);
    expect(redemptionAmount(2000, 3000)).toBe(2000);
  });

  it("takes vouchers off the deposit first and counts them toward the balance", () => {
    expect(dueAtCheckout(8800, 5000)).toBe(3800);
    expect(dueAtCheckout(8800, 10000)).toBe(0);
    expect(balanceOwing({ totalCents: 17500, amountPaidCents: 3800, voucherAppliedCents: 5000 })).toBe(8700);
    expect(addMonths("2026-11-08", 12)).toBe("2027-11-08");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
  });
});

describe("seasonal boxes", () => {
  const box = SAMPLE_BOXES[0];

  it("shows countdowns, stock and state", () => {
    expect(boxStatus(box, "2026-11-08")).toMatchObject({ state: "open", remaining: 40, label: "Closes in 36 days" });
    expect(boxStatus({ ...box, sold: 40 }, "2026-11-08").state).toBe("sold_out");
    expect(boxStatus(box, "2026-12-15").state).toBe("closed");
    expect(boxStatus(SAMPLE_BOXES[2], "2026-11-08")).toMatchObject({ state: "not_open", label: "Opens in 144 days" });
  });

  it("only allows pickups in the pickup window", () => {
    expect(boxPickupOk(box, "2026-12-20", "2026-11-08")).toBe(true);
    expect(boxPickupOk(box, "2026-12-17", "2026-11-08")).toBe(false);
    expect(boxPickupOk(box, "2026-12-24", "2026-11-08")).toBe(false);
  });
});

describe("kitchen sheet", () => {
  it("lists cakes and boxes by day in pickup order with allergies", () => {
    const boxOrder: BoxOrder = {
      id: "b1",
      reference: "BOX-AAAAA",
      tokenHash: "h",
      boxId: "x",
      boxName: "Christmas cookie box",
      quantity: 3,
      unitPriceCents: 4500,
      totalCents: 13500,
      amountPaidCents: 13500,
      customerName: "Kim Lee",
      email: "k@x.com",
      phone: "0400000000",
      marketingOptIn: false,
      pickupDate: "2026-11-27",
      pickupSlot: "09:30",
      status: "paid",
      kitchenDone: false,
      createdAt: "",
    };
    const orders = [
      order({ id: "o2", reference: "CBE-BBBBB", pickupDate: "2026-11-27", pickupSlot: "11:00", allergyNotes: "Tree nuts", dietary: ["egg-free"] }),
      order({ id: "o1", reference: "CBE-AAAAA", pickupDate: "2026-11-27", pickupSlot: "10:00" }),
      order({ id: "o3", reference: "CBE-CCCCC", pickupDate: "2026-11-27", stage: "cancelled" }),
      order({ id: "o4", reference: "CBE-DDDDD", pickupDate: "2026-12-10" }),
    ];
    const { from, to } = kitchenRange("week", "2026-11-25");
    expect([from, to]).toEqual(["2026-11-23", "2026-11-29"]);
    const days = kitchenSheet(orders, [boxOrder], from, to);
    expect(days).toHaveLength(1);
    expect(days[0].lines.map((l) => l.reference)).toEqual(["BOX-AAAAA", "CBE-AAAAA", "CBE-BBBBB"]);
    const cake = days[0].lines[2];
    expect(cake.kind === "cake" && cake.dietary).toEqual(["Egg-free"]);
    expect(cake.kind === "cake" && cake.allergyNotes).toBe("Tree nuts");
  });
});
