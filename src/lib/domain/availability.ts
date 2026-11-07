// Booking calendar rules: notice period, rush orders, capacity, days off,
// peak dates and 30-minute pickup slots.

import {
  addDays,
  daysBetween,
  minutesToTime,
  timeToMinutes,
  weekStart,
  weekday,
} from "./dates";
import type { DayOff, PeakDate, Settings } from "./types";

/** Booked cakes (not cancelled) used to work out capacity. */
export interface BookingLoad {
  /** Cakes booked per date. */
  perDate: Record<string, number>;
  /** Cakes booked per "date|HH:MM" slot. */
  perSlot: Record<string, number>;
}

export type DateState =
  | "past"
  | "too_soon"
  | "closed"
  | "day_off"
  | "full"
  | "beyond_horizon"
  | "rush"
  | "available";

export interface DateStatus {
  date: string;
  state: DateState;
  bookable: boolean;
  isRush: boolean;
  peak: PeakDate | null;
  label: string;
}

export interface CalendarContext {
  today: string;
  settings: Settings;
  daysOff: DayOff[];
  peakDates: PeakDate[];
  load: BookingLoad;
}

export function weekLoad(load: BookingLoad, date: string): number {
  const start = weekStart(date);
  let total = 0;
  for (let i = 0; i < 7; i++) total += load.perDate[addDays(start, i)] ?? 0;
  return total;
}

export function dateStatus(date: string, ctx: CalendarContext): DateStatus {
  const { settings, today } = ctx;
  const peak = ctx.peakDates.find((p) => p.date === date) ?? null;
  const daysOut = daysBetween(today, date);
  const base = { date, peak, isRush: false };

  if (daysOut <= 0) return { ...base, state: "past", bookable: false, label: "Unavailable" };
  if (daysOut > settings.bookingHorizonDays) {
    return { ...base, state: "beyond_horizon", bookable: false, label: "Not open yet" };
  }
  const dayOff = ctx.daysOff.find((d) => d.date === date);
  if (dayOff) return { ...base, state: "day_off", bookable: false, label: "Closed" };
  if (settings.closedWeekdays.includes(weekday(date))) {
    return { ...base, state: "closed", bookable: false, label: "Closed" };
  }

  const dayCount = ctx.load.perDate[date] ?? 0;
  const full = dayCount >= settings.dailyCap || weekLoad(ctx.load, date) >= settings.weeklyCap;
  const hasSlot = slotsFor(date, ctx).some((s) => s.available);
  if (full || !hasSlot) return { ...base, state: "full", bookable: false, label: "Fully booked" };

  if (daysOut < settings.minNoticeDays) {
    if (settings.rushEnabled && daysOut >= settings.rushMinDays) {
      return { ...base, state: "rush", bookable: true, isRush: true, label: "Rush order" };
    }
    return { ...base, state: "too_soon", bookable: false, label: "Inside notice period" };
  }
  return { ...base, state: "available", bookable: true, label: peak ? peak.label : "Available" };
}

export interface Slot {
  time: string; // HH:MM
  remaining: number;
  available: boolean;
}

export function slotTimes(settings: Settings): string[] {
  const start = timeToMinutes(settings.pickupStart);
  const end = timeToMinutes(settings.pickupEnd);
  const out: string[] = [];
  for (let t = start; t + settings.slotMinutes <= end; t += settings.slotMinutes) {
    out.push(minutesToTime(t));
  }
  return out;
}

export function slotsFor(date: string, ctx: Pick<CalendarContext, "settings" | "load">): Slot[] {
  return slotTimes(ctx.settings).map((time) => {
    const used = ctx.load.perSlot[`${date}|${time}`] ?? 0;
    const remaining = Math.max(0, ctx.settings.slotCap - used);
    return { time, remaining, available: remaining > 0 };
  });
}

export type BookingCheck =
  | { ok: true; status: DateStatus }
  | { ok: false; reason: string };

/** Server-side check before an order is accepted. */
export function checkBooking(date: string, slot: string, ctx: CalendarContext): BookingCheck {
  const status = dateStatus(date, ctx);
  if (!status.bookable) return { ok: false, reason: `That date is not available (${status.label}).` };
  const s = slotsFor(date, ctx).find((x) => x.time === slot);
  if (!s) return { ok: false, reason: "Please choose a pickup time." };
  if (!s.available) return { ok: false, reason: "That pickup time is full. Please choose another." };
  return { ok: true, status };
}

export function emptyLoad(): BookingLoad {
  return { perDate: {}, perSlot: {} };
}

export function buildLoad(orders: { pickupDate: string; pickupSlot: string }[]): BookingLoad {
  const load = emptyLoad();
  for (const o of orders) {
    load.perDate[o.pickupDate] = (load.perDate[o.pickupDate] ?? 0) + 1;
    const key = `${o.pickupDate}|${o.pickupSlot}`;
    load.perSlot[key] = (load.perSlot[key] ?? 0) + 1;
  }
  return load;
}
