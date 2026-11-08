// Automatic messages: which are due today, and the timeline shown on the
// customer's order page. Pure functions; sending and the "already sent"
// record live in the services and the database.

import { addDays, daysBetween } from "./dates";
import { balanceOwing } from "./pricing";
import type { Automation, AutomationKey, Order } from "./types";

export const AUTOMATION_INFO: Record<AutomationKey, { label: string; help: string; daysLabel: string | null }> = {
  order_received: { label: "Order received", help: "Sent when the deposit is paid.", daysLabel: null },
  design_confirmed: { label: "Design confirmed", help: "Sent when the design is approved or confirmed.", daysLabel: null },
  balance_reminder: { label: "Balance reminder", help: "Sent if a balance is still owing.", daysLabel: "days before pickup" },
  pickup_details: { label: "Pickup details", help: "Pickup address, parking and cake care.", daysLabel: "days before pickup" },
  thank_you: { label: "Thank you and review request", help: "Sent after collection, with the review link.", daysLabel: "days after pickup" },
  rebook_reminder: { label: "Birthday reminder for next year", help: "Only for birthday orders where the customer asked for it.", daysLabel: "days after pickup" },
  stand_return: { label: "Cake stand return reminder", help: "Only for orders that hired a stand (with a bond).", daysLabel: "days after pickup" },
  class_reminder: { label: "Class reminder", help: "What to bring, start time and parking, for class guests.", daysLabel: "days before the class" },
  class_thank_you: { label: "Class thank you and review request", help: "Sent to class bookers after the class.", daysLabel: "days after the class" },
};

export const DEFAULT_AUTOMATIONS: Automation[] = [
  { key: "order_received", enabled: true, days: 0 },
  { key: "design_confirmed", enabled: true, days: 0 },
  { key: "balance_reminder", enabled: true, days: 4 },
  { key: "pickup_details", enabled: true, days: 1 },
  { key: "thank_you", enabled: true, days: 1 },
  // About 11 months after pickup, so there is time to book the next birthday cake.
  { key: "rebook_reminder", enabled: true, days: 335 },
  { key: "stand_return", enabled: true, days: 3 },
  { key: "class_reminder", enabled: true, days: 1 },
  { key: "class_thank_you", enabled: true, days: 1 },
];

/** Did this order hire something with a bond (a cake stand)? */
export function hasBond(order: Pick<Order, "items">): boolean {
  return order.items.some((i) => i.category === "bond" && i.amountCents > 0);
}

/** Occasions that count as birthdays for the "remind me next year" option. */
export const BIRTHDAY_OCCASIONS = ["occ-birthday", "occ-first-birthday"];

export function isBirthday(order: Pick<Order, "config">): boolean {
  return BIRTHDAY_OCCASIONS.includes(order.config.occasion);
}

export function automationMap(list: Automation[]): Record<AutomationKey, Automation> {
  const out = Object.fromEntries(DEFAULT_AUTOMATIONS.map((a) => [a.key, { ...a }])) as Record<AutomationKey, Automation>;
  for (const a of list) if (out[a.key]) out[a.key] = { ...a };
  return out;
}

type MsgOrder = Pick<
  Order,
  "stage" | "pickupDate" | "createdAt" | "totalCents" | "amountPaidCents" | "voucherAppliedCents" | "config" | "remindNextYear" | "approvedAt"
> &
  Partial<Pick<Order, "items">>;

/** Scheduled daily messages that are due today and not yet sent. */
export function dueScheduledMessages(order: MsgOrder, automations: Automation[], sent: string[], today: string): AutomationKey[] {
  const a = automationMap(automations);
  const due: AutomationKey[] = [];
  const daysOut = daysBetween(today, order.pickupDate);
  const live = order.stage !== "cancelled" && order.stage !== "awaiting_payment";
  if (!live) return due;
  const ok = (k: AutomationKey) => a[k].enabled && !sent.includes(k);

  if (order.stage !== "collected" && daysOut >= 0) {
    if (ok("balance_reminder") && daysOut <= a.balance_reminder.days && balanceOwing(order) > 0) due.push("balance_reminder");
    // Pickup details go out on the day itself (or later in the window) so a missed cron run still sends them.
    if (ok("pickup_details") && daysOut <= a.pickup_details.days) due.push("pickup_details");
  }
  if (order.stage === "collected") {
    const after = -daysOut;
    if (ok("thank_you") && after >= a.thank_you.days) due.push("thank_you");
    if (ok("rebook_reminder") && order.remindNextYear && isBirthday(order) && after >= a.rebook_reminder.days) due.push("rebook_reminder");
    if (ok("stand_return") && hasBond({ items: order.items ?? [] }) && after >= a.stand_return.days) due.push("stand_return");
  }
  return due;
}

export type TimelineStatus = "sent" | "scheduled" | "off" | "not_needed" | "waiting";

export interface TimelineEntry {
  key: AutomationKey;
  label: string;
  status: TimelineStatus;
  /** Planned or sent date (YYYY-MM-DD), when known. */
  date: string | null;
}

/** What the customer receives, for the order page. */
export function messageTimeline(order: MsgOrder, automations: Automation[], sent: { key: string; sentAt: string }[]): TimelineEntry[] {
  const a = automationMap(automations);
  const sentAt = new Map(sent.map((s) => [s.key, s.sentAt.slice(0, 10)]));
  const cancelled = order.stage === "cancelled";
  const entry = (key: AutomationKey, planned: string | null, needed = true): TimelineEntry => {
    const label = AUTOMATION_INFO[key].label;
    if (sentAt.has(key)) return { key, label, status: "sent", date: sentAt.get(key)! };
    if (!a[key].enabled) return { key, label, status: "off", date: null };
    if (!needed || cancelled) return { key, label, status: "not_needed", date: null };
    return { key, label, status: planned ? "scheduled" : "waiting", date: planned };
  };

  const list: TimelineEntry[] = [
    entry("order_received", null),
    entry("design_confirmed", null),
    entry("balance_reminder", addDays(order.pickupDate, -a.balance_reminder.days), balanceOwing(order) > 0),
    entry("pickup_details", addDays(order.pickupDate, -a.pickup_details.days)),
    entry("thank_you", addDays(order.pickupDate, a.thank_you.days)),
  ];
  if (isBirthday(order)) {
    list.push(entry("rebook_reminder", addDays(order.pickupDate, a.rebook_reminder.days), order.remindNextYear));
  }
  if (hasBond({ items: order.items ?? [] })) {
    list.push(entry("stand_return", addDays(order.pickupDate, a.stand_return.days)));
  }
  return list;
}
