// Changing and cancelling orders under Emily's terms, design approval, and
// the daily housekeeping job. Refunds are never automatic: the outcome is
// recorded on the order and Emily is told what to refund in Stripe.

import { randomUUID } from "node:crypto";
import { checkBooking } from "../domain/availability";
import { daysBetween, formatDateLong, formatTime12, todayInBusinessTz } from "../domain/dates";
import { cancellationOutcome, termsCheck } from "../domain/terms";
import type { CancellationRecord, Order } from "../domain/types";
import { RELEASE_AFTER_MINUTES } from "../data/repository";
import { checkUpload, IMAGE_TYPES, MAX_PHOTO_BYTES } from "../validation";
import { calendarContext } from "./calendar";
import { adminEmail, adminLink, nowOf, OrderError, orderLink, type LightDeps } from "./common";
import {
  cancellationAlertEmail,
  cancellationEmail,
  changeRequestedAlertEmail,
  dateChangedAlertEmail,
  dateChangedEmail,
  designApprovedAlertEmail,
  designForApprovalEmail,
  sendSafely,
} from "./email";
import { expireClassOffers, releaseStaleBookings, runClassMessages } from "./classes";
import { runScheduledMessages, sendEventMessage } from "./messages";
import { refundTarget } from "./refunds";
import { giveBackVoucherFor, issueCredit } from "./vouchers";
import { expireOffers, offerNext } from "./waitlist";

async function load(deps: LightDeps, orderId: string): Promise<Order> {
  const order = await deps.repo.getOrderById(orderId);
  if (!order) throw new OrderError("Order not found.", 404);
  return order;
}

function daysOutFor(deps: LightDeps, order: Order): number {
  return daysBetween(todayInBusinessTz(nowOf(deps)), order.pickupDate);
}

/** Give back any voucher or credit used, as credit. Returns the amount given back. */
async function giveBackVoucher(deps: LightDeps, order: Order): Promise<number> {
  const today = todayInBusinessTz(nowOf(deps));
  const back = await deps.repo.returnVoucher(order.id, today);
  if (back.amount > 0 && !back.toVoucher) {
    await issueCredit(deps, {
      email: order.email,
      name: order.customerName,
      amountCents: back.amount,
      reason: `the voucher you used on order ${order.reference} had expired, so here is the amount back as new credit.`,
      sourceOrderId: order.id,
    });
  }
  return back.amount;
}

/** Cancel an order. Customers are held to the terms; when Emily cancels, everything paid is refunded. */
export async function cancelWithTerms(deps: LightDeps, orderId: string, by: "customer" | "emily"): Promise<CancellationRecord> {
  const order = await load(deps, orderId);
  const settings = await deps.repo.getSettings();
  const daysOut = daysOutFor(deps, order);
  if (by === "customer") {
    const check = termsCheck(order, settings, daysOut);
    if (!check.canCancel) throw new OrderError(check.cancelReason);
  } else if (order.stage === "collected" || order.stage === "cancelled") {
    throw new OrderError(order.stage === "collected" ? "A collected order cannot be cancelled." : "This order is already cancelled.");
  }
  const outcome = cancellationOutcome(order, settings, daysOut, by);
  const record: CancellationRecord = {
    at: nowOf(deps).toISOString(),
    by,
    daysOut,
    refundCents: outcome.refundCents,
    creditCents: outcome.creditCents,
    keptCents: outcome.keptCents,
    voucherReturnedCents: outcome.voucherReturnedCents,
    summary: outcome.summary,
  };
  if (!(await deps.repo.cancelOrderOnce(order.id, record))) throw new OrderError("This order is already cancelled.", 409);

  if (outcome.creditCents > 0) {
    await issueCredit(deps, {
      email: order.email,
      name: order.customerName,
      amountCents: outcome.creditCents,
      reason: `here is the credit from your cancelled order ${order.reference}.`,
      sourceOrderId: order.id,
    });
  }
  await giveBackVoucher(deps, order);
  // A stamp card reward used on a cancelled order can be used again.
  if (order.stampReward) await deps.repo.releaseStampReward(order.id);

  // Automated refunds (when switched on); otherwise Emily refunds by hand.
  const refund = await refundTarget(deps, "order", order.id, record.refundCents, `cancel-${by}`, `order ${order.reference}`);
  if (refund.refundedCents > 0) {
    record.autoRefundedCents = refund.refundedCents;
    record.refundIds = refund.refundIds;
    await deps.repo.updateOrder(order.id, { cancellation: record });
  }

  await deps.repo.addUpdate({ orderId: order.id, kind: "stage", caption: "This order was cancelled.", mediaPath: null });
  await sendSafely(deps.mailer, cancellationEmail(order, record, orderLink(deps.baseUrl, order.id)));
  const to = adminEmail();
  if (to) await sendSafely(deps.mailer, cancellationAlertEmail(order, record, adminLink(deps.baseUrl, order.id), to));
  await offerNext(deps, order.pickupDate);
  return record;
}

/** Move the pickup date online: once for free, capacity-checked, same price only. */
export async function changeDate(deps: LightDeps, orderId: string, newDate: string, newSlot: string): Promise<Order> {
  const order = await load(deps, orderId);
  const settings = await deps.repo.getSettings();
  const check = termsCheck(order, settings, daysOutFor(deps, order));
  if (!check.canChangeDate) throw new OrderError(check.dateReason);
  if (newDate === order.pickupDate && newSlot === order.pickupSlot) throw new OrderError("That's your current pickup time.");

  const ctx = await calendarContext(deps.repo, nowOf(deps), { excludeOrderId: order.id });
  const booking = checkBooking(newDate, newSlot, ctx);
  if (!booking.ok) throw new OrderError(booking.reason, 409);
  if (booking.status.isRush) throw new OrderError("That date is inside the notice period. Please message Emily.");
  if ((booking.status.peak?.surchargeCents ?? 0) !== order.peakSurchargeCents) {
    throw new OrderError("That date has a different price. Please message Emily to move to it.");
  }

  const from = `${formatDateLong(order.pickupDate)} at ${formatTime12(order.pickupSlot)}`;
  await deps.repo.updateOrder(order.id, { pickupDate: newDate, pickupSlot: newSlot, dateChangesUsed: order.dateChangesUsed + 1 });
  const moved = await load(deps, order.id);
  await deps.repo.addUpdate({ orderId: order.id, kind: "note", caption: `Pickup moved from ${from} to ${formatDateLong(newDate)} at ${formatTime12(newSlot)}.`, mediaPath: null });
  await sendSafely(deps.mailer, dateChangedEmail(moved, orderLink(deps.baseUrl, order.id)));
  const to = adminEmail();
  if (to) await sendSafely(deps.mailer, dateChangedAlertEmail(moved, from, adminLink(deps.baseUrl, order.id), to));
  if (order.pickupDate !== newDate) await offerNext(deps, order.pickupDate);
  return moved;
}

export interface Upload {
  bytes: Uint8Array;
  contentType: string;
}

/** Emily sends a sketch or mood board for the customer to approve. */
export async function sendForApproval(deps: LightDeps, orderId: string, note: string, sketch: Upload | null): Promise<void> {
  const order = await load(deps, orderId);
  if (order.stage !== "received" && order.stage !== "awaiting_approval") {
    throw new OrderError("Designs can be sent for approval before they are confirmed.");
  }
  const text = note.trim().slice(0, 500);
  let mediaPath: string | null = null;
  if (sketch) {
    const check = checkUpload(sketch.bytes, sketch.contentType, IMAGE_TYPES, MAX_PHOTO_BYTES);
    if (!check.ok) throw new OrderError(check.reason);
    mediaPath = `orders/${order.id}/sketch-${randomUUID()}.${check.ext}`;
    await deps.repo.uploadMedia(mediaPath, sketch);
  } else if (!text) {
    throw new OrderError("Add a sketch or a note describing the design.");
  }
  await deps.repo.setStage(order.id, "awaiting_approval");
  await deps.repo.addUpdate({ orderId: order.id, kind: "sketch", caption: text, mediaPath });
  await sendSafely(deps.mailer, designForApprovalEmail(order, text, orderLink(deps.baseUrl, order.id)));
}

export async function approveDesign(deps: LightDeps, orderId: string): Promise<void> {
  const order = await load(deps, orderId);
  if (order.stage !== "awaiting_approval") throw new OrderError("There's no design waiting for your approval.", 409);
  const at = nowOf(deps).toISOString();
  await deps.repo.updateOrder(order.id, { stage: "design_confirmed", approvedAt: at });
  await deps.repo.addUpdate({ orderId: order.id, kind: "approval", caption: "Design approved. Thank you!", mediaPath: null });
  await sendEventMessage(deps, { ...order, stage: "design_confirmed", approvedAt: at }, "design_confirmed");
  const to = adminEmail();
  if (to) await sendSafely(deps.mailer, designApprovedAlertEmail(order, adminLink(deps.baseUrl, order.id), to));
}

/** The customer asks for a change. Returns true when this is beyond the free rounds. */
export async function requestDesignChange(deps: LightDeps, orderId: string, request: string): Promise<{ extraRound: boolean }> {
  const order = await load(deps, orderId);
  const settings = await deps.repo.getSettings();
  if (order.stage !== "awaiting_approval") throw new OrderError("There's no design waiting for your approval.", 409);
  const check = termsCheck(order, settings, daysOutFor(deps, order));
  if (!check.canChangeDesign) throw new OrderError(check.designReason);
  const text = request.trim().slice(0, 1000);
  if (text.length < 3) throw new OrderError("Please describe the change you'd like.");
  const extraRound = order.designChangesUsed >= settings.freeDesignChangeRounds;
  await deps.repo.updateOrder(order.id, { stage: "received", designChangesUsed: order.designChangesUsed + 1 });
  await deps.repo.addUpdate({ orderId: order.id, kind: "change_request", caption: text, mediaPath: null });
  const to = adminEmail();
  if (to) await sendSafely(deps.mailer, changeRequestedAlertEmail(order, text, adminLink(deps.baseUrl, order.id), to, extraRound));
  return { extraRound };
}

/** Cancel unpaid orders and box orders that were abandoned at checkout, releasing what they held. */
export async function releaseStale(deps: LightDeps): Promise<{ orders: number; boxes: number; corporate: number; bookings: number }> {
  const now = nowOf(deps);
  const before = new Date(now.getTime() - RELEASE_AFTER_MINUTES * 60_000).toISOString();
  let orders = 0;
  for (const o of await deps.repo.listStaleUnpaidOrders(before)) {
    const record: CancellationRecord = {
      at: now.toISOString(),
      by: "expired",
      daysOut: daysOutFor(deps, o),
      refundCents: 0,
      creditCents: 0,
      keptCents: 0,
      voucherReturnedCents: o.voucherAppliedCents,
      summary: "The deposit wasn't paid, so this order expired.",
    };
    if (await deps.repo.cancelOrderOnce(o.id, record, true)) {
      orders++;
      await giveBackVoucher(deps, o);
      await deps.repo.voidReferral(o.id);
      await deps.repo.releaseStampReward(o.id);
      await offerNext(deps, o.pickupDate);
    }
  }
  let boxes = 0;
  for (const b of await deps.repo.listStaleUnpaidBoxOrders(before)) {
    if (await deps.repo.cancelBoxOrder(b.id, true)) {
      boxes++;
      await giveBackVoucherFor(deps, "box", b.id, { email: b.email, name: b.customerName, reference: b.reference });
    }
  }
  let corporate = 0;
  for (const c of await deps.repo.listStaleUnpaidCorporate(before)) {
    if (await deps.repo.setCorporateStatus(c.id, "cancelled", ["awaiting_payment"])) {
      corporate++;
      await giveBackVoucherFor(deps, "corporate", c.id, { email: c.email, name: c.contactName, reference: c.reference });
    }
  }
  const bookings = await releaseStaleBookings(deps);
  return { orders, boxes, corporate, bookings };
}

/** Everything the daily cron does. Each part is safe to run more than once. */
export async function runDaily(deps: LightDeps) {
  const released = await releaseStale(deps);
  const waitlist = await expireOffers(deps);
  const classWaitlist = await expireClassOffers(deps);
  const messages = await runScheduledMessages(deps);
  const classMessages = await runClassMessages(deps);
  return { released, waitlist, classWaitlist, messages, classMessages };
}
