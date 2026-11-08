// The kitchen sheet: what to make, in bake order, with allergies up front.

import { addDays, weekStart } from "./dates";
import { DIETARY_FILTERS, type BoxOrder, type CorporateOrder, type Order } from "./types";

export interface KitchenCake {
  kind: "cake";
  id: string;
  reference: string;
  time: string;
  customerFirstName: string;
  size: string;
  flavour: string;
  finish: string;
  colour: string;
  decorations: string[];
  extras: string[];
  topperText: string;
  allergyNotes: string;
  dietary: string[];
  /** Don't photograph or post this cake. */
  noPhotos: boolean;
  done: boolean;
}

export interface KitchenBox {
  kind: "box";
  id: string;
  reference: string;
  time: string;
  customerFirstName: string;
  name: string;
  quantity: number;
  done: boolean;
}

export interface KitchenCorporate {
  kind: "corporate";
  id: string;
  reference: string;
  time: string;
  customerFirstName: string;
  company: string;
  name: string;
  hasLogo: boolean;
  notes: string;
  done: boolean;
}

export type KitchenLine = KitchenCake | KitchenBox | KitchenCorporate;

export interface KitchenDay {
  date: string;
  lines: KitchenLine[];
}

export function kitchenRange(view: "day" | "week", date: string): { from: string; to: string } {
  if (view === "day") return { from: date, to: date };
  const from = weekStart(date);
  return { from, to: addDays(from, 6) };
}

const named = (o: Order, cat: string) => o.items.filter((i) => i.category === cat).map((i) => i.name);

export function kitchenSheet(orders: Order[], boxes: BoxOrder[], from: string, to: string, corporate: CorporateOrder[] = []): KitchenDay[] {
  const lines: (KitchenLine & { date: string })[] = [];
  for (const o of orders) {
    if (o.stage === "cancelled" || o.stage === "awaiting_payment") continue;
    if (o.pickupDate < from || o.pickupDate > to) continue;
    lines.push({
      kind: "cake",
      date: o.pickupDate,
      id: o.id,
      reference: o.reference,
      time: o.pickupSlot,
      customerFirstName: o.customerName.split(" ")[0],
      size: named(o, "size")[0] ?? "",
      flavour: named(o, "flavour")[0] ?? "",
      finish: named(o, "finish")[0] ?? "",
      colour: named(o, "colour")[0] ?? "",
      decorations: named(o, "decoration"),
      extras: named(o, "extra"),
      topperText: o.config.topperText,
      allergyNotes: o.allergyNotes,
      dietary: o.dietary.map((d) => DIETARY_FILTERS[d]?.label ?? d),
      noPhotos: !!o.photoOptOut,
      done: o.kitchenDone,
    });
  }
  for (const b of boxes) {
    if (b.status !== "paid" && b.status !== "collected") continue;
    if (b.pickupDate < from || b.pickupDate > to) continue;
    lines.push({
      kind: "box",
      date: b.pickupDate,
      id: b.id,
      reference: b.reference,
      time: b.pickupSlot,
      customerFirstName: b.customerName.split(" ")[0],
      name: b.boxName,
      quantity: b.quantity,
      done: b.kitchenDone,
    });
  }
  for (const c of corporate) {
    if (c.status === "awaiting_payment" || c.status === "cancelled") continue;
    if (c.pickupDate < from || c.pickupDate > to) continue;
    lines.push({
      kind: "corporate",
      date: c.pickupDate,
      id: c.id,
      reference: c.reference,
      time: c.pickupSlot,
      customerFirstName: c.contactName.split(" ")[0],
      company: c.companyName,
      name: c.packageName,
      hasLogo: Boolean(c.logoPath),
      notes: c.notes,
      done: c.kitchenDone,
    });
  }
  lines.sort((a, b) => (a.date + a.time + a.reference).localeCompare(b.date + b.time + b.reference));
  const days: KitchenDay[] = [];
  for (const l of lines) {
    const { date, ...line } = l;
    let day = days.find((d) => d.date === date);
    if (!day) days.push((day = { date, lines: [] }));
    day.lines.push(line as KitchenLine);
  }
  return days;
}
