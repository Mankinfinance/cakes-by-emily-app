// Corporate packages: logo cookies and cupcakes in set quantities, with a
// deposit up front and the balance before pickup.

import { randomUUID } from "node:crypto";
import { BUSINESS } from "../config";
import { checkBooking } from "../domain/availability";
import { percentOfRoundedDollar } from "../domain/money";
import type { CorporateOrder } from "../domain/types";
import { checkUpload, MAX_PHOTO_BYTES, type CorporateRequest } from "../validation";
import { calendarContext } from "./calendar";
import { todayInBusinessTz } from "../domain/dates";
import { adminEmail, corporateLink, nowOf, OrderError, type Deps, type LightDeps } from "./common";
import { corporateAlertEmail, corporateConfirmationEmail, sendSafely } from "./email";
import { refundTarget } from "./refunds";
import { giveBackVoucherFor, precheckVoucher } from "./vouchers";
import { hashToken, linkToken, newReference } from "./tokens";

/** SVG logos can carry scripts, so only plain images are accepted. */
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export async function createCorporateOrder(deps: Deps, req: CorporateRequest, logo: { bytes: Uint8Array; contentType: string } | null) {
  const { repo } = deps;
  const now = nowOf(deps);
  const [packages, ctx] = await Promise.all([repo.listCorporatePackages(), calendarContext(repo, now)]);
  const pkg = packages.find((p) => p.id === req.packageId && p.visible);
  if (!pkg) throw new OrderError("Sorry, that package isn't available right now.", 409);
  const booking = checkBooking(req.pickupDate, req.pickupSlot, ctx);
  if (!booking.ok) throw new OrderError(booking.reason, 409);
  if (booking.status.isRush) throw new OrderError("Corporate orders need the standard notice. Please choose a later date.");
  const today = todayInBusinessTz(now);
  const voucherHash = await precheckVoucher(repo, req.voucherCode, today);

  const id = randomUUID();
  let logoPath: string | null = null;
  if (logo) {
    const check = checkUpload(logo.bytes, logo.contentType, LOGO_TYPES, MAX_PHOTO_BYTES);
    if (!check.ok) throw new OrderError(check.reason === "That file type is not supported." ? "Please upload the logo as a PNG, JPG or WebP image." : check.reason);
    logoPath = `corporate/${id}/logo-${randomUUID()}.${check.ext}`;
    await repo.uploadMedia(logoPath, logo);
  }

  const deposit = Math.min(pkg.priceCents, percentOfRoundedDollar(pkg.priceCents, ctx.settings.depositPercent));
  const order = await repo.createCorporateOrder({
    id,
    reference: newReference("CORP"),
    tokenHash: hashToken(linkToken("corporate", id)),
    packageId: pkg.id,
    packageName: pkg.name,
    quantity: pkg.quantity,
    totalCents: pkg.priceCents,
    depositCents: deposit,
    companyName: req.companyName,
    abn: req.abn,
    contactName: req.contactName,
    email: req.email,
    phone: req.phone,
    logoPath,
    notes: req.notes,
    pickupDate: req.pickupDate,
    pickupSlot: req.pickupSlot,
    termsAcceptedAt: now.toISOString(),
  });
  const link = corporateLink(deps.baseUrl, id);
  // A voucher comes off the deposit first, then the balance.
  let applied = 0;
  if (voucherHash) {
    applied = await repo.redeemVoucherFor("corporate", voucherHash, id, pkg.priceCents, today);
    if (applied === 0) {
      await repo.setCorporateStatus(id, "cancelled", ["awaiting_payment"]);
      throw new OrderError("Sorry, that voucher code could not be used. Please check it and try again.");
    }
  }
  const payNow = Math.max(0, deposit - applied);
  if (payNow === 0) {
    await repo.setCorporateStatus(id, "confirmed", ["awaiting_payment"]);
    const confirmed = (await repo.getCorporateOrderById(id))!;
    await sendSafely(deps.mailer, corporateConfirmationEmail(confirmed, link));
    const to = adminEmail();
    if (to) await sendSafely(deps.mailer, corporateAlertEmail(confirmed, to));
    return { order: confirmed, checkoutUrl: `${link}?paid=1` };
  }
  const checkout = await deps.payments.createCheckout({
    targetId: id,
    reference: order.reference,
    kind: "corporate_deposit",
    amountCents: payNow,
    description: `${BUSINESS.name}: ${pkg.name} for ${req.companyName} (deposit)`,
    customerEmail: req.email,
    successUrl: `${link}?paid=1`,
    cancelUrl: `${deps.baseUrl}/corporate?cancelled=1`,
  });
  await repo.createPayment({ orderId: null, boxOrderId: null, voucherId: null, corporateOrderId: id, kind: "corporate_deposit", amountCents: payNow, stripeSessionId: checkout.id });
  return { order, checkoutUrl: checkout.url };
}

export function corporateOwing(o: Pick<CorporateOrder, "totalCents" | "amountPaidCents" | "voucherAppliedCents">): number {
  return Math.max(0, o.totalCents - o.amountPaidCents - (o.voucherAppliedCents ?? 0));
}

/** Emily cancels a corporate order: voucher back, the cash refunded (automatically when switched on). */
export async function cancelCorporate(deps: LightDeps, id: string): Promise<{ refundCents: number; autoRefundedCents: number }> {
  const c = await deps.repo.getCorporateOrderById(id);
  if (!c) throw new OrderError("Order not found.", 404);
  if (!(await deps.repo.setCorporateStatus(c.id, "cancelled", ["awaiting_payment", "confirmed", "ready"]))) throw new OrderError("That change isn't possible for this order now.");
  await giveBackVoucherFor(deps, "corporate", c.id, { email: c.email, name: c.contactName, reference: c.reference });
  const refund = await refundTarget(deps, "corporate", c.id, c.amountPaidCents, "cancel-emily", `corporate order ${c.reference}`);
  return { refundCents: c.amountPaidCents, autoRefundedCents: refund.refundedCents };
}

export async function startCorporateBalance(deps: Deps, order: CorporateOrder): Promise<string> {
  const owing = corporateOwing(order);
  if (order.status === "awaiting_payment" || order.status === "cancelled") throw new OrderError("This order cannot take a payment right now.");
  if (owing <= 0) throw new OrderError("This order is already paid in full.");
  const link = corporateLink(deps.baseUrl, order.id);
  const checkout = await deps.payments.createCheckout({
    targetId: order.id,
    reference: order.reference,
    kind: "corporate_balance",
    amountCents: owing,
    description: `${BUSINESS.name}: ${order.packageName} (balance)`,
    customerEmail: order.email,
    successUrl: `${link}?paid=1`,
    cancelUrl: link,
  });
  await deps.repo.createPayment({ orderId: null, boxOrderId: null, voucherId: null, corporateOrderId: order.id, kind: "corporate_balance", amountCents: owing, stripeSessionId: checkout.id });
  return checkout.url;
}
