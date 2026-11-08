// The sales snapshot for /admin/snapshot. Money and counts come from the
// database (sales_summary in SQL on Supabase); the rest is built from the
// same data the rest of the admin uses.

import { boxStatus } from "../domain/boxes";
import { addDays, todayInBusinessTz, weekStart } from "../domain/dates";
import { balanceOwing } from "../domain/pricing";
import { monthRange, previousMonth, type SalesSummary } from "../domain/snapshot";
import type { Repository } from "../data/repository";

export interface Snapshot {
  month: string;
  thisMonth: SalesSummary;
  lastMonth: SalesSummary;
  balances: { id: string; reference: string; name: string; pickupDate: string; owingCents: number }[];
  balancesTotalCents: number;
  capacity: { weekOf: string; booked: number; cap: number }[];
  boxes: { name: string; sold: number; cap: number; state: string }[];
  giftOutstandingCents: number;
  creditOutstandingCents: number;
}

export async function buildSnapshot(repo: Repository, now = new Date()): Promise<Snapshot> {
  const today = todayInBusinessTz(now);
  const month = today.slice(0, 7);
  const last = previousMonth(month);
  const firstWeek = weekStart(today);
  const [thisMonth, lastMonth, orders, settings, bookings, boxes, vouchers] = await Promise.all([
    repo.salesSummary(monthRange(month).from, monthRange(month).to),
    repo.salesSummary(monthRange(last).from, monthRange(last).to),
    repo.listOrders(),
    repo.getSettings(),
    repo.listActiveBookings(firstWeek, addDays(firstWeek, 27)),
    repo.listBoxes(),
    repo.listVouchers(),
  ]);

  const balances = orders
    .filter((o) => o.stage !== "cancelled" && o.stage !== "collected" && o.stage !== "awaiting_payment" && balanceOwing(o) > 0)
    .map((o) => ({ id: o.id, reference: o.reference, name: o.customerName, pickupDate: o.pickupDate, owingCents: balanceOwing(o) }))
    .sort((a, b) => a.pickupDate.localeCompare(b.pickupDate));

  const capacity = [0, 1, 2, 3].map((i) => {
    const from = addDays(firstWeek, i * 7);
    const to = addDays(from, 6);
    return { weekOf: from, booked: bookings.filter((b) => b.pickupSlot && b.pickupDate >= from && b.pickupDate <= to).length, cap: settings.weeklyCap };
  });

  const live = vouchers.filter((v) => v.status === "active" && v.expiresOn >= today);
  return {
    month,
    thisMonth,
    lastMonth,
    balances,
    balancesTotalCents: balances.reduce((s, b) => s + b.owingCents, 0),
    capacity,
    boxes: boxes.map((b) => ({ name: b.name, sold: b.sold, cap: b.cap, state: boxStatus(b, today).label })),
    giftOutstandingCents: live.filter((v) => v.kind === "gift").reduce((s, v) => s + v.balanceCents, 0),
    creditOutstandingCents: live.filter((v) => v.kind === "credit").reduce((s, v) => s + v.balanceCents, 0),
  };
}
