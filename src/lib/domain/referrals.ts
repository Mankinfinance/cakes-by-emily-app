// Referrals ("give $10, get $10") and the stamp card. Pure rules; the
// services enforce them with the database.

import { CODE_ALPHABET } from "./vouchers";

/** A friendly, shareable referral code like "SAM-7K3Q". */
export function referralCodeFrom(name: string, random: (n: number) => number): string {
  const first = (name.trim().split(/\s+/)[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8) || "CAKE";
  let tail = "";
  for (let i = 0; i < 4; i++) tail += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return `${first}-${tail}`;
}

export function normalizeReferral(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

export function looksLikeReferral(input: string): boolean {
  return /^[A-Z]{1,8}-[A-Z2-9]{4}$/.test(normalizeReferral(input));
}

export type ReferralProblem = "disabled" | "not_found" | "own_code" | "not_new" | "already_referred";

export const REFERRAL_PROBLEM_TEXT: Record<ReferralProblem, string> = {
  disabled: "Referral codes aren't available right now.",
  not_found: "That referral code wasn't recognised.",
  own_code: "You can't use your own referral code.",
  not_new: "Referral codes are for a first order.",
  already_referred: "A referral code has already been used for this email.",
};

/** Can this customer (by email) use this referral code on their order? */
export function referralProblem(opts: {
  enabled: boolean;
  referrerEmail: string | null;
  customerEmail: string;
  customerHasOrders: boolean;
  customerAlreadyReferred: boolean;
}): ReferralProblem | null {
  if (!opts.enabled) return "disabled";
  if (!opts.referrerEmail) return "not_found";
  if (opts.referrerEmail.toLowerCase() === opts.customerEmail.toLowerCase()) return "own_code";
  if (opts.customerAlreadyReferred) return "already_referred";
  if (opts.customerHasOrders) return "not_new";
  return null;
}

export interface StampCard {
  every: number;
  /** Stamps on the current card (0 to every-1). */
  stamps: number;
  rewardsEarned: number;
  rewardsUsed: number;
  rewardsAvailable: number;
}

/** Every Nth collected order earns a reward; each reward is used once. */
export function stampCard(collectedOrders: number, rewardsUsed: number, every: number): StampCard {
  const n = Math.max(2, every);
  const earned = Math.floor(collectedOrders / n);
  return {
    every: n,
    stamps: collectedOrders % n,
    rewardsEarned: earned,
    rewardsUsed,
    rewardsAvailable: Math.max(0, earned - rewardsUsed),
  };
}
