// Change and cancellation rules, worked out from Emily's terms settings and
// today's date. Refunds are never automatic: the outcome is recorded and
// Emily refunds cash in the Stripe dashboard.

import { formatAud } from "./money";
import type { Order, Settings, Stage } from "./types";

export type CancelWindow = "full" | "credit" | "none" | "emily";

export interface CancelOutcome {
  window: CancelWindow;
  /** Cash for Emily to refund in Stripe. */
  refundCents: number;
  /** Cash paid that becomes a credit code. */
  creditCents: number;
  /** Cash kept under the terms (admin fee, non-refundable fees, late cancellations). */
  keptCents: number;
  /** Voucher or credit used on the order, always given back as credit. */
  voucherReturnedCents: number;
  summary: string;
}

export interface TermsCheck {
  daysOut: number;
  canChangeDesign: boolean;
  designReason: string;
  canChangeDate: boolean;
  dateReason: string;
  canCancel: boolean;
  cancelReason: string;
  cancel: CancelOutcome;
}

type OrderMoney = Pick<
  Order,
  "amountPaidCents" | "rushFeeCents" | "peakSurchargeCents" | "voucherAppliedCents"
>;

const OPEN_STAGES: Stage[] = ["received", "awaiting_approval", "design_confirmed", "baking", "decorating", "ready"];
const DESIGN_STAGES: Stage[] = ["received", "awaiting_approval"];

function dayWord(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

/** What happens to the money if the order is cancelled `daysOut` days before pickup. */
export function cancellationOutcome(
  order: OrderMoney,
  settings: Pick<Settings, "cancelFullRefundDays" | "cancelCreditDays" | "cancelAdminFeeCents">,
  daysOut: number,
  by: "customer" | "emily" = "customer",
): CancelOutcome {
  const cash = Math.max(0, order.amountPaidCents);
  const voucherReturnedCents = Math.max(0, order.voucherAppliedCents);
  const nonRefundable = Math.min(cash, order.rushFeeCents + order.peakSurchargeCents);
  const eligible = cash - nonRefundable;
  const credit = voucherReturnedCents > 0 ? ` The ${formatAud(voucherReturnedCents)} voucher or credit you used comes back as credit.` : "";

  if (by === "emily") {
    return {
      window: "emily",
      refundCents: cash,
      creditCents: 0,
      keptCents: 0,
      voucherReturnedCents,
      summary: `Emily cancelled this order, so everything paid (${formatAud(cash)}) is refunded.${credit}`,
    };
  }

  const when = `Today is ${dayWord(daysOut)} before pickup.`;
  const feesNote = nonRefundable > 0 ? ` Rush and peak date fees (${formatAud(nonRefundable)}) are not refundable.` : "";

  if (daysOut >= settings.cancelFullRefundDays) {
    const fee = Math.min(eligible, settings.cancelAdminFeeCents);
    const refund = eligible - fee;
    return {
      window: "full",
      refundCents: refund,
      creditCents: 0,
      keptCents: nonRefundable + fee,
      voucherReturnedCents,
      summary:
        `${when} If you cancel, you'll get ${formatAud(refund)} back` +
        (fee > 0 ? ` (${formatAud(eligible)} paid minus the ${formatAud(fee)} admin fee).` : ".") +
        feesNote +
        credit,
    };
  }
  if (daysOut >= settings.cancelCreditDays) {
    return {
      window: "credit",
      refundCents: 0,
      creditCents: eligible,
      keptCents: nonRefundable,
      voucherReturnedCents,
      summary: `${when} If you cancel, the ${formatAud(eligible)} you paid becomes credit for a future order.${feesNote}${credit}`,
    };
  }
  return {
    window: "none",
    refundCents: 0,
    creditCents: 0,
    keptCents: cash,
    voucherReturnedCents,
    summary: `${when} Cancellations inside ${dayWord(settings.cancelCreditDays)} are not refundable.${credit}`,
  };
}

/** Everything the "Change or cancel" panel needs, for today's date. */
export function termsCheck(
  order: OrderMoney & Pick<Order, "stage" | "dateChangesUsed">,
  settings: Settings,
  daysOut: number,
): TermsCheck {
  const open = OPEN_STAGES.includes(order.stage);
  const notOpen = order.stage === "cancelled" ? "This order is cancelled." : order.stage === "collected" ? "This order has been collected." : "This order is not confirmed yet.";

  let designReason = "";
  if (!open) designReason = notOpen;
  else if (!DESIGN_STAGES.includes(order.stage)) designReason = "Your design is confirmed. Message Emily if something important has changed.";
  else if (daysOut < settings.changeCutoffDays) designReason = `Design changes closed ${dayWord(settings.changeCutoffDays)} before pickup.`;

  let dateReason = "";
  if (!open) dateReason = notOpen;
  else if (daysOut < settings.changeCutoffDays) dateReason = `Date changes closed ${dayWord(settings.changeCutoffDays)} before pickup.`;
  else if (order.dateChangesUsed >= settings.freeDateChanges) {
    dateReason = settings.freeDateChanges === 0 ? "Date changes are not available online. Message Emily." : "You've used your free date change. Message Emily if you need to move it again.";
  }

  let cancelReason = "";
  if (!open) cancelReason = notOpen;
  else if (daysOut < 1) cancelReason = "It's too close to pickup to cancel online. Please message Emily.";

  return {
    daysOut,
    canChangeDesign: designReason === "",
    designReason,
    canChangeDate: dateReason === "",
    dateReason,
    canCancel: cancelReason === "",
    cancelReason,
    cancel: cancellationOutcome(order, settings, daysOut),
  };
}

/** The cancellation and change rules in plain English, for the terms page and checkout. */
export function termsLines(s: Settings): string[] {
  const lines = [
    `A ${s.depositPercent}% deposit secures your date. The balance is due ${dayWord(s.balanceDueDays)} before pickup.`,
    `Cancel ${dayWord(s.cancelFullRefundDays)} or more before pickup: your deposit back, minus a ${formatAud(s.cancelAdminFeeCents)} admin fee.`,
    `Cancel ${dayWord(s.cancelCreditDays)} to ${dayWord(Math.max(s.cancelCreditDays, s.cancelFullRefundDays - 1))} before pickup: what you've paid becomes credit for a future order.`,
    `Cancel inside ${dayWord(s.cancelCreditDays)}: not refundable.`,
    "Rush and peak date fees are not refundable.",
    `Design changes are welcome up to ${dayWord(s.changeCutoffDays)} before pickup.` +
      (s.freeDesignChangeRounds > 0 ? ` After Emily sends your design, ${s.freeDesignChangeRounds === 1 ? "one round" : `${s.freeDesignChangeRounds} rounds`} of changes ${s.freeDesignChangeRounds === 1 ? "is" : "are"} included.` : ""),
    s.freeDateChanges > 0
      ? `You can move your pickup date ${s.freeDateChanges === 1 ? "once" : `${s.freeDateChanges} times`} for free, up to ${dayWord(s.changeCutoffDays)} before pickup, if there's room on the new date.`
      : "Please message Emily to change your pickup date.",
    "Any voucher or credit used on a cancelled order comes back as credit.",
    `Gift vouchers and credit are valid for ${s.voucherValidMonths} months and can't be exchanged for cash.`,
  ];
  return lines;
}
