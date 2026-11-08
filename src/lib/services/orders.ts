// Order workflows. Every function takes its dependencies as arguments so the
// same code runs against Supabase in production and the memory adapter in tests.

import { randomUUID } from "node:crypto";
import { BUSINESS } from "../config";
import { checkBooking } from "../domain/availability";
import { isBirthday } from "../domain/automations";
import { todayInBusinessTz } from "../domain/dates";
import { balanceOwing, dueAtCheckout, priceCake, PricingError } from "../domain/pricing";
import { nextStage, STAGE_MESSAGES } from "../domain/stages";
import type { Order, Stage } from "../domain/types";
import { sanitizeConfig, visibleItems } from "../domain/visibility";
import { looksLikeCode, VOUCHER_PROBLEM_TEXT, voucherProblem } from "../domain/vouchers";
import type { OrderRequest } from "../validation";
import { checkUpload, IMAGE_TYPES, magicMatches, MAX_PHOTO_BYTES, MAX_VIDEO_BYTES, VIDEO_TYPES } from "../validation";
import { calendarContext } from "./calendar";
import { adminEmail, adminLink, boxLink, corporateLink, nowOf, OrderError, orderLink, type Deps, type LightDeps } from "./common";
import {
  balanceReceiptEmail,
  corporateAlertEmail,
  corporateConfirmationEmail,
  boxAlertEmail,
  boxConfirmationEmail,
  latePaymentAlertEmail,
  newOrderAlertEmail,
  photoUpdateEmail,
  sendSafely,
  stageEmail,
} from "./email";
import { sendEventMessage } from "./messages";
import { onClassPaid, onPrivatePaid } from "./classes";
import { checkReferral, rewardReferral, stampCardFor } from "./referrals";
import { sendVoucherEmails } from "./vouchers";
import { offerFromToken } from "./waitlist";
import { hashCode, hashToken, newReference, orderToken } from "./tokens";

export { OrderError, orderLink, adminLink, type Deps } from "./common";
export { calendarContext, monthAvailability, slotAvailability } from "./calendar";

export interface Upload {
  bytes: Uint8Array;
  contentType: string;
}

export async function createOrder(deps: Deps, req: OrderRequest, inspiration: Upload | null) {
  const { repo } = deps;
  const now = nowOf(deps);
  const today = todayInBusinessTz(now);

  // Claiming a waitlist offer: the held place is left out of the calendar for this customer only.
  let claim = null;
  if (req.waitlistToken) {
    claim = await offerFromToken(deps, req.waitlistToken);
    if (!claim) throw new OrderError("Sorry, that waitlist offer has expired.", 410);
    if (claim.date !== req.pickupDate) throw new OrderError("This offer is for a different date.");
  }

  const [catalogue, ctx] = await Promise.all([repo.listCatalogue(), calendarContext(repo, now, claim ? { excludeWaitlistId: claim.id } : undefined)]);

  const { config, removed } = sanitizeConfig(req.config, catalogue, req.dietary);
  if (removed.length) {
    throw new OrderError(`Sorry, these options are no longer available: ${removed.join(", ")}. Please review your cake.`, 409);
  }
  for (const key of ["occasion", "size", "flavour", "finish", "colour"] as const) {
    if (config[key] !== req.config[key]) throw new OrderError("Please review your cake choices.", 409);
  }
  if (!config.decorations.includes("dec-topper")) config.topperText = "";

  const booking = checkBooking(req.pickupDate, req.pickupSlot, ctx);
  if (!booking.ok) throw new OrderError(booking.reason, 409);

  // Phase 3: a referral code for a first order, and a stamp card reward if one is due.
  const referral = req.referralCode ? await checkReferral(repo, ctx.settings, req.referralCode, req.email) : null;
  const stamps = ctx.settings.stampsEnabled ? await stampCardFor(repo, ctx.settings, req.email) : null;
  const stampReward = Boolean(stamps && stamps.rewardsAvailable > 0);

  let price;
  try {
    price = priceCake(config, visibleItems(catalogue), ctx.settings, {
      isRush: booking.status.isRush,
      peakSurchargeCents: booking.status.peak?.surchargeCents ?? 0,
      peakLabel: booking.status.peak?.label,
      referralDiscountCents: referral ? ctx.settings.referralGiveCents : 0,
      stampRewardName: stampReward ? ctx.settings.stampRewardName : undefined,
    });
  } catch (e) {
    if (e instanceof PricingError) throw new OrderError(e.message);
    throw e;
  }

  // Check a voucher before creating anything, for a clear message. It is
  // taken atomically after the order exists.
  let codeHash: string | null = null;
  if (req.voucherCode) {
    if (!looksLikeCode(req.voucherCode)) throw new OrderError(VOUCHER_PROBLEM_TEXT.not_found);
    codeHash = hashCode(req.voucherCode);
    const problem = voucherProblem(await repo.getVoucherByCodeHash(codeHash), today);
    if (problem) throw new OrderError(VOUCHER_PROBLEM_TEXT[problem]);
  }

  const id = randomUUID();
  let inspirationPath: string | null = null;
  if (inspiration) {
    const check = checkUpload(inspiration.bytes, inspiration.contentType, IMAGE_TYPES, MAX_PHOTO_BYTES);
    if (!check.ok) throw new OrderError(check.reason);
    inspirationPath = `orders/${id}/inspiration-${randomUUID()}.${check.ext}`;
    await repo.uploadMedia(inspirationPath, inspiration);
  }

  const token = orderToken(id);
  let order = await repo.createOrder({
    id,
    reference: newReference(),
    tokenHash: hashToken(token),
    stage: "awaiting_payment",
    customerName: req.customerName,
    email: req.email,
    phone: req.phone,
    marketingOptIn: req.marketingOptIn,
    pickupDate: req.pickupDate,
    pickupSlot: req.pickupSlot,
    config,
    allergyNotes: req.allergyNotes,
    notes: req.notes,
    inspirationPath,
    items: price.lines.map((l) => ({ itemId: l.itemId, category: l.category, name: l.name, amountCents: l.amountCents })),
    subtotalCents: price.subtotalCents,
    rushFeeCents: price.rushFeeCents,
    peakSurchargeCents: price.peakSurchargeCents,
    totalCents: price.totalCents,
    depositCents: price.depositCents,
    isRush: price.isRush,
    termsAcceptedAt: now.toISOString(),
    dietary: req.dietary,
    remindNextYear: req.remindNextYear && isBirthday({ config }),
    waitlistId: claim?.id ?? null,
    referralCode: referral?.code ?? null,
    stampReward,
  });

  const abandon = async (message: string, status = 409): Promise<never> => {
    await repo.cancelOrderOnce(order.id, null, true);
    await repo.returnVoucher(order.id, today);
    await repo.voidReferral(order.id);
    throw new OrderError(message, status);
  };

  if (referral && !(await repo.createReferral({ code: referral.code, referrerEmail: referral.referrerEmail, referredEmail: req.email, orderId: order.id }))) {
    await abandon("A referral code has already been used for this email.");
  }

  if (claim && !(await repo.claimWaitlist(claim.id, order.id, now.toISOString()))) {
    await abandon("Sorry, that waitlist offer has expired.", 410);
  }

  let applied = 0;
  if (codeHash) {
    applied = await repo.redeemVoucher(codeHash, order.id, price.totalCents, today);
    if (applied === 0) await abandon("Sorry, that code could not be used. Please check it and try again.");
    order = (await repo.getOrderById(order.id))!;
  }

  const link = orderLink(deps.baseUrl, order.id);
  const payNow = dueAtCheckout(price.depositCents, applied);
  if (payNow === 0) {
    // The voucher covers the deposit: nothing to pay at checkout.
    await repo.setStage(order.id, "received");
    await onDepositSettled(deps, (await repo.getOrderById(order.id))!);
    return { order, checkoutUrl: `${link}?paid=1`, token };
  }

  const checkout = await deps.payments.createCheckout({
    targetId: order.id,
    reference: order.reference,
    kind: "deposit",
    amountCents: payNow,
    description: price.isRush
      ? `${BUSINESS.name} order ${order.reference} (paid in full, rush)`
      : `${BUSINESS.name} order ${order.reference} (deposit)`,
    customerEmail: order.email,
    successUrl: `${link}?paid=1`,
    cancelUrl: `${deps.baseUrl}/order?cancelled=1`,
  });
  await repo.createPayment({ orderId: order.id, boxOrderId: null, voucherId: null, kind: "deposit", amountCents: payNow, stripeSessionId: checkout.id });
  return { order, checkoutUrl: checkout.url, token };
}

/** The deposit is in (or a voucher covered it): confirm to the customer and tell Emily. */
async function onDepositSettled(deps: LightDeps, order: Order) {
  await sendEventMessage(deps, order, "order_received");
  await rewardReferral(deps, order);
  const alertTo = adminEmail();
  if (alertTo) await sendSafely(deps.mailer, newOrderAlertEmail(order, adminLink(deps.baseUrl, order.id), alertTo));
}

export async function startBalancePayment(deps: Deps, order: Order) {
  const owing = balanceOwing(order);
  if (order.stage === "cancelled" || order.stage === "awaiting_payment") throw new OrderError("This order cannot take a payment right now.");
  if (owing <= 0) throw new OrderError("This order is already paid in full.");
  const link = orderLink(deps.baseUrl, order.id);
  const checkout = await deps.payments.createCheckout({
    targetId: order.id,
    reference: order.reference,
    kind: "balance",
    amountCents: owing,
    description: `${BUSINESS.name} order ${order.reference} (balance)`,
    customerEmail: order.email,
    successUrl: `${link}?paid=1`,
    cancelUrl: link,
  });
  await deps.repo.createPayment({ orderId: order.id, boxOrderId: null, voucherId: null, kind: "balance", amountCents: owing, stripeSessionId: checkout.id });
  return checkout.url;
}

/** Called from the Stripe webhook (and the test checkout). Safe to call twice. */
export async function handlePaidSession(deps: LightDeps, eventId: string, sessionId: string): Promise<boolean> {
  const { repo, mailer } = deps;
  const payment = await repo.getPaymentBySession(sessionId);
  if (!payment) return false;
  const first = await repo.recordPaymentOnce(eventId, sessionId);
  if (!first) return false;
  const alertTo = adminEmail();

  if (payment.orderId) {
    const order = await repo.getOrderById(payment.orderId);
    if (!order) return true;
    if (order.stage === "cancelled") {
      if (alertTo) await sendSafely(mailer, latePaymentAlertEmail(order.reference, payment.amountCents, alertTo));
      return true;
    }
    if (payment.kind === "deposit") await onDepositSettled(deps, order);
    else await sendSafely(mailer, balanceReceiptEmail(order, orderLink(deps.baseUrl, order.id)));
  } else if (payment.boxOrderId) {
    const bo = await repo.getBoxOrderById(payment.boxOrderId);
    if (!bo) return true;
    if (bo.status === "cancelled") {
      if (alertTo) await sendSafely(mailer, latePaymentAlertEmail(bo.reference, payment.amountCents, alertTo));
      return true;
    }
    await sendSafely(mailer, boxConfirmationEmail(bo, boxLink(deps.baseUrl, bo.id)));
    if (alertTo) await sendSafely(mailer, boxAlertEmail(bo, alertTo));
  } else if (payment.voucherId) {
    const v = await repo.getVoucherById(payment.voucherId);
    if (v) await sendVoucherEmails(deps, v);
  } else if (payment.corporateOrderId) {
    const c = await repo.getCorporateOrderById(payment.corporateOrderId);
    if (!c) return true;
    if (c.status === "cancelled") {
      if (alertTo) await sendSafely(mailer, latePaymentAlertEmail(c.reference, payment.amountCents, alertTo));
      return true;
    }
    await sendSafely(mailer, corporateConfirmationEmail(c, corporateLink(deps.baseUrl, c.id)));
    if (alertTo && payment.kind === "corporate_deposit") await sendSafely(mailer, corporateAlertEmail(c, alertTo));
  } else if (payment.classBookingId) {
    const b = await repo.getBookingById(payment.classBookingId);
    if (!b) return true;
    if (b.status === "cancelled") {
      if (alertTo) await sendSafely(mailer, latePaymentAlertEmail(b.reference, payment.amountCents, alertTo));
      return true;
    }
    await onClassPaid(deps, b);
  } else if (payment.privateRequestId) {
    const r = await repo.getPrivateRequest(payment.privateRequestId);
    if (r) await onPrivatePaid(deps, r);
  }
  return true;
}

export async function advanceStage(deps: LightDeps, orderId: string): Promise<Stage> {
  const order = await deps.repo.getOrderById(orderId);
  if (!order) throw new OrderError("Order not found.", 404);
  const next = nextStage(order.stage);
  if (!next) throw new OrderError("This order has no next step.");
  await deps.repo.setStage(order.id, next);
  await deps.repo.addUpdate({ orderId: order.id, kind: "stage", caption: STAGE_MESSAGES[next] ?? "", mediaPath: null });
  if (next === "design_confirmed") await sendEventMessage(deps, { ...order, stage: next }, "design_confirmed");
  else await sendSafely(deps.mailer, stageEmail(order, next, orderLink(deps.baseUrl, order.id)));
  return next;
}

/** A photo (sent through the website) or a text-only note. */
export async function postUpdate(
  deps: LightDeps,
  orderId: string,
  caption: string,
  photo: Upload | null,
): Promise<void> {
  const order = await deps.repo.getOrderById(orderId);
  if (!order) throw new OrderError("Order not found.", 404);
  const text = caption.trim().slice(0, 300);
  let mediaPath: string | null = null;
  if (photo) {
    const check = checkUpload(photo.bytes, photo.contentType, IMAGE_TYPES, MAX_PHOTO_BYTES);
    if (!check.ok) throw new OrderError(check.reason);
    mediaPath = `orders/${order.id}/update-${randomUUID()}.${check.ext}`;
    await deps.repo.uploadMedia(mediaPath, photo);
  } else if (!text) {
    throw new OrderError("Add a photo, a video or a caption.");
  }
  await deps.repo.addUpdate({ orderId: order.id, kind: photo ? "photo" : "note", caption: text, mediaPath });
  await sendSafely(deps.mailer, photoUpdateEmail(order, text, orderLink(deps.baseUrl, order.id)));
}

const VIDEO_EXT: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

/** Step 1 of a video update: a signed link so the browser uploads straight to storage. */
export async function startVideoUpload(deps: Pick<Deps, "repo">, orderId: string, contentType: string, size: number) {
  const order = await deps.repo.getOrderById(orderId);
  if (!order) throw new OrderError("Order not found.", 404);
  if (!(VIDEO_TYPES as readonly string[]).includes(contentType)) throw new OrderError("Please choose an MP4, MOV or WebM video.");
  if (size <= 0 || size > MAX_VIDEO_BYTES) throw new OrderError("Videos must be under 50 MB.");
  const path = `orders/${order.id}/update-${randomUUID()}.${VIDEO_EXT[contentType]}`;
  return { path, target: await deps.repo.createUploadTarget(path, contentType) };
}

/** Step 2: check what was uploaded, then post it to the customer's tracker. */
export async function finishVideoUpload(deps: LightDeps, orderId: string, path: string, caption: string) {
  const order = await deps.repo.getOrderById(orderId);
  if (!order) throw new OrderError("Order not found.", 404);
  if (!new RegExp(`^orders/${order.id}/update-[0-9a-f-]{36}\\.(mp4|mov|webm)$`).test(path)) {
    throw new OrderError("That upload does not belong to this order.");
  }
  const head = await deps.repo.readMediaHead(path, 32);
  if (!head) throw new OrderError("The video did not finish uploading. Please try again.");
  if (!magicMatches(head.bytes, head.contentType)) {
    await deps.repo.deleteMedia(path);
    throw new OrderError("That file does not look like a valid video.");
  }
  const text = caption.trim().slice(0, 300);
  await deps.repo.addUpdate({ orderId: order.id, kind: "video", caption: text, mediaPath: path });
  await sendSafely(deps.mailer, photoUpdateEmail(order, text, orderLink(deps.baseUrl, order.id)));
}

