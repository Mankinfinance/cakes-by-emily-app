// Stripe Checkout. Customers type card details on Stripe's own page, so this
// website never sees or stores card numbers.

import Stripe from "stripe";

export interface CheckoutRequest {
  /** The cake order, box order or voucher being paid for. */
  targetId: string;
  reference: string;
  kind: import("../domain/types").Payment["kind"];
  amountCents: number;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentsGateway {
  readonly mode: "stripe" | "fake";
  createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }>;
}

let stripeClient: Stripe | null = null;

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  stripeClient ??= new Stripe(key);
  return stripeClient;
}

export const stripeGateway: PaymentsGateway = {
  mode: "stripe",
  async createCheckout(req) {
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        currency: "aud",
        customer_email: req.customerEmail,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "aud",
              unit_amount: req.amountCents,
              product_data: { name: req.description },
            },
          },
        ],
        metadata: { targetId: req.targetId, kind: req.kind, reference: req.reference },
        payment_intent_data: { metadata: { targetId: req.targetId, kind: req.kind, reference: req.reference } },
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        // Stripe's minimum. Matches the 30 minute slot hold.
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
      { idempotencyKey: `${req.targetId}-${req.kind}-${req.amountCents}-${Math.floor(Date.now() / 60000)}` },
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return { id: session.id, url: session.url };
  },
};

/**
 * A stand-in used only by automated tests on the memory adapter when no
 * Stripe key is set. It sends the browser to a local "test checkout" page.
 */
export const fakeGateway: PaymentsGateway = {
  mode: "fake",
  async createCheckout(req) {
    const id = `cs_fake_${crypto.randomUUID().replace(/-/g, "")}`;
    const url = `/checkout/test?session=${id}&amount=${req.amountCents}&next=${encodeURIComponent(req.successUrl)}`;
    return { id, url };
  },
};

export function fakePaymentsAllowed(): boolean {
  return process.env.DATA_ADAPTER === "memory" && !process.env.STRIPE_SECRET_KEY;
}

export function getPayments(): PaymentsGateway {
  if (process.env.STRIPE_SECRET_KEY) return stripeGateway;
  if (fakePaymentsAllowed()) return fakeGateway;
  throw new Error("STRIPE_SECRET_KEY is not set.");
}
