// Corporate packages: logo cookies and cupcakes in set quantities, with a
// deposit up front and the balance before pickup.

import { randomUUID } from "node:crypto";
import { BUSINESS } from "../config";
import { checkBooking } from "../domain/availability";
import { percentOfRoundedDollar } from "../domain/money";
import type { CorporateOrder } from "../domain/types";
import { checkUpload, MAX_PHOTO_BYTES, type CorporateRequest } from "../validation";
import { calendarContext } from "./calendar";
import { corporateLink, nowOf, OrderError, type Deps } from "./common";
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
  const checkout = await deps.payments.createCheckout({
    targetId: id,
    reference: order.reference,
    kind: "corporate_deposit",
    amountCents: deposit,
    description: `${BUSINESS.name}: ${pkg.name} for ${req.companyName} (deposit)`,
    customerEmail: req.email,
    successUrl: `${link}?paid=1`,
    cancelUrl: `${deps.baseUrl}/corporate?cancelled=1`,
  });
  await repo.createPayment({ orderId: null, boxOrderId: null, voucherId: null, corporateOrderId: id, kind: "corporate_deposit", amountCents: deposit, stripeSessionId: checkout.id });
  return { order, checkoutUrl: checkout.url };
}

export async function startCorporateBalance(deps: Deps, order: CorporateOrder): Promise<string> {
  const owing = Math.max(0, order.totalCents - order.amountPaidCents);
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
