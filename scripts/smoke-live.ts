// Live smoke test for a deployed site in Stripe TEST mode.
//
//   SMOKE_BASE_URL=https://your-site.vercel.app \
//   STRIPE_SECRET_KEY=sk_test_... \
//   SMOKE_CONFIRM=yes \
//   npm run smoke:live
//
// It places one clearly marked test order through the public API, waits for
// you to pay it on Stripe's test checkout (card 4242 4242 4242 4242, any
// future date, any CVC), checks the webhook marked it paid, checks the order
// link works, then cancels the order (its own clean up) and checks whether
// Stripe made a refund. It refuses to run with a live key.
//
// Stripe doesn't let a script pay a Checkout page by itself, so the payment
// step is the one thing you do by hand: open the link it prints.

import Stripe from "stripe";
import {
  nextMonths,
  orderTokenFromUrl,
  pickDateAndSlot,
  resultsTable,
  sessionIdFromCheckoutUrl,
  smokeExitCode,
  smokeGuard,
  smokeOrderPayload,
  type StepResult,
} from "../src/lib/smoke";

const env = process.env;
const problems = smokeGuard(env);
if (problems.length) {
  console.error("Smoke test not started:\n- " + problems.join("\n- "));
  process.exit(2);
}

const base = env.SMOKE_BASE_URL!.replace(/\/$/, "");
const stripe = new Stripe(env.STRIPE_SECRET_KEY!);
const waitMinutes = Number(env.SMOKE_WAIT_MINUTES ?? 10);
const rows: StepResult[] = [];
const pass = (step: string, detail: string) => rows.push({ step, status: "PASS", detail });
const fail = (step: string, detail: string) => rows.push({ step, status: "FAIL", detail });
const skip = (step: string, detail: string) => rows.push({ step, status: "SKIP", detail });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return (await res.json()) as T;
}

async function main() {
  // 1. The site answers.
  const home = await fetch(base).catch((e: Error) => e);
  if (home instanceof Error || !home.ok) {
    fail("Site answers", home instanceof Error ? home.message : `status ${home.status}`);
    return;
  }
  pass("Site answers", base);

  // 2. Find a normal (not rush, not peak) date and slot.
  type Day = { date: string; bookable: boolean; isRush: boolean; peakSurchargeCents: number };
  let pick: { date: string; slot: string } | null = null;
  try {
    const first = await getJson<{ today: string; days: Day[] }>(`/api/availability?month=${new Date().toISOString().slice(0, 7)}`);
    const days: Day[] = [];
    for (const m of nextMonths(first.today, 3)) days.push(...(await getJson<{ days: Day[] }>(`/api/availability?month=${m}`)).days);
    const slots = new Map<string, { time: string; available: boolean }[]>();
    for (const d of days.filter((x) => x.bookable && !x.isRush && !x.peakSurchargeCents).slice(0, 10)) {
      slots.set(d.date, (await getJson<{ slots: { time: string; available: boolean }[] }>(`/api/slots?date=${d.date}`)).slots);
    }
    pick = pickDateAndSlot(days, (date) => slots.get(date));
  } catch (err) {
    fail("Calendar", (err as Error).message);
    return;
  }
  if (!pick) {
    fail("Calendar", "no bookable date with a free slot in the next 3 months");
    return;
  }
  pass("Calendar", `${pick.date} at ${pick.slot}`);

  // 3. Place the order through the public API.
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const form = new FormData();
  form.set("payload", JSON.stringify(smokeOrderPayload(pick.date, pick.slot, stamp)));
  const res = await fetch(`${base}/api/orders`, { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { checkoutUrl?: string; error?: string };
  if (!res.ok || !body.checkoutUrl) {
    fail("Place order", body.error ?? `status ${res.status}`);
    return;
  }
  const sessionId = sessionIdFromCheckoutUrl(body.checkoutUrl);
  if (!sessionId) {
    fail("Place order", "the checkout link isn't a Stripe test checkout (is the site still in test mode with the pretend checkout?)");
    return;
  }
  pass("Place order", `Stripe session ${sessionId.slice(0, 16)}...`);

  // 4. Find the order link from the session's success URL.
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const token = orderTokenFromUrl(session.success_url ?? "");
  if (!token) {
    fail("Order link", "couldn't read the order link from the Stripe session");
    return;
  }
  pass("Order link", "found in the session's success URL");

  // 5. Pay on Stripe's test checkout (by hand), then wait for Stripe to say it's paid.
  console.log(`\nOpen this link and pay with the test card 4242 4242 4242 4242 (any future date, any CVC):\n\n  ${body.checkoutUrl}\n\nWaiting up to ${waitMinutes} minutes...\n`);
  const deadline = Date.now() + waitMinutes * 60_000;
  let paid: Stripe.Checkout.Session | null = null;
  while (Date.now() < deadline) {
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    if (s.payment_status === "paid") {
      paid = s;
      break;
    }
    await sleep(5000);
  }
  if (!paid) {
    fail("Test payment", `not paid within ${waitMinutes} minutes`);
    return;
  }
  pass("Test payment", `${(paid.amount_total ?? 0) / 100} AUD paid on Stripe`);

  // 6. The webhook reached the site: the order page stops saying it's waiting for the deposit.
  let webhookOk = false;
  for (let i = 0; i < 24 && !webhookOk; i++) {
    const page = await fetch(`${base}/o/${token}`);
    const html = await page.text();
    if (page.ok && !html.includes('data-testid="awaiting"')) webhookOk = true;
    else await sleep(5000);
  }
  if (webhookOk) pass("Webhook marks it paid", "order page shows the deposit");
  else fail("Webhook marks it paid", "the order page still says it's waiting. Check the webhook endpoint and STRIPE_WEBHOOK_SECRET in Vercel, and the webhook's delivery log in Stripe.");

  // 7. The order link works, and a wrong one doesn't.
  const good = await fetch(`${base}/o/${token}`);
  const bad = await fetch(`${base}/o/${token.slice(0, -4)}AAAA`);
  if (good.ok && bad.status === 404) pass("Order link security", "real link opens, altered link is refused");
  else fail("Order link security", `real link ${good.status}, altered link ${bad.status}`);

  // 8. Clean up: cancel the test order under the terms, then see if Stripe refunded it.
  const cancel = await fetch(`${base}/api/orders/${token}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
  const cancelBody = (await cancel.json().catch(() => ({}))) as { summary?: string; error?: string };
  if (!cancel.ok) {
    fail("Cancel test order", cancelBody.error ?? `status ${cancel.status}`);
    return;
  }
  pass("Cancel test order", cancelBody.summary?.slice(0, 80) ?? "cancelled");

  const intent = typeof paid.payment_intent === "string" ? paid.payment_intent : paid.payment_intent?.id;
  if (!intent) {
    skip("Automatic refund", "no PaymentIntent on the session");
    return;
  }
  let refunded = 0;
  for (let i = 0; i < 6; i++) {
    const list = await stripe.refunds.list({ payment_intent: intent, limit: 10 });
    refunded = list.data.filter((r) => r.status === "succeeded" || r.status === "pending").reduce((s, r) => s + r.amount, 0);
    if (refunded > 0) break;
    await sleep(5000);
  }
  if (refunded > 0) pass("Automatic refund", `${refunded / 100} AUD refunded through Stripe`);
  else skip("Automatic refund", "none made: automatic refunds are off (refund the test payment by hand in Stripe), or the terms allowed no refund");
}

main()
  .catch((err) => fail("Unexpected error", err instanceof Error ? err.message : String(err)))
  .finally(() => {
    console.log("\n" + resultsTable(rows));
    process.exit(smokeExitCode(rows));
  });
