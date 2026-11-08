// Seasonal box pre-orders: stock is taken atomically when the customer
// starts checkout and put back if they don't pay.

import { randomUUID } from "node:crypto";
import { BUSINESS } from "../config";
import { slotTimes } from "../domain/availability";
import { boxOrderable, boxPickupOk } from "../domain/boxes";
import { todayInBusinessTz, weekday } from "../domain/dates";
import type { BoxOrderRequest } from "../validation";
import { boxLink, nowOf, OrderError, type Deps } from "./common";
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
    const checkout = await deps.payments.createCheckout({
      targetId: id,
      reference: order.reference,
      kind: "box",
      amountCents: order.totalCents,
      description: `${BUSINESS.name}: ${order.quantity} x ${box.name}`,
      customerEmail: order.email,
      successUrl: `${link}?paid=1`,
      cancelUrl: `${deps.baseUrl}/boxes?cancelled=1`,
    });
    await repo.createPayment({ orderId: null, boxOrderId: id, voucherId: null, kind: "box", amountCents: order.totalCents, stripeSessionId: checkout.id });
    return { order, checkoutUrl: checkout.url };
  } catch (err) {
    // Put the stock back if checkout could not start.
    await repo.cancelBoxOrder(id, true);
    throw err;
  }
}
