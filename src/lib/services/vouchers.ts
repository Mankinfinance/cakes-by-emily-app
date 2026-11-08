// Gift vouchers (bought online) and credit codes (issued when a cancellation
// leaves the customer with credit). Both are spent with a code at checkout,
// so only whoever holds the code can use the money.

import { randomUUID } from "node:crypto";
import { BUSINESS } from "../config";
import { addMonths, todayInBusinessTz } from "../domain/dates";
import { formatAud } from "../domain/money";
import type { Settings, Voucher } from "../domain/types";
import { looksLikeCode, normalizeCode, VOUCHER_PROBLEM_TEXT, voucherProblem } from "../domain/vouchers";
import type { Repository } from "../data/repository";
import type { VoucherPurchase } from "../validation";
import { nowOf, OrderError, type Deps, type LightDeps } from "./common";
import { creditCodeEmail, sendSafely, voucherEmail } from "./email";
import { hashCode, newReference, voucherCode } from "./tokens";

/** Amounts a buyer may choose: the visible fixed amounts, or a custom amount when switched on. */
export function voucherAmountAllowed(settings: Settings, cents: number): boolean {
  if (settings.voucherOptions.some((o) => o.visible && o.cents === cents)) return true;
  return settings.voucherCustomEnabled && cents >= settings.voucherCustomMinCents && cents <= settings.voucherCustomMaxCents && cents % 100 === 0;
}

function codeFields(id: string) {
  const code = voucherCode(id);
  return { code, codeHash: hashCode(code), codeLast4: normalizeCode(code).slice(-4) };
}

export async function startVoucherPurchase(deps: Deps, req: VoucherPurchase): Promise<{ checkoutUrl: string; voucher: Voucher }> {
  const settings = await deps.repo.getSettings();
  if (!voucherAmountAllowed(settings, req.amountCents)) throw new OrderError("Please choose one of the voucher amounts.");
  const today = todayInBusinessTz(nowOf(deps));
  const id = randomUUID();
  const { codeHash, codeLast4 } = codeFields(id);
  const voucher = await deps.repo.createVoucher({
    id,
    kind: "gift",
    codeHash,
    codeLast4,
    amountCents: req.amountCents,
    balanceCents: 0,
    status: "pending",
    buyerName: req.buyerName,
    buyerEmail: req.buyerEmail,
    recipientName: req.recipientName,
    recipientEmail: req.recipientEmail,
    message: req.message,
    expiresOn: addMonths(today, settings.voucherValidMonths),
    sourceOrderId: null,
  });
  const reference = newReference("GIFT");
  const checkout = await deps.payments.createCheckout({
    targetId: id,
    reference,
    kind: "voucher",
    amountCents: req.amountCents,
    description: `${BUSINESS.name} gift voucher (${formatAud(req.amountCents)})`,
    customerEmail: req.buyerEmail,
    successUrl: `${deps.baseUrl}/vouchers/thanks`,
    cancelUrl: `${deps.baseUrl}/vouchers?cancelled=1`,
  });
  await deps.repo.createPayment({ orderId: null, boxOrderId: null, voucherId: id, kind: "voucher", amountCents: req.amountCents, stripeSessionId: checkout.id });
  return { checkoutUrl: checkout.url, voucher };
}

/** After Stripe confirms payment: email the code to the buyer (and the recipient, if given). */
export async function sendVoucherEmails(deps: LightDeps, voucher: Voucher): Promise<void> {
  const code = voucherCode(voucher.id);
  await sendSafely(deps.mailer, voucherEmail(voucher, code, "buyer"));
  if (voucher.recipientEmail) await sendSafely(deps.mailer, voucherEmail(voucher, code, "recipient"));
}

/** Create a credit code and email it to the customer. */
export async function issueCredit(
  deps: LightDeps,
  opts: { email: string; name: string; amountCents: number; reason: string; sourceOrderId: string | null },
): Promise<Voucher | null> {
  if (opts.amountCents <= 0) return null;
  const settings = await deps.repo.getSettings();
  const today = todayInBusinessTz(nowOf(deps));
  const id = randomUUID();
  const { code, codeHash, codeLast4 } = codeFields(id);
  const voucher = await deps.repo.createVoucher({
    id,
    kind: "credit",
    codeHash,
    codeLast4,
    amountCents: opts.amountCents,
    balanceCents: opts.amountCents,
    status: "active",
    buyerName: opts.name,
    buyerEmail: opts.email,
    recipientName: "",
    recipientEmail: "",
    message: "",
    expiresOn: addMonths(today, settings.voucherValidMonths),
    sourceOrderId: opts.sourceOrderId,
  });
  await sendSafely(deps.mailer, creditCodeEmail(opts.email, opts.name, code, opts.amountCents, voucher.expiresOn, opts.reason));
  return voucher;
}

export type CodeCheck = { ok: true; balanceCents: number; kind: Voucher["kind"]; expiresOn: string } | { ok: false; error: string };

/** Look up a code for the checkout's "Apply" button. Callers must rate limit this. */
export async function checkCode(repo: Repository, code: string, today: string): Promise<CodeCheck> {
  if (!looksLikeCode(code)) return { ok: false, error: VOUCHER_PROBLEM_TEXT.not_found };
  const v = await repo.getVoucherByCodeHash(hashCode(code));
  const problem = voucherProblem(v, today);
  if (problem) return { ok: false, error: VOUCHER_PROBLEM_TEXT[problem] };
  return { ok: true, balanceCents: v!.balanceCents, kind: v!.kind, expiresOn: v!.expiresOn };
}
