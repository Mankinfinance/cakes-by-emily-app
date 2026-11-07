// Order workflows. Every function takes its dependencies as arguments so the
// same code runs against Supabase in production and the memory adapter in tests.

import { randomUUID } from "node:crypto";
import { BUSINESS } from "../config";
import { buildLoad, checkBooking, dateStatus, slotsFor, type CalendarContext } from "../domain/availability";
import { addDays, daysBetween, monthDays, todayInBusinessTz } from "../domain/dates";
import { balanceOwing, priceCake, PricingError } from "../domain/pricing";
import { nextStage, STAGE_MESSAGES } from "../domain/stages";
import type { Order, Stage } from "../domain/types";
import { sanitizeConfig, visibleItems } from "../domain/visibility";
import type { Repository } from "../data/repository";
import type { OrderRequest } from "../validation";
import { checkUpload, IMAGE_TYPES, magicMatches, MAX_PHOTO_BYTES, MAX_VIDEO_BYTES, VIDEO_TYPES } from "../validation";
import {
  balanceReceiptEmail,
  balanceReminderEmail,
  customerConfirmationEmail,
  newOrderAlertEmail,
  photoUpdateEmail,
  pickupDetailsEmail,
  sendSafely,
  stageEmail,
  type Mailer,
} from "./email";
import type { PaymentsGateway } from "./payments";
import { hashToken, newReference, orderToken } from "./tokens";

export class OrderError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface Deps {
  repo: Repository;
  payments: PaymentsGateway;
  mailer: Mailer;
  baseUrl: string;
  now?: Date;
}

export const orderLink = (baseUrl: string, orderId: string) => `${baseUrl}/o/${orderToken(orderId)}`;
export const adminLink = (baseUrl: string, orderId: string) => `${baseUrl}/admin/orders/${orderId}`;

export async function calendarContext(repo: Repository, now = new Date()): Promise<CalendarContext> {
  const today = todayInBusinessTz(now);
  const [settings, daysOff, peakDates] = await Promise.all([repo.getSettings(), repo.listDaysOff(), repo.listPeakDates()]);
  // Weekly caps look back up to 6 days, so load a little either side of the horizon.
  const bookings = await repo.listActiveBookings(addDays(today, -7), addDays(today, settings.bookingHorizonDays + 7));
  return { today, settings, daysOff, peakDates, load: buildLoad(bookings) };
}

export async function monthAvailability(repo: Repository, month: string, now = new Date()) {
  const ctx = await calendarContext(repo, now);
  return {
    today: ctx.today,
    days: monthDays(month).map((date) => {
      const s = dateStatus(date, ctx);
      return {
        date,
        state: s.state,
        bookable: s.bookable,
        isRush: s.isRush,
        label: s.label,
        peakSurchargeCents: s.peak?.surchargeCents ?? 0,
        peakLabel: s.peak?.label ?? null,
      };
    }),
  };
}

export async function slotAvailability(repo: Repository, date: string, now = new Date()) {
  const ctx = await calendarContext(repo, now);
  const status = dateStatus(date, ctx);
  return { status: status.state, bookable: status.bookable, slots: status.bookable ? slotsFor(date, ctx) : [] };
}

export interface Upload {
  bytes: Uint8Array;
  contentType: string;
}

export async function createOrder(deps: Deps, req: OrderRequest, inspiration: Upload | null) {
  const { repo } = deps;
  const now = deps.now ?? new Date();
  const [catalogue, ctx] = await Promise.all([repo.listCatalogue(), calendarContext(repo, now)]);

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

  let price;
  try {
    price = priceCake(config, visibleItems(catalogue), ctx.settings, {
      isRush: booking.status.isRush,
      peakSurchargeCents: booking.status.peak?.surchargeCents ?? 0,
      peakLabel: booking.status.peak?.label,
    });
  } catch (e) {
    if (e instanceof PricingError) throw new OrderError(e.message);
    throw e;
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
  const order = await repo.createOrder({
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
  });

  const link = orderLink(deps.baseUrl, order.id);
  const checkout = await deps.payments.createCheckout({
    orderId: order.id,
    reference: order.reference,
    kind: "deposit",
    amountCents: price.depositCents,
    description: price.isRush
      ? `${BUSINESS.name} order ${order.reference} (paid in full, rush)`
      : `${BUSINESS.name} order ${order.reference} (deposit)`,
    customerEmail: order.email,
    successUrl: `${link}?paid=1`,
    cancelUrl: `${deps.baseUrl}/order?cancelled=1`,
  });
  await repo.createPayment({ orderId: order.id, kind: "deposit", amountCents: price.depositCents, stripeSessionId: checkout.id });
  return { order, checkoutUrl: checkout.url, token };
}

export async function startBalancePayment(deps: Deps, order: Order) {
  const owing = balanceOwing(order);
  if (order.stage === "cancelled" || order.stage === "awaiting_payment") throw new OrderError("This order cannot take a payment right now.");
  if (owing <= 0) throw new OrderError("This order is already paid in full.");
  const link = orderLink(deps.baseUrl, order.id);
  const checkout = await deps.payments.createCheckout({
    orderId: order.id,
    reference: order.reference,
    kind: "balance",
    amountCents: owing,
    description: `${BUSINESS.name} order ${order.reference} (balance)`,
    customerEmail: order.email,
    successUrl: `${link}?paid=1`,
    cancelUrl: link,
  });
  await deps.repo.createPayment({ orderId: order.id, kind: "balance", amountCents: owing, stripeSessionId: checkout.id });
  return checkout.url;
}

/** Called from the Stripe webhook (and the test checkout). Safe to call twice. */
export async function handlePaidSession(deps: Omit<Deps, "payments">, eventId: string, sessionId: string): Promise<boolean> {
  const { repo, mailer } = deps;
  const payment = await repo.getPaymentBySession(sessionId);
  if (!payment) return false;
  const first = await repo.recordPaymentOnce(eventId, sessionId);
  if (!first) return false;
  const order = await repo.getOrderById(payment.orderId);
  if (!order) return true;
  const link = orderLink(deps.baseUrl, order.id);
  if (payment.kind === "deposit") {
    await sendSafely(mailer, customerConfirmationEmail(order, link));
    const alertTo = process.env.ADMIN_NOTIFY_EMAIL;
    if (alertTo) await sendSafely(mailer, newOrderAlertEmail(order, adminLink(deps.baseUrl, order.id), alertTo));
  } else {
    await sendSafely(mailer, balanceReceiptEmail(order, link));
  }
  return true;
}

export async function advanceStage(deps: Omit<Deps, "payments">, orderId: string): Promise<Stage> {
  const order = await deps.repo.getOrderById(orderId);
  if (!order) throw new OrderError("Order not found.", 404);
  const next = nextStage(order.stage);
  if (!next) throw new OrderError("This order has no next step.");
  await deps.repo.setStage(order.id, next);
  await deps.repo.addUpdate({ orderId: order.id, kind: "stage", caption: STAGE_MESSAGES[next] ?? "", mediaPath: null });
  await sendSafely(deps.mailer, stageEmail(order, next, orderLink(deps.baseUrl, order.id)));
  return next;
}

export async function cancelOrder(deps: Omit<Deps, "payments">, orderId: string): Promise<void> {
  const order = await deps.repo.getOrderById(orderId);
  if (!order) throw new OrderError("Order not found.", 404);
  if (order.stage === "collected") throw new OrderError("A collected order cannot be cancelled.");
  await deps.repo.setStage(order.id, "cancelled");
  await deps.repo.addUpdate({ orderId: order.id, kind: "stage", caption: "This order was cancelled.", mediaPath: null });
}

/** A photo (sent through the website) or a text-only note. */
export async function postUpdate(
  deps: Omit<Deps, "payments">,
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
export async function finishVideoUpload(deps: Omit<Deps, "payments">, orderId: string, path: string, caption: string) {
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

/** Daily job: balance reminders and pickup details. Safe to run more than once a day. */
export async function runReminders(deps: Omit<Deps, "payments">, pickupDetails: string): Promise<{ balance: number; pickup: number }> {
  const today = todayInBusinessTz(deps.now ?? new Date());
  const settings = await deps.repo.getSettings();
  const orders = await deps.repo.listOrders();
  let balance = 0;
  let pickup = 0;
  for (const o of orders) {
    if (o.stage === "cancelled" || o.stage === "collected" || o.stage === "awaiting_payment") continue;
    const daysOut = daysBetween(today, o.pickupDate);
    if (daysOut < 0) continue;
    const link = orderLink(deps.baseUrl, o.id);
    if (daysOut <= settings.balanceDueDays && balanceOwing(o) > 0 && !o.remindersSent.includes("balance")) {
      if (await sendSafely(deps.mailer, balanceReminderEmail(o, link))) {
        await deps.repo.markReminderSent(o.id, "balance");
        balance++;
      }
    }
    if (daysOut === 1 && !o.remindersSent.includes("pickup")) {
      if (await sendSafely(deps.mailer, pickupDetailsEmail(o, link, pickupDetails))) {
        await deps.repo.markReminderSent(o.id, "pickup");
        pickup++;
      }
    }
  }
  return { balance, pickup };
}
