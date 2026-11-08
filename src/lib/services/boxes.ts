// Seasonal box pre-orders: stock is taken atomically when the customer
// starts checkout and put back if they don't pay.

import { randomUUID } from "node:crypto";
import { BUSINESS } from "../config";
import { slotTimes } from "../domain/availability";
import { boxOrderable, boxPickupOk } from "../domain/boxes";
import { todayInBusinessTz, weekday } from "../domain/dates";
import type { BoxOrderRequest } from "../validation";
import { adminEmail, boxLink, nowOf, OrderError, type Deps, type LightDeps } from "./common";
import { boxAlertEmail, boxConfirmationEmail, sendSafely } from "./email";
import { refundTarget } from "./refunds";
import { giveBackVoucherFor, precheckVoucher } from "./vouchers";
import { boxToken, hashToken, newReference } from "./tokens";

export async function createBoxOrder(deps: Deps, req: BoxOrderRequest) {
  const { repo } = deps;
  const today = todayInBusinessTz(nowOf(deps));
  const [box, settings, daysOff] = await Promise.all([repo.getBox(req.boxId), repo.getSettings(), repo.listDaysOff()]);
  if (!box || !boxOrderable(box, today)) throw new OrderError("Sorry, that box isn't available to order right now.", 409);
  if (!boxPickupOk(box, req.pickupDate, today)) throw new OrderError("Please choose a pickup date inside the pickup window.");
  if (settings.closedWeekdays.includes(weekday(req.pickupDate)) || daysOff.some((d) => d.date === req.pickupDate)) {
    throw new OrderError("Emily is closed that day. Please choose another pickup date.");
  }
  if (!slotTimes(settings).includes(req.pickupSlot)) throw new OrderError("Please choose a pickup time.");
  const voucherHash = await precheckVoucher(repo, req.voucherCode, today);

  if (!(await repo.reserveBoxStock(box.id, req.quantity, today))) {
    throw new OrderError("Sorry, there aren't enough of those left. Try a smaller quantity.", 409);
  }

  const id = randomUUID();
  const order = await repo.createBoxOrder({
    id,
    reference: newReference("BOX"),
    tokenHash: hashToken(boxToken(id)),
    boxId: box.id,
    boxName: box.name,
    quantity: req.quantity,
    unitPriceCents: box.priceCents,
    totalCents: box.priceCents * req.quantity,
    customerName: req.customerName,
    email: req.email,
    phone: req.phone,
    marketingOptIn: req.marketingOptIn,
    pickupDate: req.pickupDate,
    pickupSlot: req.pickupSlot,
  });

  try {
    const link = boxLink(deps.baseUrl, id);
    let applied = 0;
    if (voucherHash) {
      applied = await repo.redeemVoucherFor("box", voucherHash, id, order.totalCents, today);
      if (applied === 0) throw new OrderError("Sorry, that voucher code could not be used. Please check it and try again.");
    }
    const payNow = order.totalCents - applied;
    if (payNow <= 0) {
      await repo.markBoxPaidWithoutPayment(id);
      const paid = (await repo.getBoxOrderById(id))!;
      await sendSafely(deps.mailer, boxConfirmationEmail(paid, link));
      const to = adminEmail();
      if (to) await sendSafely(deps.mailer, boxAlertEmail(paid, to));
      return { order: paid, checkoutUrl: `${link}?paid=1` };
    }
    const checkout = await deps.payments.createCheckout({
      targetId: id,
      reference: order.reference,
      kind: "box",
      amountCents: payNow,
      description: `${BUSINESS.name}: ${order.quantity} x ${box.name}`,
      customerEmail: order.email,
      successUrl: `${link}?paid=1`,
      cancelUrl: `${deps.baseUrl}/boxes?cancelled=1`,
    });
    await repo.createPayment({ orderId: null, boxOrderId: id, voucherId: null, kind: "box", amountCents: payNow, stripeSessionId: checkout.id });
    return { order, checkoutUrl: checkout.url };
  } catch (err) {
    // Put the stock (and any voucher) back if checkout could not start.
    await repo.cancelBoxOrder(id, true);
    await repo.returnVoucherFor("box", id, today);
    throw err;
  }
}

/** Emily cancels a pre-order: stock and voucher back, the cash refunded (automatically when switched on). */
export async function cancelBoxByEmily(deps: LightDeps, id: string): Promise<{ refundCents: number; autoRefundedCents: number }> {
  const bo = await deps.repo.getBoxOrderById(id);
  if (!bo) throw new OrderError("Pre-order not found.", 404);
  if (!(await deps.repo.cancelBoxOrder(bo.id, false))) throw new OrderError("This pre-order can't be cancelled.");
  await giveBackVoucherFor(deps, "box", bo.id, { email: bo.email, name: bo.customerName, reference: bo.reference });
  const refund = await refundTarget(deps, "box", bo.id, bo.amountPaidCents, "cancel-emily", `pre-order ${bo.reference}`);
  return { refundCents: bo.amountPaidCents, autoRefundedCents: refund.refundedCents };
}
