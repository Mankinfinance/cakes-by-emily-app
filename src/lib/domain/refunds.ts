// How a refund is split across the payments it came from (for example a
// deposit and a balance, or several guests' shares). Pure logic: the
// services call Stripe with the result.

export interface RefundablePayment {
  id: string;
  amountCents: number;
  refundedCents: number;
  createdAt: string;
}

export interface RefundSlice {
  paymentId: string;
  cents: number;
}

/** Room left to refund on one payment. */
export function refundable(p: RefundablePayment): number {
  return Math.max(0, p.amountCents - p.refundedCents);
}

/**
 * Split `amountCents` across payments, newest first (so a balance is
 * refunded before the deposit). Never refunds more than a payment has left;
 * if the payments can't cover it all, `unallocated` says how much is short.
 */
export function allocateRefund(payments: RefundablePayment[], amountCents: number): { slices: RefundSlice[]; unallocated: number } {
  let left = Math.max(0, Math.round(amountCents));
  const slices: RefundSlice[] = [];
  const ordered = [...payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  for (const p of ordered) {
    if (left === 0) break;
    const cents = Math.min(left, refundable(p));
    if (cents > 0) {
      slices.push({ paymentId: p.id, cents });
      left -= cents;
    }
  }
  return { slices, unallocated: left };
}

/** A stable idempotency key, so a retried refund never refunds twice. */
export function refundKey(paymentId: string, reason: string, cents: number): string {
  return `refund-${paymentId}-${reason}-${cents}`.slice(0, 255);
}
