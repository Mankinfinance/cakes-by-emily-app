// Split payments for private classes: each guest pays their share of the
// balance (total minus deposit), and the organiser can pay what's left after
// the due date.

import { addDays } from "./dates";
import type { PrivateGuest, PrivateRequest } from "./types";

/** Shares in cents, one per guest. Any remainder cents go on the first share. */
export function shareAmounts(totalCents: number, depositCents: number, guests: number): number[] {
  const n = Math.max(1, guests);
  const balance = Math.max(0, totalCents - depositCents);
  const each = Math.floor(balance / n);
  const shares = Array.from({ length: n }, () => each);
  shares[0] += balance - each * n;
  return shares;
}

export function shareDueDate(request: Pick<PrivateRequest, "preferredDate">, splitDueDays: number): string {
  return addDays(request.preferredDate, -splitDueDays);
}

/** Is this place free to be held for payment right now? */
export function holdable(g: Pick<PrivateGuest, "status" | "holdKey" | "holdUntil">, nowIso: string): boolean {
  return g.status === "open" && (!g.holdKey || !g.holdUntil || g.holdUntil <= nowIso);
}

export interface SplitProgress {
  guests: number;
  paid: number;
  detailsIn: number;
  paidCents: number;
  owingCents: number;
  /** Names of guests who have paid (others see names only, never allergies). */
  paidNames: string[];
  waitingNames: string[];
}

export function splitProgress(guests: PrivateGuest[]): SplitProgress {
  const paid = guests.filter((g) => g.status === "paid");
  return {
    guests: guests.length,
    paid: paid.length,
    detailsIn: guests.filter((g) => g.name).length,
    paidCents: paid.reduce((s, g) => s + g.shareCents, 0),
    owingCents: guests.filter((g) => g.status === "open").reduce((s, g) => s + g.shareCents, 0),
    paidNames: paid.map((g) => g.name || `Guest ${g.slot}`),
    waitingNames: guests.filter((g) => g.status === "open" && g.name).map((g) => g.name),
  };
}

/** Can the organiser pay the remaining shares yet? */
export function organiserCanPayRest(today: string, dueDate: string, progress: SplitProgress): boolean {
  return today >= dueDate && progress.owingCents > 0;
}

export const NUDGE_COOLDOWN_HOURS = 24;

export function canNudge(lastNudgeAt: string | null, now: Date): boolean {
  return !lastNudgeAt || new Date(lastNudgeAt).getTime() <= now.getTime() - NUDGE_COOLDOWN_HOURS * 3_600_000;
}
