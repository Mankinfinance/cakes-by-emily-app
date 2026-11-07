import type Stripe from "stripe";
import { json, lightDeps } from "@/lib/http";
import { handlePaidSession } from "@/lib/services/orders";
import { stripe } from "@/lib/services/payments";

// Stripe calls this when a checkout finishes. The signature check proves the
// request really came from Stripe; nothing is trusted until it passes.
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) return json({ error: "Not configured" }, 400);

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, secret);
  } catch {
    return json({ error: "Invalid signature" }, 400);
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status === "paid") {
      try {
        await handlePaidSession(await lightDeps(request), event.id, session.id);
      } catch (err) {
        console.error("Webhook handling failed", err);
        // A 500 makes Stripe retry later. Handling is idempotent, so retries are safe.
        return json({ error: "Temporary failure" }, 500);
      }
    }
  }
  return json({ received: true });
}
