// Fewer guests for a private class after the deposit is paid.
//
// Unpaid places go first (empty places, then guests who added details but
// haven't paid). Only Emily can remove guests who have already paid: what
// they paid is refunded or turned into credit under the class terms (or in
// full, if she waives the terms). The deposit stays with the booking. The
// total is worked out again for the new number of guests, and the places
// still to pay share what's left. If what's already in (deposit plus paid
// shares) is more than the new total, the organiser gets the difference
// back under the same terms.

import { shareAmounts } from "./split";
import type { PrivateGuest, PrivateRequest } from "./types";

export type ReduceWindow = "full" | "credit" | "none";

export interface RemovedPaidShare {
  id: string;
  name: string;
  email: string;
  /** Money this guest paid by card (the share less any voucher or pass used). */
  cashCents: number;
  refundCents: number;
  creditCents: number;
  keptCents: number;
  returnVoucher: boolean;
  returnPass: boolean;
}

export interface ReduceQuote {
  ok: boolean;
  problem: string | null;
  window: ReduceWindow;
  waived: boolean;
  from: number;
  to: number;
  minGuests: number;
  newTotalCents: number;
  removeOpenIds: string[];
  removePaid: RemovedPaidShare[];
  removedNames: string[];
  /** New amounts for the places still to pay. */
  shareUpdates: { id: string; shareCents: number }[];
  /** Places still to pay whose new share is fully covered (marked paid with nothing to pay). */
  freeIds: string[];
  organiser: { excessCents: number; refundCents: number; creditCents: number; keptCents: number };
  refundCents: number;
  creditCents: number;
  keptCents: number;
  /** Removed places that had a voucher or pass applied (given back). */
  vouchersToReturn: number;
  passesToReturn: number;
  summary: string;
}

const aud = (c: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
const guestLabel = (g: Pick<PrivateGuest, "name" | "slot">) => g.name || `Guest ${g.slot}`;

export function reduceWindow(daysOut: number, s: { classFullRefundDays: number; classCreditDays: number }, waived: boolean): ReduceWindow {
  if (waived) return "full";
  return daysOut >= s.classFullRefundDays ? "full" : daysOut >= s.classCreditDays ? "credit" : "none";
}

function split(cents: number, window: ReduceWindow) {
  return { refundCents: window === "full" ? cents : 0, creditCents: window === "credit" ? cents : 0, keptCents: window === "none" ? cents : 0 };
}

const isHeld = (g: Pick<PrivateGuest, "status" | "holdKey" | "holdUntil">, nowIso: string) => g.status === "open" && !!g.holdKey && !!g.holdUntil && g.holdUntil > nowIso;
const codes = (g: Pick<PrivateGuest, "voucherAppliedCents" | "passAppliedCents">) => (g.voucherAppliedCents ?? 0) + (g.passAppliedCents ?? 0);

export function reduceGuestsQuote(
  r: Pick<PrivateRequest, "status" | "guests" | "perPersonCents" | "depositCents">,
  allGuests: PrivateGuest[],
  newCount: number,
  minGuests: number,
  s: { classFullRefundDays: number; classCreditDays: number },
  daysOut: number,
  opts: { by: "emily" | "organiser"; waive?: boolean; nowIso: string },
): ReduceQuote {
  const guests = allGuests.filter((g) => g.status !== "removed");
  const waived = opts.by === "emily" && !!opts.waive;
  const window = reduceWindow(daysOut, s, waived);
  const from = r.guests;
  const base: ReduceQuote = {
    ok: false,
    problem: null,
    window,
    waived,
    from,
    to: newCount,
    minGuests,
    newTotalCents: newCount * r.perPersonCents,
    removeOpenIds: [],
    removePaid: [],
    removedNames: [],
    shareUpdates: [],
    freeIds: [],
    organiser: { excessCents: 0, refundCents: 0, creditCents: 0, keptCents: 0 },
    refundCents: 0,
    creditCents: 0,
    keptCents: 0,
    vouchersToReturn: 0,
    passesToReturn: 0,
    summary: "",
  };
  const fail = (problem: string) => ({ ...base, problem });

  if (r.status !== "paid") return fail("Guest numbers can only be changed once the deposit is paid.");
  if (!Number.isInteger(newCount)) return fail("Choose a whole number of guests.");
  if (newCount >= from) return fail(`Choose fewer than ${from} guests.`);
  if (newCount < minGuests) return fail(`This package needs at least ${minGuests} guests.`);
  if (daysOut < 1) return fail("Guest numbers can't be changed on the day of the class.");
  if (guests.length !== from) return fail("The guest list doesn't match the booking. Please reload and try again.");
  if (guests.some((g) => isHeld(g, opts.nowIso))) return fail("A guest is paying right now. Please try again in 15 minutes.");

  const k = from - newCount;
  // Unpaid first: empty places, then places without codes, then highest place number.
  const open = guests
    .filter((g) => g.status === "open")
    .sort((a, b) => Number(!!a.name) - Number(!!b.name) || Number(codes(a) > 0) - Number(codes(b) > 0) || b.slot - a.slot);
  const removeOpen = open.slice(0, Math.min(k, open.length));
  const paidToRemove = k - removeOpen.length;
  if (paidToRemove > 0 && opts.by === "organiser") {
    return fail(
      `${paidToRemove === 1 ? "1 guest who has" : `${paidToRemove} guests who have`} already paid would need to come off. Please message Emily to change paid places.`,
    );
  }
  const paid = guests.filter((g) => g.status === "paid").sort((a, b) => b.slot - a.slot);
  const removePaidGuests = paid.slice(0, paidToRemove);

  const removePaid: RemovedPaidShare[] = removePaidGuests.map((g) => {
    const cash = Math.max(0, g.shareCents - codes(g));
    return {
      id: g.id,
      name: guestLabel(g),
      email: g.email,
      cashCents: cash,
      ...split(cash, window),
      returnVoucher: !!g.voucherId && (g.voucherAppliedCents ?? 0) > 0,
      // Pass credits come back unless the place is cancelled inside the no-refund window.
      returnPass: !!g.passId && (g.passAppliedCents ?? 0) > 0 && window !== "none",
    };
  });

  const removed = new Set([...removeOpen.map((g) => g.id), ...removePaidGuests.map((g) => g.id)]);
  const remainingPaid = guests.filter((g) => g.status === "paid" && !removed.has(g.id));
  const remainingOpen = guests.filter((g) => g.status === "open" && !removed.has(g.id)).sort((a, b) => a.slot - b.slot);
  const newTotal = newCount * r.perPersonCents;
  const paidIn = r.depositCents + remainingPaid.reduce((sum, g) => sum + g.shareCents, 0);
  const owed = newTotal - paidIn;

  const shareUpdates: { id: string; shareCents: number }[] = [];
  const freeIds: string[] = [];
  if (remainingOpen.length > 0) {
    const amounts = owed > 0 ? shareAmounts(owed, 0, remainingOpen.length) : remainingOpen.map(() => 0);
    for (const [i, g] of remainingOpen.entries()) {
      if (codes(g) > amounts[i]) return fail(`${guestLabel(g)} has a voucher or pass worth more than their new share. Please message Emily.`);
      shareUpdates.push({ id: g.id, shareCents: amounts[i] });
      if (amounts[i] - codes(g) === 0) freeIds.push(g.id);
    }
  }
  const excess = Math.max(0, -owed);
  const organiser = { excessCents: excess, ...split(excess, window) };

  const refund = removePaid.reduce((s2, p) => s2 + p.refundCents, 0) + organiser.refundCents;
  const credit = removePaid.reduce((s2, p) => s2 + p.creditCents, 0) + organiser.creditCents;
  const kept = removePaid.reduce((s2, p) => s2 + p.keptCents, 0) + organiser.keptCents;
  const vouchersToReturn = removeOpen.filter((g) => !!g.voucherId).length + removePaid.filter((p) => p.returnVoucher).length;
  const passesToReturn = removeOpen.filter((g) => !!g.passId).length + removePaid.filter((p) => p.returnPass).length;
  const removedNames = [...removeOpen.map(guestLabel), ...removePaid.map((p) => p.name)];

  const parts: string[] = [];
  for (const p of removePaid) {
    if (p.refundCents) parts.push(`${p.name} gets ${aud(p.refundCents)} refunded`);
    if (p.creditCents) parts.push(`${p.name} gets ${aud(p.creditCents)} as credit`);
    if (p.keptCents) parts.push(`${p.name}'s ${aud(p.keptCents)} isn't refundable this close to the class`);
  }
  if (organiser.refundCents) parts.push(`the organiser gets ${aud(organiser.refundCents)} refunded`);
  if (organiser.creditCents) parts.push(`the organiser gets ${aud(organiser.creditCents)} as credit`);
  if (organiser.keptCents) parts.push(`${aud(organiser.keptCents)} paid over the new total isn't refundable this close to the class`);
  const each = shareUpdates.filter((u) => !freeIds.includes(u.id));
  const summary =
    `Going from ${from} to ${newCount} guests (removing ${removedNames.join(", ")}). The new total is ${aud(newTotal)}.` +
    (each.length ? ` ${each.length === 1 ? "The place still to pay is now" : `The ${each.length} places still to pay are now`} ${aud(each[each.length - 1].shareCents)}${each.length > 1 ? " each" : ""}.` : "") +
    (parts.length ? ` ${parts.join("; ")}.` : "") +
    (vouchersToReturn ? ` ${vouchersToReturn === 1 ? "A voucher" : `${vouchersToReturn} vouchers`} used on removed places come back.` : "") +
    (passesToReturn ? ` ${passesToReturn === 1 ? "A class pass credit comes" : `${passesToReturn} class pass credits come`} back.` : "") +
    (waived ? " Emily waived the terms, so paid places are refunded in full." : "");

  return {
    ...base,
    ok: true,
    newTotalCents: newTotal,
    removeOpenIds: removeOpen.map((g) => g.id),
    removePaid,
    removedNames,
    shareUpdates,
    freeIds,
    organiser,
    refundCents: refund,
    creditCents: credit,
    keptCents: kept,
    vouchersToReturn,
    passesToReturn,
    summary,
  };
}
