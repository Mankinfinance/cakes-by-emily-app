// The 3-class pass: bought once, used one seat at a time with a code.

import { randomUUID } from "node:crypto";
import { BUSINESS } from "../config";
import { addMonths, todayInBusinessTz } from "../domain/dates";
import { formatAud } from "../domain/money";
import type { ClassPass } from "../domain/types";
import { looksLikeCode, normalizeCode } from "../domain/vouchers";
import type { Repository } from "../data/repository";
import { nowOf, OrderError, type Deps, type LightDeps } from "./common";
import { passEmail, sendSafely } from "./email";
import { hashCode, passCode } from "./tokens";

export async function startPassPurchase(deps: Deps, req: { buyerName: string; buyerEmail: string }): Promise<{ checkoutUrl: string; pass: ClassPass }> {
  const settings = await deps.repo.getSettings();
  if (!settings.passEnabled) throw new OrderError("Class passes aren't available right now.");
  const id = randomUUID();
  const code = passCode(id);
  const pass = await deps.repo.createPass({
    id,
    codeHash: hashCode(code),
    codeLast4: normalizeCode(code).slice(-4),
    creditsTotal: settings.passCredits,
    creditsLeft: 0,
    status: "pending",
    buyerName: req.buyerName,
    buyerEmail: req.buyerEmail,
    expiresOn: addMonths(todayInBusinessTz(nowOf(deps)), settings.passValidMonths),
  });
  const checkout = await deps.payments.createCheckout({
    targetId: id,
    reference: `PASS-${pass.codeLast4}`,
    kind: "pass",
    amountCents: settings.passPriceCents,
    description: `${BUSINESS.name}: ${settings.passCredits}-class pass (${formatAud(settings.passPriceCents)})`,
    customerEmail: req.buyerEmail,
    successUrl: `${deps.baseUrl}/classes/pass/thanks`,
    cancelUrl: `${deps.baseUrl}/classes/pass?cancelled=1`,
  });
  await deps.repo.createPayment({ orderId: null, boxOrderId: null, voucherId: null, passId: id, kind: "pass", amountCents: settings.passPriceCents, stripeSessionId: checkout.id });
  return { checkoutUrl: checkout.url, pass };
}

export async function onPassPaid(deps: LightDeps, pass: ClassPass): Promise<void> {
  const fresh = (await deps.repo.getPassById(pass.id)) ?? pass;
  await sendSafely(deps.mailer, passEmail(fresh, passCode(pass.id)));
}

/** Check a pass code before booking, for a clear message. Returns its hash. */
export async function precheckPass(repo: Repository, code: string, today: string): Promise<string | null> {
  if (!code) return null;
  const bad = "That class pass code wasn't recognised, or it has no credits left.";
  if (!looksLikeCode(code)) throw new OrderError(bad);
  const hash = hashCode(code);
  const p = await repo.getPassByCodeHash(hash);
  if (!p || p.status !== "active" || p.creditsLeft <= 0) throw new OrderError(bad);
  if (p.expiresOn < today) throw new OrderError("That class pass has expired.");
  return hash;
}
