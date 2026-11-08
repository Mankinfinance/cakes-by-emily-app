// Waitlist ordering rules. One offer at a time per date, first come first served.

import type { WaitlistEntry } from "./types";

export const OFFER_HOURS = 24;

export function isActiveOffer(e: WaitlistEntry, now: Date): boolean {
  return e.status === "offered" && !!e.offerExpiresAt && e.offerExpiresAt > now.toISOString();
}

/** Offers whose 24 hours have run out. */
export function expiredOffers(entries: WaitlistEntry[], now: Date): WaitlistEntry[] {
  return entries.filter((e) => e.status === "offered" && (!e.offerExpiresAt || e.offerExpiresAt <= now.toISOString()));
}

/** Who should get the next offer for a date, or null (someone already holds an offer, or nobody is waiting). */
export function nextInLine(entries: WaitlistEntry[], date: string, now: Date): WaitlistEntry | null {
  const forDate = entries.filter((e) => e.date === date);
  if (forDate.some((e) => isActiveOffer(e, now))) return null;
  return (
    forDate
      .filter((e) => e.status === "waiting")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0] ?? null
  );
}

/** A customer's place in the queue (1-based), or null if they are not waiting. */
export function placeInLine(entries: WaitlistEntry[], id: string): number | null {
  const me = entries.find((e) => e.id === id);
  if (!me || me.status !== "waiting") return null;
  const ahead = entries.filter(
    (e) => e.date === me.date && (e.status === "waiting" || e.status === "offered") && (e.createdAt < me.createdAt || (e.createdAt === me.createdAt && e.id < me.id)),
  );
  return ahead.length + 1;
}
