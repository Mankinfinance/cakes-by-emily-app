// Seasonal boxes: limited pre-order treats with a cap and a closing date.

import { daysBetween } from "./dates";
import type { SeasonalBox } from "./types";

export type BoxState = "not_open" | "open" | "sold_out" | "closed";

export interface BoxStatus {
  state: BoxState;
  remaining: number;
  /** Days until it opens (not_open) or closes (open). */
  daysLeft: number;
  label: string;
}

export function boxStatus(box: SeasonalBox, today: string): BoxStatus {
  const remaining = Math.max(0, box.cap - box.sold);
  if (today < box.opensOn) {
    const d = daysBetween(today, box.opensOn);
    return { state: "not_open", remaining, daysLeft: d, label: d === 1 ? "Opens tomorrow" : `Opens in ${d} days` };
  }
  if (today > box.closesOn) return { state: "closed", remaining, daysLeft: 0, label: "Pre-orders closed" };
  if (remaining === 0) return { state: "sold_out", remaining, daysLeft: 0, label: "Sold out" };
  const d = daysBetween(today, box.closesOn);
  return { state: "open", remaining, daysLeft: d, label: d === 0 ? "Closes today" : d === 1 ? "Closes tomorrow" : `Closes in ${d} days` };
}

export function boxOrderable(box: SeasonalBox, today: string): boolean {
  return box.visible && boxStatus(box, today).state === "open";
}

/** Pickup must fall inside the box's pickup window and not be in the past. */
export function boxPickupOk(box: SeasonalBox, date: string, today: string): boolean {
  return date > today && date >= box.pickupFrom && date <= box.pickupTo;
}

export const MAX_BOXES_PER_ORDER = 10;
