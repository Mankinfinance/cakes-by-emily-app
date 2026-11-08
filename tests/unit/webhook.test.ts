// Exercises the real Stripe webhook route with Stripe's own signing helper.
// No network calls: signature checks happen locally in the Stripe library.

import Stripe from "stripe";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const WEBHOOK_SECRET = "whsec_test_secret_for_unit_tests";
process.env.DATA_ADAPTER = "memory";
process.env.STRIPE_SECRET_KEY = "sk_test_unit_tests_only";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.NEXT_PUBLIC_SITE_URL = "https://cakes.test";

const { POST } = await import("@/app/api/stripe/webhook/route");
const { GET: cron } = await import("@/app/api/cron/reminders/route");
const { memoryRepository: repo, resetMemoryStore } = await import("@/lib/data/memory");
const { hashToken, orderToken } = await import("@/lib/services/tokens");

const stripe = new Stripe("sk_test_unit_tests_only");

function signedRequest(payload: object, secret = WEBHOOK_SECRET) {
  const body = JSON.stringify(payload);
  const header = stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  return new Request("https://cakes.test/api/stripe/webhook", {
    method: "POST",
    body,
    headers: { "stripe-signature": header, "content-type": "application/json" },
  });
}

function event(id: string, sessionId: string, paymentStatus = "paid") {
  return {
    id,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: sessionId, object: "checkout.session", payment_status: paymentStatus } },
  };
}

let orderId = "";

beforeEach(async () => {
  resetMemoryStore();
  orderId = crypto.randomUUID();
  await repo.createOrder({
    id: orderId,
    reference: "CBE-TEST1",
    tokenHash: hashToken(orderToken(orderId)),
    stage: "awaiting_payment",
    customerName: "Sam",
    email: "sam@example.com",
    phone: "0400000000",
    marketingOptIn: false,
    pickupDate: "2026-11-20",
    pickupSlot: "10:00",
    config: { occasion: "occ-birthday", size: "size-6-round", flavour: "fl-vanilla", finish: "fin-buttercream", colour: "col-blush", decorations: [], extras: [], topperText: "" },
    allergyNotes: "",
    notes: "",
    inspirationPath: null,
    items: [],
    subtotalCents: 13000,
    rushFeeCents: 0,
    peakSurchargeCents: 0,
    totalCents: 13000,
    depositCents: 6500,
    isRush: false,
    termsAcceptedAt: new Date().toISOString(),
    dietary: [],
    remindNextYear: false,
    waitlistId: null,
    referralCode: null,
    stampReward: false,
  });
  await repo.createPayment({ orderId, boxOrderId: null, voucherId: null, kind: "deposit", amountCents: 6500, stripeSessionId: "cs_test_abc" });
});

describe("Stripe webhook route", () => {
  beforeAll(() => {
    expect(process.env.STRIPE_WEBHOOK_SECRET).toBe(WEBHOOK_SECRET);
  });

  it("accepts a correctly signed event and marks the deposit paid", async () => {
    const res = await POST(signedRequest(event("evt_1", "cs_test_abc")));
    expect(res.status).toBe(200);
    const order = await repo.getOrderById(orderId);
    expect(order?.amountPaidCents).toBe(6500);
    expect(order?.stage).toBe("received");
  });

  it("does not double count when Stripe retries", async () => {
    await POST(signedRequest(event("evt_1", "cs_test_abc")));
    await POST(signedRequest(event("evt_1", "cs_test_abc")));
    await POST(signedRequest(event("evt_2", "cs_test_abc")));
    expect((await repo.getOrderById(orderId))?.amountPaidCents).toBe(6500);
  });

  it("rejects a bad or missing signature", async () => {
    const forged = await POST(signedRequest(event("evt_x", "cs_test_abc"), "whsec_wrong"));
    expect(forged.status).toBe(400);
    const missing = await POST(new Request("https://cakes.test/api/stripe/webhook", { method: "POST", body: "{}" }));
    expect(missing.status).toBe(400);
    expect((await repo.getOrderById(orderId))?.amountPaidCents).toBe(0);
  });

  it("activates a gift voucher when its payment arrives", async () => {
    const voucherId = crypto.randomUUID();
    await repo.createVoucher({
      id: voucherId,
      kind: "gift",
      codeHash: "hash-v1",
      codeLast4: "ABCD",
      amountCents: 5000,
      balanceCents: 0,
      status: "pending",
      buyerName: "Kim",
      buyerEmail: "kim@example.com",
      recipientName: "Lee",
      recipientEmail: "",
      message: "",
      expiresOn: "2027-11-07",
      sourceOrderId: null,
    });
    await repo.createPayment({ orderId: null, boxOrderId: null, voucherId, kind: "voucher", amountCents: 5000, stripeSessionId: "cs_test_voucher" });
    const res = await POST(signedRequest(event("evt_v", "cs_test_voucher")));
    expect(res.status).toBe(200);
    const v = await repo.getVoucherById(voucherId);
    expect(v).toMatchObject({ status: "active", balanceCents: 5000 });
  });

  it("ignores unpaid sessions", async () => {
    await POST(signedRequest(event("evt_3", "cs_test_abc", "unpaid")));
    expect((await repo.getOrderById(orderId))?.amountPaidCents).toBe(0);
  });
});

describe("reminders cron route", () => {
  it("requires the cron secret", async () => {
    process.env.CRON_SECRET = "a-long-cron-secret-for-tests";
    const no = await cron(new Request("https://cakes.test/api/cron/reminders"));
    expect(no.status).toBe(401);
    const yes = await cron(
      new Request("https://cakes.test/api/cron/reminders", { headers: { authorization: "Bearer a-long-cron-secret-for-tests" } }),
    );
    expect(yes.status).toBe(200);
  });

  it("refuses to run when the secret is missing or too short", async () => {
    process.env.CRON_SECRET = "short";
    const res = await cron(new Request("https://cakes.test/api/cron/reminders", { headers: { authorization: "Bearer short" } }));
    expect(res.status).toBe(401);
  });
});
