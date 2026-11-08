// The sales snapshot. The Supabase adapter computes the money and counts in
// SQL (see the phase 3 migration's sales_summary function); the memory
// adapter uses summarise() below. A unit test runs both on the same data and
// checks they agree.

import type { Order, Payment } from "./types";

export interface Ranked {
  name: string;
  count: number;
}

export interface SalesSummary {
  orders: number;
  revenueCents: number;
  depositsCents: number;
  averageCents: number;
  topFlavours: Ranked[];
  topFinishes: Ranked[];
  topOccasions: Ranked[];
}

const counted = (o: Pick<Order, "stage">) => o.stage !== "awaiting_payment" && o.stage !== "cancelled";

function top(orders: Order[], category: string, limit = 5): Ranked[] {
  const counts = new Map<string, number>();
  for (const o of orders) for (const i of o.items) if (i.category === category) counts.set(i.name, (counts.get(i.name) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Orders booked (created) between `from` and `to` inclusive, Sydney dates. */
export function summarise(orders: Order[], payments: Payment[], from: string, to: string, createdDate: (iso: string) => string): SalesSummary {
  const inRange = orders.filter((o) => counted(o) && createdDate(o.createdAt) >= from && createdDate(o.createdAt) <= to);
  const revenue = inRange.reduce((s, o) => s + o.totalCents, 0);
  const deposits = payments
    .filter((p) => p.status === "paid" && p.kind === "deposit" && createdDate(p.createdAt) >= from && createdDate(p.createdAt) <= to)
    .reduce((s, p) => s + p.amountCents, 0);
  return {
    orders: inRange.length,
    revenueCents: revenue,
    depositsCents: deposits,
    averageCents: inRange.length ? Math.round(revenue / inRange.length) : 0,
    topFlavours: top(inRange, "flavour"),
    topFinishes: top(inRange, "finish"),
    topOccasions: top(inRange, "occasion"),
  };
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}
