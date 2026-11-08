// Refunds. By default every refund is made by hand in the Stripe dashboard
// and recorded here. When Emily turns on `autoRefunds`, the refund the terms
// allow is sent to Stripe instead, split across the payments it came from.
// Anything Stripe refuses falls back to the manual record and an email.

import { allocateRefund, refundKey } from "../domain/refunds";
import type { RefundTargetKind } from "../domain/types";
import { formatAud } from "../domain/money";
import { adminEmail, type LightDeps } from "./common";
import { refundFailedEmail, sendSafely } from "./email";

export interface RefundResult {
  /** True if Stripe refunds were attempted. */
  auto: boolean;
  refundedCents: number;
  /** Still to refund by hand in Stripe. */
  manualCents: number;
  refundIds: string[];
}

export async function refundTarget(deps: LightDeps, kind: RefundTargetKind, id: string, amountCents: number, reason: string, label: string): Promise<RefundResult> {
  const none = { auto: false, refundedCents: 0, manualCents: Math.max(0, amountCents), refundIds: [] };
  if (amountCents <= 0) return { ...none, manualCents: 0 };
  const settings = await deps.repo.getSettings();
  if (!settings.autoRefunds || !deps.payments) return none;

  const payments = await deps.repo.listPaidPayments(kind, id);
  const { slices, unallocated } = allocateRefund(
    payments.map((p) => ({ id: p.id, amountCents: p.amountCents, refundedCents: p.refundedCents ?? 0, createdAt: p.createdAt })),
    amountCents,
  );
  let refunded = 0;
  let manual = unallocated;
  const ids: string[] = [];
  for (const slice of slices) {
    const payment = payments.find((p) => p.id === slice.paymentId)!;
    try {
      if (!payment.stripePaymentIntent) throw new Error("No PaymentIntent recorded for this payment");
      const r = await deps.payments.refund({
        paymentIntent: payment.stripePaymentIntent,
        amountCents: slice.cents,
        idempotencyKey: refundKey(payment.id, reason, slice.cents),
        reason: `${label}: ${reason}`,
      });
      await deps.repo.recordRefund({ paymentId: payment.id, amountCents: slice.cents, stripeRefundId: r.id, status: "succeeded", reason });
      refunded += slice.cents;
      ids.push(r.id);
    } catch (err) {
      console.error("Refund failed:", err instanceof Error ? err.message : err);
      await deps.repo.recordRefund({ paymentId: payment.id, amountCents: slice.cents, stripeRefundId: null, status: "failed", reason });
      manual += slice.cents;
    }
  }
  const to = adminEmail();
  if (manual > 0 && to) await sendSafely(deps.mailer, refundFailedEmail(label, manual, refunded, to));
  return { auto: true, refundedCents: refunded, manualCents: manual, refundIds: ids };
}

/** Label for an admin cancel button: shows what will be refunded, and how. */
export function refundButtonLabel(autoRefunds: boolean, cents: number, base: string): { label: string; confirm: string } {
  if (cents <= 0) return { label: base, confirm: `${base}? No refund is due.` };
  return autoRefunds
    ? { label: `${base} and refund ${formatAud(cents)} via Stripe`, confirm: `${base}? ${formatAud(cents)} will be refunded through Stripe now. This can't be undone.` }
    : { label: base, confirm: `${base}? Refund ${formatAud(cents)} in the Stripe dashboard afterwards (automatic refunds are off).` };
}
