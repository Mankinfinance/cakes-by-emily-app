// Phase 5: a payment that arrives after its order or booking expired (the
// customer sat on Stripe's page past the hold, or a guest's share hold ran
// out and someone else paid it). With automatic refunds on, it is refunded
// in full through Stripe, once (a stable idempotency key means a retried
// webhook never refunds twice). Otherwise Emily is emailed to refund it.

import { refundKey } from "../domain/refunds";
import type { Payment } from "../domain/types";
import { adminEmail, type LightDeps } from "./common";
import { latePaymentAlertEmail, lateRefundEmail, sendSafely } from "./email";

export interface LatePaymentResult {
  refundedCents: number;
  manualCents: number;
  refundId: string | null;
}

export async function handleLatePayment(deps: LightDeps, payment: Payment, reference: string, paymentIntent?: string | null): Promise<LatePaymentResult> {
  const to = adminEmail();
  const amount = payment.amountCents - (payment.refundedCents ?? 0);
  const settings = await deps.repo.getSettings();
  const intent = paymentIntent ?? payment.stripePaymentIntent ?? null;
  if (amount <= 0) return { refundedCents: 0, manualCents: 0, refundId: null };
  if (!settings.autoRefunds || !deps.payments || !intent) {
    if (to) await sendSafely(deps.mailer, latePaymentAlertEmail(reference, amount, to));
    return { refundedCents: 0, manualCents: amount, refundId: null };
  }
  try {
    const r = await deps.payments.refund({ paymentIntent: intent, amountCents: amount, idempotencyKey: refundKey(payment.id, "late-payment", amount), reason: `late payment: ${reference}` });
    await deps.repo.recordRefund({ paymentId: payment.id, amountCents: amount, stripeRefundId: r.id, status: "succeeded", reason: "late-payment" });
    if (to) await sendSafely(deps.mailer, lateRefundEmail(reference, amount, amount, to));
    return { refundedCents: amount, manualCents: 0, refundId: r.id };
  } catch (err) {
    console.error("Late payment refund failed:", err instanceof Error ? err.message : err);
    await deps.repo.recordRefund({ paymentId: payment.id, amountCents: amount, stripeRefundId: null, status: "failed", reason: "late-payment" });
    if (to) await sendSafely(deps.mailer, latePaymentAlertEmail(reference, amount, to));
    return { refundedCents: 0, manualCents: amount, refundId: null };
  }
}
