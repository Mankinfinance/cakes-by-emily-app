import { beforeEach, describe, expect, it } from "vitest";
import { memoryRepository as repo, resetMemoryStore } from "@/lib/data/memory";
import { outbox, type Mailer } from "@/lib/services/email";
import { cancelWithTerms } from "@/lib/services/changes";
import { runScheduledMessages } from "@/lib/services/messages";
import {
  advanceStage,
  createOrder,
  handlePaidSession,
  monthAvailability,
  OrderError,
  postUpdate,
  slotAvailability,
  startBalancePayment,
  startVideoUpload,
  finishVideoUpload,
} from "@/lib/services/orders";
import { fakeGateway } from "@/lib/services/payments";
import { hashToken, looksLikeToken, newReference, orderToken } from "@/lib/services/tokens";
import { checkUpload, IMAGE_TYPES, orderRequestSchema, type OrderRequest } from "@/lib/validation";

process.env.DATA_ADAPTER = "memory";

const sent: { to: string; subject: string }[] = [];
const mailer: Mailer = {
  async send(e) {
    sent.push({ to: e.to, subject: e.subject });
  },
};

// 10am on Sat 7 Nov 2026 in Sydney.
const NOW = new Date("2026-11-06T23:00:00Z");
const deps = { repo, payments: fakeGateway, mailer, baseUrl: "https://cakes.test", now: NOW };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function request(over: Partial<OrderRequest> = {}): OrderRequest {
  return orderRequestSchema.parse({
    config: {
      occasion: "occ-birthday",
      size: "size-6-round",
      flavour: "fl-vanilla",
      finish: "fin-drip",
      colour: "col-blush",
      decorations: ["dec-topper"],
      extras: [],
      topperText: "Sophia",
    },
    dietary: [],
    pickupDate: "2026-11-20",
    pickupSlot: "10:00",
    customerName: "Sam Taylor",
    email: "Sam@Example.com",
    phone: "0400 000 000",
    allergyNotes: "",
    notes: "",
    marketingOptIn: false,
    acceptTerms: true,
    ...over,
  });
}


async function createAndPay(over: Partial<OrderRequest> = {}) {
  const res = await createOrder(deps, request(over), null);
  const sessionId = new URL(res.checkoutUrl, "https://x").searchParams.get("session")!;
  await handlePaidSession(deps, `evt_${sessionId}`, sessionId);
  return { ...res, sessionId, order: (await repo.getOrderById(res.order.id))! };
}

beforeEach(() => {
  resetMemoryStore();
  sent.length = 0;
  outbox().length = 0;
});

describe("tokens", () => {
  it("builds unguessable links and stores only a hash", async () => {
    const t = orderToken("abc");
    expect(looksLikeToken(t)).toBe(true);
    expect(orderToken("abc")).toBe(t);
    expect(orderToken("abd")).not.toBe(t);
    expect(hashToken(t)).toHaveLength(64);
    expect(newReference()).toMatch(/^CBE-[A-Z2-9]{5}$/);
  });
});

describe("createOrder", () => {
  it("prices on the server, holds the slot and starts a deposit checkout", async () => {
    const { order, checkoutUrl, token } = await createOrder(deps, request(), null);
    // 130 + 25 drip + 20 topper
    expect(order.totalCents).toBe(17500);
    expect(order.depositCents).toBe(8800);
    expect(order.stage).toBe("awaiting_payment");
    expect(order.email).toBe("sam@example.com");
    expect(order.tokenHash).toBe(hashToken(token));
    expect(checkoutUrl).toContain("/checkout/test?session=cs_fake_");
    const slots = await slotAvailability(repo, "2026-11-20", NOW);
    expect(slots.slots.find((s) => s.time === "10:00")?.remaining).toBe(1);
  });

  it("ignores any client-side total because it never reads one", async () => {
    const tampered = { ...request(), totalCents: 1 } as unknown as OrderRequest;
    const { order } = await createOrder(deps, tampered, null);
    expect(order.totalCents).toBe(17500);
  });

  it("rejects hidden options", async () => {
    await repo.updateCatalogueItem("fin-drip", { visible: false });
    await expect(createOrder(deps, request(), null)).rejects.toThrow(/no longer available: Drip/);
  });

  it("rejects options that clash with the chosen dietary needs", async () => {
    await expect(createOrder(deps, request({ dietary: ["egg-free"] }), null)).rejects.toBeInstanceOf(OrderError);
  });

  it("drops topper text when there is no topper", async () => {
    const r = request();
    r.config.decorations = [];
    const { order } = await createOrder(deps, r, null);
    expect(order.config.topperText).toBe("");
  });

  it("refuses full slots, closed days and dates inside the notice without rush", async () => {
    await createAndPay();
    await createAndPay({ email: "b@example.com" });
    await expect(createOrder(deps, request({ email: "c@example.com" }), null)).rejects.toThrow(/full/);
    await expect(createOrder(deps, request({ pickupDate: "2026-11-16" }), null)).rejects.toThrow(/not available/);
    const s = await repo.getSettings();
    await repo.saveSettings({ ...s, rushEnabled: false });
    await expect(createOrder(deps, request({ pickupDate: "2026-11-10" }), null)).rejects.toThrow(/notice/);
  });

  it("charges rush orders in full with the rush fee", async () => {
    const { order } = await createOrder(deps, request({ pickupDate: "2026-11-10" }), null);
    expect(order.isRush).toBe(true);
    expect(order.rushFeeCents).toBe(4000);
    expect(order.depositCents).toBe(order.totalCents);
  });

  it("adds the peak surcharge", async () => {
    const { order } = await createOrder(deps, request({ pickupDate: "2026-12-24" }), null);
    expect(order.peakSurchargeCents).toBe(3000);
    expect(order.items.some((i) => i.name === "Peak date: Christmas Eve")).toBe(true);
  });

  it("validates and stores the inspiration photo", async () => {
    const { order } = await createOrder(deps, request(), { bytes: PNG, contentType: "image/png" });
    expect(order.inspirationPath).toMatch(/^orders\/.+\/inspiration-.+\.png$/);
    expect(await repo.mediaUrl(order.inspirationPath!)).toBeTruthy();
    await expect(
      createOrder(deps, request({ email: "x@example.com" }), { bytes: new Uint8Array([1, 2, 3, 4]), contentType: "image/png" }),
    ).rejects.toThrow(/valid image/);
  });

  it("keeps existing orders unchanged when an item is hidden or repriced later", async () => {
    const { order } = await createAndPay();
    await repo.updateCatalogueItem("fin-drip", { visible: false, priceCents: 9900 });
    const after = (await repo.getOrderById(order.id))!;
    expect(after.items.find((i) => i.itemId === "fin-drip")?.amountCents).toBe(2500);
    expect(after.totalCents).toBe(17500);
  });
});

describe("payments", () => {
  it("marks the deposit paid exactly once and sends the emails", async () => {
    process.env.ADMIN_NOTIFY_EMAIL = "emily@example.com";
    const { order: created, checkoutUrl } = await createOrder(deps, request(), null);
    const session = new URL(checkoutUrl, "https://x").searchParams.get("session")!;
    expect(await handlePaidSession(deps, "evt_1", session)).toBe(true);
    expect(await handlePaidSession(deps, "evt_1", session)).toBe(false); // same event retried
    expect(await handlePaidSession(deps, "evt_2", session)).toBe(false); // different event, same session
    const order = (await repo.getOrderById(created.id))!;
    expect(order.amountPaidCents).toBe(8800);
    expect(order.stage).toBe("received");
    expect(sent.map((s) => s.to)).toEqual(["sam@example.com", "emily@example.com"]);
    expect(sent[1].subject).toMatch(/^New order CBE-/);
    delete process.env.ADMIN_NOTIFY_EMAIL;
  });

  it("ignores unknown sessions", async () => {
    expect(await handlePaidSession(deps, "evt_x", "cs_unknown")).toBe(false);
  });

  it("takes the balance and refuses to overcharge", async () => {
    const { order } = await createAndPay();
    const url = await startBalancePayment(deps, order);
    const session = new URL(url, "https://x").searchParams.get("session")!;
    expect(new URL(url, "https://x").searchParams.get("amount")).toBe("8700");
    await handlePaidSession(deps, "evt_bal", session);
    const paid = (await repo.getOrderById(order.id))!;
    expect(paid.amountPaidCents).toBe(paid.totalCents);
    await expect(startBalancePayment(deps, paid)).rejects.toThrow(/paid in full/);
  });

  it("does not take a balance before the deposit", async () => {
    const { order } = await createOrder(deps, request(), null);
    await expect(startBalancePayment(deps, order)).rejects.toThrow(/cannot take a payment/);
  });
});

describe("Emily's actions", () => {
  it("advances stages, logs updates and emails the customer", async () => {
    const { order } = await createAndPay();
    sent.length = 0;
    expect(await advanceStage(deps, order.id)).toBe("design_confirmed");
    expect(await advanceStage(deps, order.id)).toBe("baking");
    const updates = await repo.listUpdates(order.id);
    expect(updates).toHaveLength(2);
    expect(sent.map((s) => s.subject)).toEqual(["Your cake update: Design confirmed", "Your cake update: Baking"]);
  });

  it("posts photo updates and rejects bad files", async () => {
    const { order } = await createAndPay();
    await postUpdate(deps, order.id, "Layers are baked!", { bytes: PNG, contentType: "image/png" });
    const [u] = await repo.listUpdates(order.id);
    expect(u.kind).toBe("photo");
    expect(u.caption).toBe("Layers are baked!");
    await expect(postUpdate(deps, order.id, "", null)).rejects.toThrow(/Add a photo/);
    await expect(postUpdate(deps, order.id, "x", { bytes: PNG, contentType: "application/pdf" })).rejects.toThrow(/not supported/);
  });

  it("uploads videos directly and checks them before posting", async () => {
    const { order } = await createAndPay();
    await expect(startVideoUpload(deps, order.id, "video/avi", 100)).rejects.toThrow(/MP4/);
    await expect(startVideoUpload(deps, order.id, "video/mp4", 60 * 1024 * 1024)).rejects.toThrow(/50 MB/);
    const { path, target } = await startVideoUpload(deps, order.id, "video/mp4", 1000);
    expect(target.kind).toBe("local");
    await expect(finishVideoUpload(deps, order.id, path, "Decorating!")).rejects.toThrow(/did not finish/);
    await expect(finishVideoUpload(deps, order.id, "orders/other/update-x.mp4", "")).rejects.toThrow(/does not belong/);
    // A fake "video" that is really text is rejected and removed.
    await repo.uploadMedia(path, { bytes: new TextEncoder().encode("not a video at all"), contentType: "video/mp4" });
    await expect(finishVideoUpload(deps, order.id, path, "")).rejects.toThrow(/valid video/);
    expect(await repo.readMediaHead(path, 4)).toBeNull();
    // A real MP4 header passes.
    const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    await repo.uploadMedia(path, { bytes: mp4, contentType: "video/mp4" });
    await finishVideoUpload(deps, order.id, path, "Decorating!");
    const [u] = await repo.listUpdates(order.id);
    expect(u).toMatchObject({ kind: "video", caption: "Decorating!", mediaPath: path });
  });

  it("cancelling frees the slot", async () => {
    const { order } = await createAndPay();
    await cancelWithTerms(deps, order.id, "emily");
    const slots = await slotAvailability(repo, "2026-11-20", NOW);
    expect(slots.slots.find((s) => s.time === "10:00")?.remaining).toBe(2);
  });
});

describe("scheduled messages", () => {
  it("sends the balance reminder 4 days out and pickup details the day before, once each", async () => {
    const { order } = await createAndPay();
    sent.length = 0;
    const at = (iso: string) => ({ ...deps, now: new Date(iso) });
    // 16 Nov (4 days before 20 Nov), 9am Sydney
    expect(await runScheduledMessages(at("2026-11-15T22:00:00Z"))).toMatchObject({ balance_reminder: 1, pickup_details: 0 });
    expect(await runScheduledMessages(at("2026-11-15T23:00:00Z"))).toMatchObject({ balance_reminder: 0, pickup_details: 0 });
    // 19 Nov, the day before
    expect(await runScheduledMessages(at("2026-11-18T22:00:00Z"))).toMatchObject({ balance_reminder: 0, pickup_details: 1 });
    expect(sent.map((s) => s.subject)).toEqual([
      "Balance due for your cake on Fri, 20 Nov 2026",
      "Pickup details: Fri, 20 Nov 2026 at 10am",
    ]);
    const keys = (await repo.listMessages(order.id)).map((m) => m.key).sort();
    expect(keys).toEqual(["balance_reminder", "order_received", "pickup_details"]);
  });

  it("skips the balance reminder when paid in full", async () => {
    await createAndPay({ pickupDate: "2026-11-10" }); // rush, paid in full
    const r = await runScheduledMessages({ ...deps, now: new Date("2026-11-07T22:00:00Z") });
    expect(r.balance_reminder).toBe(0);
  });
});

describe("calendar API data", () => {
  it("returns month statuses with rush and peak details", async () => {
    const dec = await monthAvailability(repo, "2026-12", NOW);
    const eve = dec.days.find((d) => d.date === "2026-12-24")!;
    expect(eve.peakSurchargeCents).toBe(3000);
    const nov = await monthAvailability(repo, "2026-11", NOW);
    expect(nov.days.find((d) => d.date === "2026-11-10")?.isRush).toBe(true);
    expect(nov.days.find((d) => d.date === "2026-11-16")?.bookable).toBe(false);
  });
});

describe("upload checks", () => {
  it("checks type, size and magic bytes", () => {
    expect(checkUpload(PNG, "image/png", IMAGE_TYPES, 1000).ok).toBe(true);
    expect(checkUpload(PNG, "image/png", IMAGE_TYPES, 4).ok).toBe(false);
    expect(checkUpload(new Uint8Array(), "image/png", IMAGE_TYPES, 1000).ok).toBe(false);
    expect(checkUpload(PNG, "image/jpeg", IMAGE_TYPES, 1000).ok).toBe(false);
    expect(checkUpload(PNG, "image/gif", IMAGE_TYPES, 1000).ok).toBe(false);
  });
});

describe("order request validation", () => {
  it("requires terms, a valid email and phone", () => {
    const base = { ...request(), acceptTerms: false };
    expect(orderRequestSchema.safeParse(base).success).toBe(false);
    expect(orderRequestSchema.safeParse({ ...request(), email: "nope" }).success).toBe(false);
    expect(orderRequestSchema.safeParse({ ...request(), phone: "abc" }).success).toBe(false);
    expect(orderRequestSchema.safeParse({ ...request(), pickupDate: "2026-02-30" }).success).toBe(false);
  });
});
