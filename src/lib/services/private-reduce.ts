// Lowering a private class's guest numbers after the deposit. Emily can do it
// from the admin at any time before the class. The organiser can do it from
// their page until the shares are due, but only by removing unpaid places.

import { daysBetween, formatDateLong, todayInBusinessTz } from "../domain/dates";
import { formatAud } from "../domain/money";
import { reduceGuestsQuote, type ReduceQuote } from "../domain/private-reduce";
import { shareDueDate } from "../domain/split";
import type { GuestReduction, PrivateRequest } from "../domain/types";
import { adminEmail, nowOf, OrderError, organiserLink, type LightDeps } from "./common";
import { guestRemovedEmail, guestsReducedAlertEmail, guestsReducedEmail, sendSafely } from "./email";
import { refundFromPayments } from "./refunds";
import { giveBackVoucherFor, issueCredit } from "./vouchers";

export interface ReduceOptions {
  by: "emily" | "organiser";
  /** Emily only: refund paid places in full, whatever the terms say. */
  waive?: boolean;
}

/** What lowering the guest numbers would do today (shown before confirming). */
export async function reduceGuestsPreview(
  deps: Pick<LightDeps, "repo" | "now">,
  r: PrivateRequest,
  newCount: number,
  opts: ReduceOptions,
): Promise<{ daysOut: number; quote: ReduceQuote }> {
  const settings = await deps.repo.getSettings();
  const guests = await deps.repo.listGuests(r.id);
  const now = nowOf(deps);
  const today = todayInBusinessTz(now);
  const daysOut = daysBetween(today, r.preferredDate);
  const minGuests = settings.privatePackages.find((p) => p.key === r.packageKey)?.minGuests ?? 1;
  const quote = reduceGuestsQuote(r, guests, newCount, minGuests, settings, daysOut, { by: opts.by, waive: opts.waive, nowIso: now.toISOString() });
  if (opts.by === "organiser") {
    const due = shareDueDate(r, settings.splitDueDays);
    if (today >= due) return { daysOut, quote: { ...quote, ok: false, problem: `Guest numbers could be changed here until ${formatDateLong(due)}. Please message Emily.` } };
  }
  return { daysOut, quote };
}

export async function reduceGuests(deps: LightDeps, requestId: string, newCount: number, opts: ReduceOptions): Promise<GuestReduction> {
  const r = await deps.repo.getPrivateRequest(requestId);
  if (!r) throw new OrderError("Request not found.", 404);
  const before = await deps.repo.listGuests(r.id);
  const { daysOut, quote: q } = await reduceGuestsPreview(deps, r, newCount, opts);
  if (!q.ok) throw new OrderError(q.problem ?? "Guest numbers can't be changed right now.");
  const now = nowOf(deps);
  const today = todayInBusinessTz(now);
  let record: GuestReduction = {
    at: now.toISOString(),
    by: opts.by,
    daysOut,
    from: q.from,
    to: q.to,
    removedNames: q.removedNames,
    refundCents: q.refundCents,
    creditCents: q.creditCents,
    keptCents: q.keptCents,
    voucherReturnedCents: 0,
    passCreditsReturned: 0,
    summary: q.summary,
  };
  const ok = await deps.repo.reducePrivateGuests({
    requestId: r.id,
    expectedGuests: r.guests,
    newGuests: q.to,
    newEstimateCents: q.newTotalCents,
    removeOpenIds: q.removeOpenIds,
    removePaidIds: q.removePaid.map((p) => p.id),
    shareUpdates: q.shareUpdates,
    freeIds: q.freeIds,
    cashOutCents: q.refundCents + q.creditCents,
    record,
  });
  if (!ok) throw new OrderError("The guest list changed just now. Please reload the page and try again.", 409);

  // Codes on removed places come back (always for unpaid places; for paid ones, as the quote says).
  let voucherBack = 0;
  let passBack = 0;
  const byId = new Map(before.map((g) => [g.id, g]));
  const who = (id: string) => {
    const g = byId.get(id)!;
    return { email: g.email || r.email, name: g.name || r.contactName, reference: r.reference };
  };
  for (const id of q.removeOpenIds) {
    const g = byId.get(id)!;
    if (g.voucherId) voucherBack += await giveBackVoucherFor(deps, "share", id, who(id));
    if (g.passId) passBack += await deps.repo.returnPassShare(id, today);
  }
  for (const p of q.removePaid) {
    if (p.returnVoucher) voucherBack += await giveBackVoucherFor(deps, "share", p.id, who(p.id));
    if (p.returnPass) passBack += await deps.repo.returnPassShare(p.id, today);
  }

  // Credit (inside the credit window) for removed guests and the organiser.
  for (const p of q.removePaid) {
    if (p.creditCents > 0) {
      await issueCredit(deps, { ...who(p.id), amountCents: p.creditCents, reason: `here is the credit for your cancelled place in private class ${r.reference}.`, sourceOrderId: null });
    }
  }
  if (q.organiser.creditCents > 0) {
    await issueCredit(deps, { email: r.email, name: r.contactName, amountCents: q.organiser.creditCents, reason: `here is the credit from lowering the guest numbers for private class ${r.reference}.`, sourceOrderId: null });
  }

  // Refunds go back to the payment each place was paid with.
  let refunded = 0;
  const refundIds: string[] = [];
  const label = `private class ${r.reference} (fewer guests)`;
  const paidPayments = () => deps.repo.listPaidPayments("private", r.id);
  for (const p of q.removePaid) {
    if (p.refundCents <= 0) continue;
    const holdKey = byId.get(p.id)?.holdKey ?? null;
    const res = await refundFromPayments(deps, async () => (await paidPayments()).filter((x) => x.kind === "private_share" && !!holdKey && x.shareHoldKey === holdKey), p.refundCents, `reduce-${record.at}-${p.id}`, label);
    refunded += res.refundedCents;
    refundIds.push(...res.refundIds);
  }
  if (q.organiser.refundCents > 0) {
    const res = await refundFromPayments(deps, async () => (await paidPayments()).filter((x) => x.kind === "private_deposit"), q.organiser.refundCents, `reduce-${record.at}-organiser`, label);
    refunded += res.refundedCents;
    refundIds.push(...res.refundIds);
  }
  if (refunded > 0) await deps.repo.recordReductionRefund(r.id, record.at, refunded, refundIds);
  record = { ...record, voucherReturnedCents: voucherBack, passCreditsReturned: passBack, ...(refunded > 0 ? { autoRefundedCents: refunded, refundIds } : {}) };

  const updated = (await deps.repo.getPrivateRequest(r.id)) ?? r;
  await sendSafely(deps.mailer, guestsReducedEmail(updated, record, organiserLink(deps.baseUrl, r.id)));
  for (const p of q.removePaid) {
    const g = byId.get(p.id)!;
    if (!g.email) continue;
    const outcome = p.refundCents
      ? `${formatAud(p.refundCents)} is being refunded to the card that paid.`
      : p.creditCents
        ? `You'll get ${formatAud(p.creditCents)} as credit by email.`
        : `This is inside the no-refund window, so nothing is due back.`;
    await sendSafely(deps.mailer, guestRemovedEmail(updated, g.email, g.name, outcome));
  }
  const to = adminEmail();
  if (to) await sendSafely(deps.mailer, guestsReducedAlertEmail(updated, record, to));
  return record;
}
