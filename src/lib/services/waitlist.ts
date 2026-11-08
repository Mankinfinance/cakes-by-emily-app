// Waitlist for fully booked dates. When a place frees up, the first person
// in line gets an emailed claim link that holds the place for 24 hours.

import { dateStatus } from "../domain/availability";
import { todayInBusinessTz } from "../domain/dates";
import type { WaitlistEntry } from "../domain/types";
import { sanitizeConfig } from "../domain/visibility";
import { expiredOffers, isActiveOffer, nextInLine, OFFER_HOURS, placeInLine } from "../domain/waitlist";
import type { WaitlistRequest } from "../validation";
import { calendarContext } from "./calendar";
import { nowOf, OrderError, type LightDeps } from "./common";
import { sendSafely, waitlistJoinedEmail, waitlistOfferEmail } from "./email";
import { hashToken, looksLikeToken, randomToken } from "./tokens";

export const claimLink = (baseUrl: string, token: string) => `${baseUrl}/waitlist/${token}`;

export async function joinWaitlist(deps: LightDeps, req: WaitlistRequest): Promise<{ entry: WaitlistEntry; place: number }> {
  const now = nowOf(deps);
  const ctx = await calendarContext(deps.repo, now);
  const status = dateStatus(req.date, ctx);
  if (status.state !== "full") {
    throw new OrderError(status.bookable ? "Good news: that date has room, so you can book it now." : "That date isn't taking a waitlist.", 409);
  }
  const existing = await deps.repo.listWaitlist({ date: req.date });
  if (existing.some((e) => e.email === req.email && (e.status === "waiting" || e.status === "offered"))) {
    throw new OrderError("You're already on the waitlist for that date.", 409);
  }
  const { config } = sanitizeConfig(req.config, await deps.repo.listCatalogue(), req.dietary);
  const entry = await deps.repo.addWaitlist({
    date: req.date,
    customerName: req.customerName,
    email: req.email,
    phone: req.phone,
    config,
    dietary: req.dietary,
  });
  const place = placeInLine(await deps.repo.listWaitlist({ date: req.date }), entry.id) ?? 1;
  await sendSafely(deps.mailer, waitlistJoinedEmail(entry, place));
  return { entry, place };
}

/**
 * Offer a freed place on `date` to the next person, if the date really has
 * room and nobody already holds an offer. Safe to call any time.
 */
export async function offerNext(deps: LightDeps, date: string): Promise<WaitlistEntry | null> {
  const now = nowOf(deps);
  const entries = await deps.repo.listWaitlist({ date });
  const candidate = nextInLine(entries, date, now);
  if (!candidate) return null;
  const ctx = await calendarContext(deps.repo, now);
  if (!dateStatus(date, ctx).bookable) return null;
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + OFFER_HOURS * 3_600_000).toISOString();
  const ok = await deps.repo.offerWaitlist(candidate.id, hashToken(token), now.toISOString(), expiresAt);
  if (!ok) return null;
  await sendSafely(deps.mailer, waitlistOfferEmail(candidate, claimLink(deps.baseUrl, token), expiresAt));
  return { ...candidate, status: "offered", offerExpiresAt: expiresAt };
}

/** Daily: end offers that ran out, then offer the place to the next person. */
export async function expireOffers(deps: LightDeps): Promise<{ expired: number; offered: number }> {
  const now = nowOf(deps);
  const today = todayInBusinessTz(now);
  const entries = await deps.repo.listWaitlist({ fromDate: today });
  const gone = expiredOffers(entries, now);
  for (const e of gone) await deps.repo.setWaitlistStatus(e.id, "expired");
  let offered = 0;
  const dates = new Set([...gone.map((e) => e.date), ...entries.filter((e) => e.status === "waiting").map((e) => e.date)]);
  for (const date of dates) if (await offerNext(deps, date)) offered++;
  return { expired: gone.length, offered };
}

/** A live offer from its claim link token, or null. */
export async function offerFromToken(deps: Pick<LightDeps, "repo" | "now">, token: string): Promise<WaitlistEntry | null> {
  if (!looksLikeToken(token)) return null;
  const entry = await deps.repo.getWaitlistByOfferHash(hashToken(token));
  if (!entry || !isActiveOffer(entry, nowOf(deps))) return null;
  return entry;
}
