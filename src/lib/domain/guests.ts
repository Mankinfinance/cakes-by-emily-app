// Phase 5: private class guests changing their own details, and codes
// (gift vouchers, credit codes, class pass credits) on a guest's own share.

import { addDays } from "./dates";
import type { DietaryFilter, PrivateGuest } from "./types";

/** The last day a guest can change their details online. */
export function guestEditDeadline(classDate: string, cutoffDays: number): string {
  return addDays(classDate, -Math.max(0, cutoffDays));
}

/** Can a guest still change their own details today? */
export function guestCanEdit(classDate: string, today: string, cutoffDays: number): boolean {
  return today <= guestEditDeadline(classDate, cutoffDays) && today < classDate;
}

type Details = { allergies: string; dietary: DietaryFilter[] };

/** Did the allergy or dietary details change? (Emily is told when they do.) */
export function allergyChanged(before: Details, after: Details): boolean {
  const norm = (d: DietaryFilter[]) => [...d].sort().join(",");
  return before.allergies.trim() !== after.allergies.trim() || norm(before.dietary) !== norm(after.dietary);
}

/** What one class pass credit is worth on a private class share: what the pass cost per credit. */
export function passCreditValue(passPriceCents: number, passCredits: number): number {
  return Math.floor(passPriceCents / Math.max(1, passCredits));
}

/** What a guest still has to pay on their share after any voucher or pass credit. */
export function shareOwed(g: Pick<PrivateGuest, "shareCents" | "voucherAppliedCents" | "passAppliedCents">): number {
  return Math.max(0, g.shareCents - (g.voucherAppliedCents ?? 0) - (g.passAppliedCents ?? 0));
}

/** Only one code per share, and only while the share is open and not mid-payment. */
export function shareCodeProblem(g: Pick<PrivateGuest, "status" | "holdKey" | "holdUntil" | "voucherId" | "passId">, nowIso: string): string | null {
  if (g.status === "paid") return "Your share is already paid.";
  if (g.voucherId || g.passId) return "A code is already applied to this share.";
  if (g.holdKey && g.holdUntil && g.holdUntil > nowIso) return "Your share is being paid right now. Please try again in a few minutes.";
  return null;
}
