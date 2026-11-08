// Cake and Sip classes: pricing, seats, recurring sessions, private group
// estimates and calendar (.ics) tickets.

import { addDays, formatDateLong, formatTime12, timeToMinutes, weekday } from "./dates";
import type { ClassSession, ClassType, PrivatePackage } from "./types";

export const MAX_SEATS_PER_BOOKING = 6;

export interface ClassPrice {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

/** Price for a class booking, with the group discount at enough seats. */
export function classPrice(unitCents: number, seats: number, s: { groupDiscountMinSeats: number; groupDiscountPercent: number }): ClassPrice {
  const subtotal = unitCents * seats;
  const discount = seats >= s.groupDiscountMinSeats ? Math.round((subtotal * s.groupDiscountPercent) / 100) : 0;
  return { subtotalCents: subtotal, discountCents: discount, totalCents: subtotal - discount };
}

export function seatsLeft(session: Pick<ClassSession, "seats" | "booked">): number {
  return Math.max(0, session.seats - session.booked);
}

/** A class that is still short of its minimum numbers. */
export function belowMinimum(session: Pick<ClassSession, "booked" | "status">, type: Pick<ClassType, "minGuests">): boolean {
  return session.status === "scheduled" && session.booked < type.minGuests;
}

/** The last day to decide whether a below-minimum class runs (5 days before). */
export function decideBy(date: string): string {
  return addDays(date, -5);
}

/**
 * Dates for a recurring series: every `everyDays` days from `start`, `count`
 * times, skipping dates in `skip` (days off) and closed weekdays.
 */
export function recurringDates(start: string, everyDays: number, count: number, skip: Set<string>, closedWeekdays: number[]): { date: string; skipped: boolean }[] {
  const out: { date: string; skipped: boolean }[] = [];
  let d = start;
  for (let i = 0; i < count; i++) {
    out.push({ date: d, skipped: skip.has(d) || closedWeekdays.includes(weekday(d)) });
    d = addDays(d, everyDays);
  }
  return out;
}

export function privateEstimate(pkg: PrivatePackage, guests: number): { totalCents: number; depositCents: number; ok: boolean } {
  const ok = guests >= pkg.minGuests && guests <= pkg.maxGuests;
  return { totalCents: pkg.perPersonCents * guests, depositCents: pkg.depositCents, ok };
}

export function sessionLabel(s: Pick<ClassSession, "date" | "startTime">): string {
  return `${formatDateLong(s.date)} at ${formatTime12(s.startTime)}`;
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** A calendar file for a booked class, in Sydney time. */
export function classIcs(opts: { uid: string; title: string; date: string; startTime: string; durationMinutes: number; location: string; description: string; stamp: Date }): string {
  const start = timeToMinutes(opts.startTime);
  const end = start + opts.durationMinutes;
  const ymd = opts.date.replace(/-/g, "");
  const endDate = end >= 24 * 60 ? addDays(opts.date, 1).replace(/-/g, "") : ymd;
  const hm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}00`;
  const dtstamp = opts.stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cakes by Emily//Classes//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=Australia/Sydney:${ymd}T${hm(start)}`,
    `DTEND;TZID=Australia/Sydney:${endDate}T${hm(end)}`,
    `SUMMARY:${icsEscape(opts.title)}`,
    `LOCATION:${icsEscape(opts.location)}`,
    `DESCRIPTION:${icsEscape(opts.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

// Phase 4 ---------------------------------------------------------------------

/**
 * Price with class pass credits. Each credit covers one seat. The group
 * discount still depends on the total seats, and applies to the seats being
 * paid for.
 */
export function classPriceWithPass(
  unitCents: number,
  seats: number,
  credits: number,
  s: { groupDiscountMinSeats: number; groupDiscountPercent: number },
): ClassPrice & { creditsUsed: number } {
  const used = Math.max(0, Math.min(seats, credits));
  const paidSeats = seats - used;
  const subtotal = unitCents * paidSeats;
  const discount = seats >= s.groupDiscountMinSeats ? Math.round((subtotal * s.groupDiscountPercent) / 100) : 0;
  return { subtotalCents: subtotal, discountCents: discount, totalCents: subtotal - discount, creditsUsed: used };
}

export type ClassCancelWindow = "full" | "credit" | "none" | "emily";

export interface ClassCancelOutcome {
  window: ClassCancelWindow;
  refundCents: number;
  creditCents: number;
  keptCents: number;
  voucherReturnedCents: number;
  passCreditsReturned: number;
  summary: string;
}

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);
const aud = (c: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);

/** What happens to the money (and pass credits) when a class booking is cancelled. */
export function classCancellationOutcome(
  b: { amountPaidCents: number; voucherAppliedCents?: number; passCredits?: number },
  s: { classFullRefundDays: number; classCreditDays: number },
  daysOut: number,
  by: "customer" | "emily" = "customer",
): ClassCancelOutcome {
  const cash = Math.max(0, b.amountPaidCents);
  const voucher = Math.max(0, b.voucherAppliedCents ?? 0);
  const credits = Math.max(0, b.passCredits ?? 0);
  const extras =
    (voucher ? ` The ${aud(voucher)} voucher or credit you used comes back as credit.` : "") +
    (credits ? ` Your ${credits} class pass ${credits === 1 ? "credit comes" : "credits come"} back.` : "");
  if (by === "emily") {
    return { window: "emily", refundCents: cash, creditCents: 0, keptCents: 0, voucherReturnedCents: voucher, passCreditsReturned: credits, summary: `Emily cancelled this booking, so everything paid (${aud(cash)}) is refunded.${extras}` };
  }
  const when = `Today is ${days(daysOut)} before the class.`;
  if (daysOut >= s.classFullRefundDays) {
    return { window: "full", refundCents: cash, creditCents: 0, keptCents: 0, voucherReturnedCents: voucher, passCreditsReturned: credits, summary: `${when} If you cancel, you'll get ${aud(cash)} back.${extras}` };
  }
  if (daysOut >= s.classCreditDays) {
    return { window: "credit", refundCents: 0, creditCents: cash, keptCents: 0, voucherReturnedCents: voucher, passCreditsReturned: credits, summary: `${when} If you cancel, the ${aud(cash)} you paid becomes credit.${extras}` };
  }
  return {
    window: "none",
    refundCents: 0,
    creditCents: 0,
    keptCents: cash,
    voucherReturnedCents: voucher,
    passCreditsReturned: 0,
    summary: `${when} Cancellations inside ${days(s.classCreditDays)} are not refundable, and class pass credits aren't returned.${voucher ? ` The ${aud(voucher)} voucher or credit you used still comes back as credit.` : ""}`,
  };
}
