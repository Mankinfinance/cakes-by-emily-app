// Phase 5: cancelling some seats of a class booking. The booking stays live
// for the guests who are still coming. The price is worked out again for the
// seats left (so the group discount can drop away), and the difference is
// refunded or turned into credit under the class terms.

import { classPriceWithPass } from "./classes";
import type { ClassBooking } from "./types";

export interface PartialCancelQuote {
  ok: boolean;
  /** Why it can't be done online, when ok is false. */
  problem: string | null;
  window: "full" | "credit" | "none";
  seatsCancelled: number;
  seatsLeft: number;
  guestNames: string[];
  /** The booking after the change. */
  newDiscountCents: number;
  newTotalCents: number;
  newPassCredits: number;
  /** True when the group discount no longer applies to the seats left. */
  discountLost: boolean;
  /** What the cancelled seats were worth after the new price is worked out. */
  reductionCents: number;
  refundCents: number;
  creditCents: number;
  /** Voucher or credit that paid for the cancelled seats, given back as a credit code. */
  voucherCreditCents: number;
  passCreditsReturned: number;
  summary: string;
}

const aud = (c: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
const seatWord = (n: number) => (n === 1 ? "1 seat" : `${n} seats`);

/**
 * Pass credits cover seats first, so cancelled seats give credits back before
 * any money. Money comes back cash first, then any voucher that paid.
 */
export function partialCancelQuote(
  b: Pick<ClassBooking, "seats" | "guests" | "unitPriceCents" | "discountCents" | "totalCents" | "amountPaidCents" | "voucherAppliedCents" | "passCredits" | "status">,
  cancelIndexes: number[],
  s: { groupDiscountMinSeats: number; groupDiscountPercent: number; classFullRefundDays: number; classCreditDays: number },
  daysOut: number,
): PartialCancelQuote {
  const picks = [...new Set(cancelIndexes)].filter((i) => Number.isInteger(i) && i >= 0 && i < b.guests.length).sort((x, y) => x - y);
  const k = picks.length;
  const left = b.seats - k;
  const window: PartialCancelQuote["window"] = daysOut >= s.classFullRefundDays ? "full" : daysOut >= s.classCreditDays ? "credit" : "none";
  const base: PartialCancelQuote = {
    ok: false,
    problem: null,
    window,
    seatsCancelled: k,
    seatsLeft: left,
    guestNames: picks.map((i) => b.guests[i].name),
    newDiscountCents: b.discountCents,
    newTotalCents: b.totalCents,
    newPassCredits: b.passCredits ?? 0,
    discountLost: false,
    reductionCents: 0,
    refundCents: 0,
    creditCents: 0,
    voucherCreditCents: 0,
    passCreditsReturned: 0,
    summary: "",
  };
  if (b.status !== "paid") return { ...base, problem: "Only paid bookings can have seats cancelled." };
  if (k === 0) return { ...base, problem: "Choose at least one guest to cancel." };
  if (k !== cancelIndexes.length) return { ...base, problem: "Please choose each guest once." };
  if (left < 1) return { ...base, problem: "To cancel every seat, cancel the whole booking instead." };
  if (window === "none" || daysOut < 1) {
    return { ...base, problem: `Seats can't be cancelled online inside ${s.classCreditDays === 1 ? "1 day" : `${s.classCreditDays} days`} of the class. Please message Emily.` };
  }

  const credits = Math.max(0, b.passCredits ?? 0);
  const creditsBack = Math.min(credits, k);
  const creditsKept = Math.min(credits - creditsBack, left);
  const price = classPriceWithPass(b.unitPriceCents, left, creditsKept, s);
  const reduction = Math.max(0, b.totalCents - price.totalCents);
  const cash = Math.max(0, b.amountPaidCents);
  const voucher = Math.max(0, b.voucherAppliedCents ?? 0);
  const cashOut = Math.min(reduction, cash);
  const voucherOut = Math.min(reduction - cashOut, voucher);
  const discountLost = b.discountCents > 0 && price.discountCents === 0;

  const refund = window === "full" ? cashOut : 0;
  const credit = window === "credit" ? cashOut : 0;
  const parts: string[] = [];
  if (refund) parts.push(`${aud(refund)} refunded`);
  if (credit) parts.push(`${aud(credit)} as credit`);
  if (voucherOut) parts.push(`${aud(voucherOut)} of voucher or credit back as a new credit code`);
  if (creditsBack) parts.push(`${creditsBack === 1 ? "1 class pass credit" : `${creditsBack} class pass credits`} back`);
  const summary =
    `Cancelling ${seatWord(k)} (${base.guestNames.join(", ")}) leaves ${seatWord(left)} at ${aud(price.totalCents)}.` +
    (discountLost ? " The group discount no longer applies to the seats left." : "") +
    (parts.length ? ` You get ${parts.join(", ")}.` : " Nothing is due back.");

  return {
    ...base,
    ok: true,
    newDiscountCents: price.discountCents,
    newTotalCents: price.totalCents,
    newPassCredits: creditsKept,
    discountLost,
    reductionCents: reduction,
    refundCents: refund,
    creditCents: credit,
    voucherCreditCents: voucherOut,
    passCreditsReturned: creditsBack,
    summary,
  };
}
