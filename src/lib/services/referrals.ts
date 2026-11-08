// Referral codes ("give $10, get $10") and the stamp card.

import { randomInt } from "node:crypto";
import { looksLikeReferral, normalizeReferral, REFERRAL_PROBLEM_TEXT, referralCodeFrom, referralProblem, stampCard, type StampCard } from "../domain/referrals";
import type { Order, Settings } from "../domain/types";
import type { Repository } from "../data/repository";
import { OrderError, type LightDeps } from "./common";
import { referralRewardNote } from "./email";
import { issueCredit } from "./vouchers";

/** The customer's own shareable code, created the first time it's needed. */
export async function referralCodeFor(repo: Repository, email: string, name: string): Promise<string> {
  const existing = await repo.getReferralCodeByEmail(email);
  if (existing) return existing.code;
  for (let i = 0; i < 6; i++) {
    const code = referralCodeFrom(name, randomInt);
    if (await repo.createReferralCode(code, email)) return code;
    const raced = await repo.getReferralCodeByEmail(email);
    if (raced) return raced.code;
  }
  throw new Error("Could not create a referral code.");
}

/** Check a referral code for a customer. Returns the normalised code and the referrer, or throws a friendly error. */
export async function checkReferral(repo: Repository, settings: Settings, input: string, customerEmail: string): Promise<{ code: string; referrerEmail: string }> {
  const code = normalizeReferral(input);
  const found = looksLikeReferral(code) ? await repo.getReferralCode(code) : null;
  const [orders, referrals] = await Promise.all([repo.listOrdersByEmail(customerEmail), repo.listReferrals()]);
  const problem = referralProblem({
    enabled: settings.referralsEnabled,
    referrerEmail: found?.email ?? null,
    customerEmail,
    customerHasOrders: orders.some((o) => o.stage !== "awaiting_payment" && !(o.stage === "cancelled" && o.amountPaidCents === 0)),
    customerAlreadyReferred: referrals.some((r) => r.status !== "void" && r.referredEmail.toLowerCase() === customerEmail.toLowerCase()),
  });
  if (problem) throw new OrderError(REFERRAL_PROBLEM_TEXT[problem]);
  return { code, referrerEmail: found!.email };
}

/** When a referred order's deposit is paid, the referrer gets their credit, once. */
export async function rewardReferral(deps: LightDeps, order: Order): Promise<boolean> {
  if (!order.referralCode) return false;
  const referral = await deps.repo.rewardReferralOnce(order.id);
  if (!referral) return false;
  const settings = await deps.repo.getSettings();
  const owner = await deps.repo.getReferralCode(referral.code);
  await issueCredit(deps, {
    email: referral.referrerEmail,
    name: owner?.email.split("@")[0] ?? "",
    amountCents: settings.referralGetCents,
    reason: referralRewardNote(order.customerName),
    sourceOrderId: order.id,
  });
  return true;
}

/** Stamps for a customer: collected orders, and rewards already used. */
export async function stampCardFor(repo: Repository, settings: Settings, email: string): Promise<StampCard> {
  const orders = await repo.listOrdersByEmail(email);
  const collected = orders.filter((o) => o.stage === "collected").length;
  // Rewards used are counted from the claims table, keyed by email address.
  const used = await repo.countStampRewards(email);
  return stampCard(collected, used, settings.stampEvery);
}
