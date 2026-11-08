// Split payments and guest details for private classes. After the organiser
// pays the deposit, guests use one share link to add their details and pay
// their share. Places are held atomically, so two people can't pay the same
// share, and the organiser can pay what's left after the due date.

import { randomUUID } from "node:crypto";
import { BUSINESS } from "../config";
import { todayInBusinessTz } from "../domain/dates";
import { allergyChanged, guestCanEdit, guestEditDeadline, passCreditValue, shareCodeProblem, shareOwed } from "../domain/guests";
import { canNudge, holdable, NUDGE_COOLDOWN_HOURS, organiserCanPayRest, shareAmounts, shareDueDate, splitProgress } from "../domain/split";
import { looksLikeCode } from "../domain/vouchers";
import type { Payment, PrivateGuest, PrivateRequest } from "../domain/types";
import { PAYMENT_HOLD_MINUTES } from "../data/repository";
import type { GuestDetails } from "../validation";
import { adminEmail, guestLink, nowOf, OrderError, organiserLink, shareLink, type Deps, type LightDeps } from "./common";
import { guestAllergyChangedEmail, sendSafely, shareNudgeEmail, sharePaidEmail, shareProgressEmail, sharesReadyEmail } from "./email";
import { handleLatePayment } from "./late-payments";
import { giveBackVoucherFor } from "./vouchers";
import { hashCode, hashToken, linkToken, looksLikeToken, safeEqual } from "./tokens";

/** Deposit paid: create the guest places and email the organiser their share link. */
export async function setUpShares(deps: LightDeps, r: PrivateRequest): Promise<void> {
  const shares = shareAmounts(r.estimateCents, r.depositCents, r.guests);
  await deps.repo.createGuestSlots(r.id, shares);
  if (!(await deps.repo.setPrivateShareToken(r.id, hashToken(linkToken("share", r.id))))) return;
  const settings = await deps.repo.getSettings();
  await sendSafely(
    deps.mailer,
    sharesReadyEmail(r, shareLink(deps.baseUrl, r.id), organiserLink(deps.baseUrl, r.id), shares[shares.length - 1], shareDueDate(r, settings.splitDueDays)),
  );
}

export async function requestFromShareToken(deps: Pick<LightDeps, "repo">, token: string): Promise<PrivateRequest | null> {
  if (!looksLikeToken(token)) return null;
  const r = await deps.repo.getPrivateRequestByShareHash(hashToken(token));
  return r && r.status === "paid" ? r : null;
}

/** A guest's own page: the share token plus their place's token. */
export async function guestFromTokens(deps: Pick<LightDeps, "repo">, shareToken: string, guestId: string, guestToken: string): Promise<{ request: PrivateRequest; guest: PrivateGuest } | null> {
  const request = await requestFromShareToken(deps, shareToken);
  if (!request || !/^[0-9a-f-]{36}$/.test(guestId) || !looksLikeToken(guestToken)) return null;
  if (!safeEqual(hashToken(linkToken("guest", guestId)), hashToken(guestToken))) return null;
  const guest = await deps.repo.getGuest(guestId);
  return guest && guest.requestId === request.id ? { request, guest } : null;
}

async function holdAndCheckout(deps: Deps, r: PrivateRequest, all: PrivateGuest[], email: string, successUrl: string, cancelUrl: string): Promise<string> {
  // A share fully covered by a voucher or pass credit needs no payment.
  const guests = all.filter((g) => shareOwed(g) > 0);
  if (guests.length === 0) throw new OrderError("There's nothing left to pay.");
  const key = randomUUID();
  // Holds run on the real clock (like the database's now()), matching the checkout's own expiry.
  const until = new Date(Date.now() + PAYMENT_HOLD_MINUTES * 60_000).toISOString();
  if (!(await deps.repo.holdShares(guests.map((g) => g.id), key, until))) {
    throw new OrderError("Someone is paying for this share right now, or it's already paid. Please try again in a few minutes.", 409);
  }
  const amount = guests.reduce((s, g) => s + shareOwed(g), 0);
  const checkout = await deps.payments.createCheckout({
    targetId: r.id,
    reference: r.reference,
    kind: "private_share",
    amountCents: amount,
    description: `${BUSINESS.name}: private class ${guests.length === 1 ? "share" : `${guests.length} shares`} (${r.reference})`,
    customerEmail: email,
    successUrl,
    cancelUrl,
  });
  await deps.repo.createPayment({ orderId: null, boxOrderId: null, voucherId: null, privateRequestId: r.id, shareHoldKey: key, kind: "private_share", amountCents: amount, stripeSessionId: checkout.id });
  return checkout.url;
}

function openForShares(r: PrivateRequest, today: string) {
  if (r.status !== "paid") throw new OrderError("This class isn't taking guest payments.");
  if (r.preferredDate <= today) throw new OrderError("This class has already happened.");
}

/** A guest adds their details (taking a place), and optionally pays straight away. */
export async function joinAsGuest(deps: Deps, input: GuestDetails): Promise<{ guestUrl: string; checkoutUrl: string | null }> {
  const r = await requestFromShareToken(deps, input.shareToken);
  if (!r) throw new OrderError("That link isn't valid.", 404);
  openForShares(r, todayInBusinessTz(nowOf(deps)));
  const id = await deps.repo.claimGuestSlot(r.id, {
    name: input.name,
    email: input.email,
    allergies: input.allergies,
    dietary: input.dietary,
    messageOptIn: input.messageOptIn,
  });
  if (!id) throw new OrderError(`All ${r.guests} places already have a guest. Please check with ${r.contactName.split(" ")[0]}.`, 409);
  const guestUrl = guestLink(deps.baseUrl, r.id, id);
  if (!input.pay) return { guestUrl, checkoutUrl: null };
  const guest = (await deps.repo.getGuest(id))!;
  if (guest.status === "paid") return { guestUrl, checkoutUrl: null };
  const checkoutUrl = await holdAndCheckout(deps, r, [guest], input.email, `${guestUrl}?paid=1`, guestUrl);
  return { guestUrl, checkoutUrl };
}

export async function payOwnShare(deps: Deps, request: PrivateRequest, guest: PrivateGuest): Promise<string> {
  openForShares(request, todayInBusinessTz(nowOf(deps)));
  if (guest.status === "paid") throw new OrderError("Your share is already paid. Thank you!");
  const url = guestLink(deps.baseUrl, request.id, guest.id);
  return holdAndCheckout(deps, request, [guest], guest.email || request.email, `${url}?paid=1`, url);
}

/** After the due date, the organiser pays every share still open (and not mid-payment). */
export async function payRemainingShares(deps: Deps, request: PrivateRequest, organiserUrl: string): Promise<string> {
  const now = nowOf(deps);
  const today = todayInBusinessTz(now);
  openForShares(request, today);
  const settings = await deps.repo.getSettings();
  const guests = await deps.repo.listGuests(request.id);
  const due = shareDueDate(request, settings.splitDueDays);
  if (!organiserCanPayRest(today, due, splitProgress(guests))) throw new OrderError("You can pay the remaining shares from the due date.");
  const open = guests.filter((g) => holdable(g, new Date().toISOString()));
  return holdAndCheckout(deps, request, open, request.email, `${organiserUrl}?paid=1`, organiserUrl);
}

/** Email guests who've added details but not paid. At most once a day per class. */
export async function nudgeGuests(deps: LightDeps, request: PrivateRequest): Promise<number> {
  const now = nowOf(deps);
  if (!canNudge(request.lastNudgeAt, now)) throw new OrderError(`You can send one reminder every ${NUDGE_COOLDOWN_HOURS} hours.`, 429);
  const guests = (await deps.repo.listGuests(request.id)).filter((g) => g.status === "open" && g.email);
  if (guests.length === 0) throw new OrderError("Nobody with an email address is still to pay. Share the link again with guests who haven't joined.");
  const before = new Date(now.getTime() - NUDGE_COOLDOWN_HOURS * 3_600_000).toISOString();
  if (!(await deps.repo.claimNudge(request.id, before, now.toISOString()))) throw new OrderError(`You can send one reminder every ${NUDGE_COOLDOWN_HOURS} hours.`, 429);
  const settings = await deps.repo.getSettings();
  const due = shareDueDate(request, settings.splitDueDays);
  for (const g of guests) await sendSafely(deps.mailer, shareNudgeEmail(request, g.name, g.email, guestLink(deps.baseUrl, request.id, g.id), g.shareCents, due));
  return guests.length;
}

/** Webhook: a share payment arrived. */
export async function onSharePaid(deps: LightDeps, request: PrivateRequest, payment: Payment): Promise<void> {
  const guests = await deps.repo.listGuests(request.id);
  const paidNow = guests.filter((g) => g.holdKey === payment.shareHoldKey && g.status === "paid");
  if (paidNow.length === 0) {
    // The hold had run out and someone else's payment took the share: refund this one.
    await handleLatePayment(deps, payment, request.reference);
    return;
  }
  for (const g of paidNow) if (g.email) await sendSafely(deps.mailer, sharePaidEmail(request, g.name, g.email, g.shareCents));
  const progress = splitProgress(guests);
  await sendSafely(deps.mailer, shareProgressEmail(request, progress.paid, progress.guests, organiserLink(deps.baseUrl, request.id)));
}

// Phase 5 -------------------------------------------------------------------

export type GuestEdit = Pick<PrivateGuest, "name" | "email" | "allergies" | "dietary" | "messageOptIn">;

/** Can this guest still change their details? (For the page, and checked again on save.) */
export async function guestEditWindow(deps: Pick<LightDeps, "repo" | "now">, request: PrivateRequest): Promise<{ canEdit: boolean; deadline: string }> {
  const settings = await deps.repo.getSettings();
  const today = todayInBusinessTz(nowOf(deps));
  return {
    canEdit: request.status === "paid" && guestCanEdit(request.preferredDate, today, settings.guestEditCutoffDays),
    deadline: guestEditDeadline(request.preferredDate, settings.guestEditCutoffDays),
  };
}

/** A guest changes their own details from their link, up to the cut-off. Emily hears about allergy changes. */
export async function editGuestDetails(deps: LightDeps, request: PrivateRequest, guest: PrivateGuest, d: GuestEdit): Promise<{ allergyChanged: boolean }> {
  const window = await guestEditWindow(deps, request);
  if (!window.canEdit) throw new OrderError("Details can't be changed online this close to the class. Please message Emily with any changes, especially allergies.");
  await deps.repo.updateGuestDetails(guest.id, d);
  const changed = allergyChanged(guest, d);
  const to = adminEmail();
  if (changed && to) await sendSafely(deps.mailer, guestAllergyChangedEmail(request, d, guest, to));
  return { allergyChanged: changed };
}

/**
 * A guest uses a gift voucher, credit code or class pass on their own share.
 * One code per share, taken atomically. If it covers the whole share, the
 * share is paid with no checkout.
 */
export async function applyCodeToShare(deps: LightDeps, request: PrivateRequest, guest: PrivateGuest, code: string): Promise<{ appliedCents: number; kind: "voucher" | "pass"; owedCents: number; paid: boolean }> {
  const now = nowOf(deps);
  openForShares(request, todayInBusinessTz(now));
  const problem = shareCodeProblem(guest, new Date().toISOString());
  if (problem) throw new OrderError(problem, 409);
  const bad = "That code wasn't recognised, or has nothing left on it. Please check it and try again.";
  if (!looksLikeCode(code)) throw new OrderError(bad);
  const today = todayInBusinessTz(now);
  const hash = hashCode(code);
  const voucher = await deps.repo.getVoucherByCodeHash(hash);
  let applied = 0;
  let kind: "voucher" | "pass" = "voucher";
  if (voucher) {
    applied = await deps.repo.redeemVoucherFor("share", hash, guest.id, shareOwed(guest), today);
  } else if (await deps.repo.getPassByCodeHash(hash)) {
    kind = "pass";
    const settings = await deps.repo.getSettings();
    applied = await deps.repo.redeemPassShare(hash, guest.id, passCreditValue(settings.passPriceCents, settings.passCredits), today);
  }
  if (applied === 0) throw new OrderError(bad);
  const updated = (await deps.repo.getGuest(guest.id))!;
  const owed = shareOwed(updated);
  let paid = false;
  if (owed === 0 && (await deps.repo.markSharePaidFree(guest.id))) {
    paid = true;
    if (updated.email) await sendSafely(deps.mailer, sharePaidEmail(request, updated.name, updated.email, updated.shareCents));
    const progress = splitProgress(await deps.repo.listGuests(request.id));
    await sendSafely(deps.mailer, shareProgressEmail(request, progress.paid, progress.guests, organiserLink(deps.baseUrl, request.id)));
  }
  return { appliedCents: applied, kind, owedCents: owed, paid };
}

/** When a private class is cancelled, each guest's voucher or pass credit comes back. */
export async function returnShareCodes(deps: LightDeps, request: PrivateRequest): Promise<{ voucherCents: number; passCredits: number }> {
  const today = todayInBusinessTz(nowOf(deps));
  let voucherCents = 0;
  let passCredits = 0;
  for (const g of await deps.repo.listGuests(request.id)) {
    if (g.voucherId) voucherCents += await giveBackVoucherFor(deps, "share", g.id, { email: g.email || request.email, name: g.name || request.contactName, reference: request.reference });
    if (g.passId) passCredits += await deps.repo.returnPassShare(g.id, today);
  }
  return { voucherCents, passCredits };
}
