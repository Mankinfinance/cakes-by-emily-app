// Calendar data shared by orders, date changes and the waitlist.

import { buildLoad, dateStatus, slotsFor, type CalendarContext } from "../domain/availability";
import { addDays, monthDays, todayInBusinessTz } from "../domain/dates";
import type { BookingQuery, Repository } from "../data/repository";

export async function calendarContext(repo: Repository, now = new Date(), query?: BookingQuery): Promise<CalendarContext> {
  const today = todayInBusinessTz(now);
  const [settings, daysOff, peakDates] = await Promise.all([repo.getSettings(), repo.listDaysOff(), repo.listPeakDates()]);
  // Weekly caps look back up to 6 days, so load a little either side of the horizon.
  const bookings = await repo.listActiveBookings(addDays(today, -7), addDays(today, settings.bookingHorizonDays + 7), query);
  return { today, settings, daysOff, peakDates, load: buildLoad(bookings) };
}

export async function monthAvailability(repo: Repository, month: string, now = new Date()) {
  const ctx = await calendarContext(repo, now);
  return {
    today: ctx.today,
    days: monthDays(month).map((date) => {
      const s = dateStatus(date, ctx);
      return {
        date,
        state: s.state,
        bookable: s.bookable,
        isRush: s.isRush,
        label: s.label,
        peakSurchargeCents: s.peak?.surchargeCents ?? 0,
        peakLabel: s.peak?.label ?? null,
      };
    }),
  };
}

export async function slotAvailability(repo: Repository, date: string, now = new Date(), query?: BookingQuery) {
  const ctx = await calendarContext(repo, now, query);
  const status = dateStatus(date, ctx);
  return {
    status: status.state,
    bookable: status.bookable,
    isRush: status.isRush,
    peakSurchargeCents: status.peak?.surchargeCents ?? 0,
    slots: status.bookable ? slotsFor(date, ctx).filter((s) => s.time) : [],
  };
}
