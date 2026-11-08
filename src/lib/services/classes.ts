// Cake and Sip classes: booking seats (taken atomically), the class
// waitlist (an offer holds the seats for 24 hours), cancellations with refund
// records, recurring sessions, class messages, and private group requests.

import { randomUUID } from "node:crypto";
import { BUSINESS } from "../config";
import { automationMap } from "../domain/automations";
import { belowMinimum, classPrice, MAX_SEATS_PER_BOOKING, privateEstimate, recurringDates, seatsLeft } from "../domain/classes";
import { addDays, daysBetween, todayInBusinessTz } from "../domain/dates";
import type { CancellationRecord, ClassBooking, ClassSession, ClassType, PrivateRequest, WaitlistEntry } from "../domain/types";
import { expiredOffers, isActiveOffer, nextInLine, OFFER_HOURS, placeInLine } from "../domain/waitlist";
import { RELEASE_AFTER_MINUTES, type Repository } from "../data/repository";
import type { ClassBookingRequest, ClassWaitlistRequest, PrivateRequestInput } from "../validation";
import { adminEmail, nowOf, OrderError, ticketLink, type Deps, type LightDeps } from "./common";
import {
  classAlertEmail,
  classCancelledAlertEmail,
  classCancelledEmail,
  classReminderEmail,
  classThankYouEmail,
  classTicketEmail,
  classWaitlistJoinedEmail,
  classWaitlistOfferEmail,
  privateAcceptedEmail,
  privateAlertEmail,
  privateDeclinedEmail,
  privatePaidEmail,
  privateReceivedEmail,
  sendSafely,
  type Email,
} from "./email";
import { pickupDetailsText } from "./messages";
import { hashToken, linkToken, looksLikeToken, newReference, randomToken } from "./tokens";

export const classClaimLink = (baseUrl: string, token: string) => `${baseUrl}/classes/claim/${token}`;
export const privatePayLink = (baseUrl: string, token: string) => `${baseUrl}/p/${token}`;

async function sessionAndType(repo: Repository, sessionId: string): Promise<{ session: ClassSession; type: ClassType }> {
  const session = await repo.getSession(sessionId);
  if (!session) throw new OrderError("That class wasn't found.", 404);
  const type = (await repo.listClassTypes()).find((t) => t.id === session.classTypeId);
  if (!type) throw new OrderError("That class wasn't found.", 404);
  return { session, type };
}

/** A live class waitlist offer from its claim token, or null. */
export async function classOfferFromToken(deps: Pick<LightDeps, "repo" | "now">, token: string): Promise<WaitlistEntry | null> {
  if (!looksLikeToken(token)) return null;
  const entry = await deps.repo.getWaitlistByOfferHash(hashToken(token));
  if (!entry || !entry.sessionId || !isActiveOffer(entry, nowOf(deps))) return null;
  return entry;
}

export async function bookClass(deps: Deps, req: ClassBookingRequest) {
  const { repo } = deps;
  const now = nowOf(deps);
  const today = todayInBusinessTz(now);
  const settings = await repo.getSettings();
  const { session, type } = await sessionAndType(repo, req.sessionId);
  if (session.status !== "scheduled" || session.date <= today || !type.visible) throw new OrderError("Sorry, that class isn't taking bookings.", 409);
  if (req.seats > MAX_SEATS_PER_BOOKING) throw new OrderError(`Up to ${MAX_SEATS_PER_BOOKING} seats per booking.`);
  if (type.isSip && !req.adultConfirmed) throw new OrderError("Please confirm everyone is 18 or over for this class.");

  // Claiming a waitlist offer: its seats are already held for this person.
  let claim: WaitlistEntry | null = null;
  if (req.waitlistToken) {
    claim = await classOfferFromToken(deps, req.waitlistToken);
    if (!claim || claim.sessionId !== session.id) throw new OrderError("Sorry, that waitlist offer has expired.", 410);
    if ((claim.seats ?? 1) !== req.seats) throw new OrderError(`This offer is for ${claim.seats} ${claim.seats === 1 ? "seat" : "seats"}.`);
    if (!(await repo.claimWaitlist(claim.id, null, now.toISOString()))) {
      throw new OrderError("Sorry, that waitlist offer has expired.", 410);
    }
  } else if (!(await repo.reserveSeats(session.id, req.seats))) {
    const left = seatsLeft((await repo.getSession(session.id)) ?? session);
    throw new OrderError(left === 0 ? "Sorry, that class is sold out. Join the waitlist instead." : `Sorry, only ${left} ${left === 1 ? "seat is" : "seats are"} left.`, 409);
  }

  const price = classPrice(type.priceCents, req.seats, settings);
  const id = randomUUID();
  let booking: ClassBooking;
  try {
    booking = await repo.createBooking({
      id,
      reference: newReference("CLS"),
      tokenHash: hashToken(linkToken("booking", id)),
      sessionId: session.id,
      seats: req.seats,
      guests: req.guests.map((g) => ({ name: g.name, allergies: g.allergies, checkedIn: false })),
      contactName: req.contactName,
      email: req.email,
      phone: req.phone,
      unitPriceCents: type.priceCents,
      discountCents: price.discountCents,
      totalCents: price.totalCents,
      adultConfirmed: req.adultConfirmed,
      marketingOptIn: req.marketingOptIn,
      waitlistId: claim?.id ?? null,
      termsAcceptedAt: now.toISOString(),
    });
    const link = ticketLink(deps.baseUrl, id);
    const checkout = await deps.payments.createCheckout({
      targetId: id,
      reference: booking.reference,
      kind: "class",
      amountCents: price.totalCents,
      description: `${BUSINESS.name}: ${type.name} x ${req.seats}`,
      customerEmail: req.email,
      successUrl: `${link}?paid=1`,
      cancelUrl: `${deps.baseUrl}/classes?cancelled=1`,
    });
    await repo.createPayment({ orderId: null, boxOrderId: null, voucherId: null, classBookingId: id, kind: "class", amountCents: price.totalCents, stripeSessionId: checkout.id });
    return { booking, checkoutUrl: checkout.url };
  } catch (err) {
    // Give the seats back if anything after reserving failed.
    if (!(await repo.getBookingById(id))) await repo.releaseSeats(session.id, req.seats);
    else await repo.cancelBookingOnce(id, true, null);
    throw err;
  }
}

/** After payment: the ticket to the booker, an alert to Emily. */
export async function onClassPaid(deps: LightDeps, booking: ClassBooking): Promise<void> {
  const { session, type } = await sessionAndType(deps.repo, booking.sessionId);
  await sendSafely(deps.mailer, classTicketEmail(booking, session, type, ticketLink(deps.baseUrl, booking.id)));
  const to = adminEmail();
  if (to) await sendSafely(deps.mailer, classAlertEmail(booking, session, type, to));
}

export async function joinClassWaitlist(deps: LightDeps, req: ClassWaitlistRequest): Promise<{ place: number }> {
  const { session, type } = await sessionAndType(deps.repo, req.sessionId);
  if (session.status !== "scheduled") throw new OrderError("That class isn't taking a waitlist.", 409);
  if (seatsLeft(session) >= req.seats) throw new OrderError("Good news: there are seats left, so you can book now.", 409);
  const existing = await deps.repo.listWaitlist({ sessionId: session.id });
  if (existing.some((e) => e.email === req.email && (e.status === "waiting" || e.status === "offered"))) {
    throw new OrderError("You're already on the waitlist for this class.", 409);
  }
  const entry = await deps.repo.addWaitlist({
    date: session.date,
    sessionId: session.id,
    seats: req.seats,
    customerName: req.customerName,
    email: req.email,
    phone: req.phone,
    config: { occasion: "", size: "", flavour: "", finish: "", colour: "", decorations: [], extras: [], topperText: "" },
    dietary: [],
  });
  const place = placeInLine(await deps.repo.listWaitlist({ sessionId: session.id }), entry.id) ?? 1;
  await sendSafely(deps.mailer, classWaitlistJoinedEmail(entry, type, session, place));
  return { place };
}

/** Offer freed seats to the next person in line, holding them for 24 hours. */
export async function offerNextClass(deps: LightDeps, sessionId: string): Promise<WaitlistEntry | null> {
  const now = nowOf(deps);
  const { session, type } = await sessionAndType(deps.repo, sessionId);
  if (session.status !== "scheduled" || session.date <= todayInBusinessTz(now)) return null;
  const entries = await deps.repo.listWaitlist({ sessionId });
  const candidate = nextInLine(entries, session.date, now);
  if (!candidate) return null;
  const seats = candidate.seats ?? 1;
  if (!(await deps.repo.reserveSeats(sessionId, seats))) return null;
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + OFFER_HOURS * 3_600_000).toISOString();
  if (!(await deps.repo.offerWaitlist(candidate.id, hashToken(token), now.toISOString(), expiresAt))) {
    await deps.repo.releaseSeats(sessionId, seats);
    return null;
  }
  await sendSafely(deps.mailer, classWaitlistOfferEmail(candidate, type, session, classClaimLink(deps.baseUrl, token), expiresAt));
  return candidate;
}

/** Daily: release seats held by expired offers and offer them to the next person. */
export async function expireClassOffers(deps: LightDeps): Promise<{ expired: number; offered: number }> {
  const now = nowOf(deps);
  const today = todayInBusinessTz(now);
  const all = (await deps.repo.listWaitlist({ all: true, fromDate: today })).filter((e) => e.sessionId);
  const gone = expiredOffers(all, now);
  for (const e of gone) {
    await deps.repo.setWaitlistStatus(e.id, "expired");
    await deps.repo.releaseSeats(e.sessionId!, e.seats ?? 1);
  }
  let offered = 0;
  const sessions = new Set(all.filter((e) => e.status === "waiting" || gone.includes(e)).map((e) => e.sessionId!));
  for (const id of sessions) if (await offerNextClass(deps, id)) offered++;
  return { expired: gone.length, offered };
}

function emilyCancelRecord(b: ClassBooking, daysOut: number, reason: string): CancellationRecord {
  return {
    at: new Date().toISOString(),
    by: "emily",
    daysOut,
    refundCents: b.amountPaidCents,
    creditCents: 0,
    keptCents: 0,
    voucherReturnedCents: 0,
    summary: `${reason} Everything paid (${(b.amountPaidCents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" })}) is refunded.`,
  };
}

/** Emily cancels one booking: full refund recorded, seats go to the waitlist. */
export async function cancelBooking(deps: LightDeps, bookingId: string): Promise<CancellationRecord> {
  const booking = await deps.repo.getBookingById(bookingId);
  if (!booking) throw new OrderError("Booking not found.", 404);
  const { session, type } = await sessionAndType(deps.repo, booking.sessionId);
  const record = emilyCancelRecord(booking, daysBetween(todayInBusinessTz(nowOf(deps)), session.date), "Emily cancelled this booking.");
  if (!(await deps.repo.cancelBookingOnce(booking.id, false, record))) throw new OrderError("This booking is already cancelled.", 409);
  await sendSafely(deps.mailer, classCancelledEmail(booking, type, session, record));
  const to = adminEmail();
  if (to) await sendSafely(deps.mailer, classCancelledAlertEmail(type, session, record.refundCents ? [{ reference: booking.reference, cents: record.refundCents }] : [], to));
  await offerNextClass(deps, session.id);
  return record;
}

/** Emily cancels a whole class (for example below the minimum): every booking is refunded. */
export async function cancelClass(deps: LightDeps, sessionId: string): Promise<{ refunds: { reference: string; cents: number }[] }> {
  const { session, type } = await sessionAndType(deps.repo, sessionId);
  if (session.status === "cancelled") throw new OrderError("This class is already cancelled.", 409);
  await deps.repo.updateSession(session.id, { status: "cancelled" });
  const daysOut = daysBetween(todayInBusinessTz(nowOf(deps)), session.date);
  const refunds: { reference: string; cents: number }[] = [];
  for (const b of await deps.repo.listBookings({ sessionId, includeUnpaid: true })) {
    if (b.status === "cancelled") continue;
    const record = emilyCancelRecord(b, daysOut, "This class has been cancelled.");
    if (await deps.repo.cancelBookingOnce(b.id, false, record)) {
      if (b.status === "paid") {
        if (record.refundCents) refunds.push({ reference: b.reference, cents: record.refundCents });
        await sendSafely(deps.mailer, classCancelledEmail(b, type, session, record));
      }
    }
  }
  for (const w of await deps.repo.listWaitlist({ sessionId })) {
    if (w.status === "waiting" || w.status === "offered") await deps.repo.setWaitlistStatus(w.id, "removed");
  }
  const to = adminEmail();
  if (to) await sendSafely(deps.mailer, classCancelledAlertEmail(type, session, refunds, to));
  return { refunds };
}

export async function setCheckIn(repo: Repository, bookingId: string, guestIndex: number, checkedIn: boolean): Promise<void> {
  const b = await repo.getBookingById(bookingId);
  if (!b || guestIndex < 0 || guestIndex >= b.guests.length) throw new OrderError("Guest not found.", 404);
  await repo.updateBookingGuests(b.id, b.guests.map((g, i) => (i === guestIndex ? { ...g, checkedIn } : g)));
}

export interface SeriesInput {
  classTypeId: string;
  date: string;
  startTime: string;
  seats: number;
  everyDays: number;
  count: number;
}

/** Preview the dates for a recurring series (skipping days off and closed weekdays). */
export async function previewSeries(repo: Repository, input: SeriesInput) {
  const [daysOff, settings] = await Promise.all([repo.listDaysOff(), repo.getSettings()]);
  return recurringDates(input.date, input.everyDays, input.count, new Set(daysOff.map((d) => d.date)), settings.closedWeekdays);
}

export async function createSeries(deps: Pick<LightDeps, "repo" | "now">, input: SeriesInput): Promise<ClassSession[]> {
  const types = await deps.repo.listClassTypes();
  if (!types.some((t) => t.id === input.classTypeId)) throw new OrderError("Choose a class.");
  if (input.date <= todayInBusinessTz(nowOf(deps))) throw new OrderError("Choose a date in the future.");
  const dates = (await previewSeries(deps.repo, input)).filter((d) => !d.skipped);
  const seriesId = input.count > 1 ? randomUUID() : null;
  const created: ClassSession[] = [];
  for (const d of dates) {
    created.push(
      await deps.repo.createSession({ id: randomUUID(), classTypeId: input.classTypeId, date: d.date, startTime: input.startTime, seats: input.seats, status: "scheduled", seriesId }),
    );
  }
  return created;
}

async function sendBookingOnce(deps: LightDeps, bookingId: string, key: string, email: Email): Promise<boolean> {
  if (!(await deps.repo.claimBookingMessage(bookingId, key))) return false;
  if (await sendSafely(deps.mailer, email)) return true;
  await deps.repo.releaseBookingMessage(bookingId, key);
  return false;
}

/** Daily: class reminders before, thank-yous after. Each sent once per booking. */
export async function runClassMessages(deps: LightDeps): Promise<{ class_reminder: number; class_thank_you: number }> {
  const today = todayInBusinessTz(nowOf(deps));
  const [automations, settings, types, sessions, bookings] = await Promise.all([
    deps.repo.listAutomations(),
    deps.repo.getSettings(),
    deps.repo.listClassTypes(),
    deps.repo.listSessions({ fromDate: addDays(today, -30) }),
    deps.repo.listBookings(),
  ]);
  const a = automationMap(automations);
  const counts = { class_reminder: 0, class_thank_you: 0 };
  for (const b of bookings) {
    if (b.status !== "paid") continue;
    const session = sessions.find((s) => s.id === b.sessionId);
    const type = session && types.find((t) => t.id === session.classTypeId);
    if (!session || !type) continue;
    const daysOut = daysBetween(today, session.date);
    const link = ticketLink(deps.baseUrl, b.id);
    if (a.class_reminder.enabled && daysOut >= 0 && daysOut <= a.class_reminder.days) {
      if (await sendBookingOnce(deps, b.id, "class_reminder", classReminderEmail(b, session, type, link, pickupDetailsText()))) counts.class_reminder++;
    }
    if (a.class_thank_you.enabled && -daysOut >= a.class_thank_you.days) {
      const google = settings.reviewUrl || process.env.REVIEW_URL || "";
      if (await sendBookingOnce(deps, b.id, "class_thank_you", classThankYouEmail(b, type, google, `${deps.baseUrl}/order`))) counts.class_thank_you++;
    }
  }
  return counts;
}

/** Daily: cancel class bookings that were never paid, giving their seats back. */
export async function releaseStaleBookings(deps: LightDeps): Promise<number> {
  const before = new Date(nowOf(deps).getTime() - RELEASE_AFTER_MINUTES * 60_000).toISOString();
  let n = 0;
  for (const b of await deps.repo.listStaleUnpaidBookings(before)) {
    if (await deps.repo.cancelBookingOnce(b.id, true, null)) {
      n++;
      await offerNextClass(deps, b.sessionId);
    }
  }
  return n;
}

/** Sessions with their type, seats left and the below-minimum warning, for listings. */
export async function sessionsWithTypes(repo: Repository, fromDate: string, opts?: { includeCancelled?: boolean }) {
  const [sessions, types] = await Promise.all([repo.listSessions({ fromDate, includeCancelled: opts?.includeCancelled }), repo.listClassTypes()]);
  return sessions
    .map((s) => {
      const type = types.find((t) => t.id === s.classTypeId);
      return type ? { session: s, type, left: seatsLeft(s), belowMin: belowMinimum(s, type) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

// Private group classes -----------------------------------------------------------

export async function requestPrivate(deps: LightDeps, input: PrivateRequestInput): Promise<PrivateRequest> {
  const settings = await deps.repo.getSettings();
  const pkg = settings.privatePackages.find((p) => p.key === input.packageKey && p.visible);
  if (!pkg) throw new OrderError("Please choose a package.");
  const est = privateEstimate(pkg, input.guests);
  if (!est.ok) throw new OrderError(`${pkg.name} is for ${pkg.minGuests} to ${pkg.maxGuests} ${pkg.kids ? "children" : "guests"}.`);
  if (input.preferredDate <= addDays(todayInBusinessTz(nowOf(deps)), 6)) throw new OrderError("Please choose a date at least a week away.");
  const r = await deps.repo.createPrivateRequest({
    id: randomUUID(),
    reference: newReference("PVT"),
    packageKey: pkg.key,
    packageName: pkg.name,
    guests: input.guests,
    perPersonCents: pkg.perPersonCents,
    depositCents: est.depositCents,
    estimateCents: est.totalCents,
    preferredDate: input.preferredDate,
    preferredTime: input.preferredTime,
    occasion: input.occasion,
    contactName: input.customerName,
    email: input.email,
    phone: input.phone,
    notes: input.notes,
  });
  await sendSafely(deps.mailer, privateReceivedEmail(r));
  const to = adminEmail();
  if (to) await sendSafely(deps.mailer, privateAlertEmail(r, `${deps.baseUrl}/admin/classes/private`, to));
  return r;
}

export async function acceptPrivate(deps: LightDeps, id: string): Promise<void> {
  const r = await deps.repo.getPrivateRequest(id);
  if (!r) throw new OrderError("Request not found.", 404);
  const token = randomToken();
  if (!(await deps.repo.setPrivateStatus(id, "accepted", "requested", hashToken(token)))) throw new OrderError("This request has already been answered.", 409);
  await sendSafely(deps.mailer, privateAcceptedEmail(r, privatePayLink(deps.baseUrl, token)));
}

export async function declinePrivate(deps: LightDeps, id: string): Promise<void> {
  const r = await deps.repo.getPrivateRequest(id);
  if (!r) throw new OrderError("Request not found.", 404);
  if (!(await deps.repo.setPrivateStatus(id, "declined", "requested"))) throw new OrderError("This request has already been answered.", 409);
  await sendSafely(deps.mailer, privateDeclinedEmail(r));
}

export async function privateFromPayToken(repo: Repository, token: string): Promise<PrivateRequest | null> {
  if (!looksLikeToken(token)) return null;
  return repo.getPrivateRequestByPayHash(hashToken(token));
}

export async function startPrivateDeposit(deps: Deps, r: PrivateRequest, token: string): Promise<string> {
  if (r.status !== "accepted") throw new OrderError(r.status === "paid" ? "The deposit is already paid. Thank you!" : "This request isn't ready for payment.");
  const link = privatePayLink(deps.baseUrl, token);
  const checkout = await deps.payments.createCheckout({
    targetId: r.id,
    reference: r.reference,
    kind: "private_deposit",
    amountCents: r.depositCents,
    description: `${BUSINESS.name}: private ${r.packageName} class deposit`,
    customerEmail: r.email,
    successUrl: `${link}?paid=1`,
    cancelUrl: link,
  });
  await deps.repo.createPayment({ orderId: null, boxOrderId: null, voucherId: null, privateRequestId: r.id, kind: "private_deposit", amountCents: r.depositCents, stripeSessionId: checkout.id });
  return checkout.url;
}

export async function onPrivatePaid(deps: LightDeps, r: PrivateRequest): Promise<void> {
  await sendSafely(deps.mailer, privatePaidEmail(r));
}
