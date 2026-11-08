"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { siteUrl } from "@/lib/config";
import { getRepo } from "@/lib/data";
import type { UploadTarget } from "@/lib/data/repository";
import { canSetVisibility } from "@/lib/domain/visibility";
import { getMailer } from "@/lib/services/email";
import { AUTOMATION_KEYS } from "@/lib/domain/types";
import { cancelWithTerms, sendForApproval } from "@/lib/services/changes";
import {
  advanceStage,
  finishVideoUpload,
  OrderError,
  postUpdate,
  startVideoUpload,
} from "@/lib/services/orders";
import {
  catalogueItemPatchSchema,
  dayOffSchema,
  MAX_PHOTO_BYTES,
  newCatalogueItemSchema,
  peakDateSchema,
  seasonalBoxSchema,
  settingsSchema,
} from "@/lib/validation";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const uuid = z.string().uuid();

async function deps() {
  return { repo: await getRepo(), mailer: getMailer(), baseUrl: siteUrl() };
}

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof OrderError) return { ok: false, error: err.message };
  if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Please check the values." };
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function advanceStageAction(orderId: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await advanceStage(await deps(), uuid.parse(orderId));
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelOrderAction(orderId: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await cancelWithTerms(await deps(), uuid.parse(orderId), "emily");
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function postPhotoUpdateAction(form: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const orderId = uuid.parse(form.get("orderId"));
    const caption = z.string().max(300).parse(form.get("caption") ?? "");
    const file = form.get("photo");
    let photo = null;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: "Photos must be under 4 MB." };
      photo = { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type };
    }
    await postUpdate(await deps(), orderId, caption, photo);
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function startVideoUploadAction(
  orderId: string,
  contentType: string,
  size: number,
): Promise<ActionResult<{ path: string; target: UploadTarget }>> {
  await requireAdmin();
  try {
    const data = await startVideoUpload(await deps(), uuid.parse(orderId), contentType, z.number().int().parse(size));
    return { ok: true, data };
  } catch (err) {
    return fail(err);
  }
}

export async function finishVideoUploadAction(orderId: string, path: string, caption: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await finishVideoUpload(await deps(), uuid.parse(orderId), z.string().max(200).parse(path), z.string().max(300).parse(caption));
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function updateItemAction(id: string, patch: unknown): Promise<ActionResult> {
  await requireAdmin();
  try {
    const repo = await getRepo();
    const clean = catalogueItemPatchSchema.parse(patch);
    if (clean.visible !== undefined) {
      const check = canSetVisibility(await repo.listCatalogue(), id, clean.visible);
      if (!check.ok) return { ok: false, error: check.reason };
    }
    await repo.updateCatalogueItem(id, clean);
    revalidatePath("/admin/catalogue");
    revalidatePath("/order");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function addItemAction(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  try {
    const repo = await getRepo();
    const item = newCatalogueItemSchema.parse(input);
    const all = await repo.listCatalogue();
    const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "item";
    await repo.createCatalogueItem({
      id: `${item.category.slice(0, 4)}-${slug}-${randomUUID().slice(0, 6)}`,
      category: item.category,
      name: item.name,
      description: "",
      priceCents: item.priceCents,
      priceMode: item.category === "finish" ? "per_tier" : "flat",
      tiers: 1,
      hex: item.category === "colour" ? "#F2C4CE" : null,
      allergens: [],
      visible: false,
      sort: Math.max(0, ...all.map((i) => i.sort)) + 10,
    });
    revalidatePath("/admin/catalogue");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveSettingsAction(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  try {
    await (await getRepo()).saveSettings(settingsSchema.parse(input));
    revalidatePath("/admin/settings");
    revalidatePath("/order");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function addDayOffAction(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  try {
    await (await getRepo()).addDayOff(dayOffSchema.parse(input));
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function removeDayOffAction(date: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await (await getRepo()).removeDayOff(dayOffSchema.shape.date.parse(date));
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function upsertPeakAction(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  try {
    await (await getRepo()).upsertPeakDate(peakDateSchema.parse(input));
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function removePeakAction(date: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await (await getRepo()).removePeakDate(peakDateSchema.shape.date.parse(date));
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// Phase 2 --------------------------------------------------------------------

export async function sendForApprovalAction(form: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const orderId = uuid.parse(form.get("orderId"));
    const note = z.string().max(500).parse(form.get("note") ?? "");
    const file = form.get("sketch");
    let sketch = null;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: "Images must be under 4 MB." };
      sketch = { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type };
    }
    await sendForApproval(await deps(), orderId, note, sketch);
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function toggleKitchenAction(kind: "cake" | "box", id: string, done: boolean): Promise<ActionResult> {
  await requireAdmin();
  try {
    const repo = await getRepo();
    if (kind === "cake") await repo.updateOrder(uuid.parse(id), { kitchenDone: z.boolean().parse(done) });
    else await repo.updateBoxOrder(uuid.parse(id), { kitchenDone: z.boolean().parse(done) });
    revalidatePath("/admin/kitchen");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const automationSchema = z.object({
  key: z.enum(AUTOMATION_KEYS),
  enabled: z.boolean(),
  days: z.number().int().min(0).max(400),
});

export async function saveAutomationAction(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  try {
    await (await getRepo()).saveAutomation(automationSchema.parse(input));
    revalidatePath("/admin/automations");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function removeWaitlistAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await (await getRepo()).setWaitlistStatus(uuid.parse(id), "removed");
    revalidatePath("/admin/waitlist");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveBoxAction(id: string | null, input: unknown): Promise<ActionResult> {
  await requireAdmin();
  try {
    const repo = await getRepo();
    const box = seasonalBoxSchema.parse(input);
    if (id) {
      const existing = await repo.getBox(uuid.parse(id));
      if (!existing) return { ok: false, error: "That box no longer exists." };
      if (box.cap < existing.sold) return { ok: false, error: `${existing.sold} are already sold, so the cap can't go below that.` };
      await repo.updateBox(existing.id, box);
    } else {
      await repo.createBox({ ...box, id: randomUUID(), sold: 0, photoPath: null });
    }
    revalidatePath("/admin/boxes");
    revalidatePath("/boxes");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function boxOrderAction(id: string, action: "collected" | "cancel"): Promise<ActionResult> {
  await requireAdmin();
  try {
    const repo = await getRepo();
    const bo = await repo.getBoxOrderById(uuid.parse(id));
    if (!bo) return { ok: false, error: "Pre-order not found." };
    if (action === "collected") {
      if (bo.status !== "paid") return { ok: false, error: "Only paid pre-orders can be marked collected." };
      await repo.updateBoxOrder(bo.id, { status: "collected" });
    } else if (!(await repo.cancelBoxOrder(bo.id, false))) {
      return { ok: false, error: "This pre-order can't be cancelled." };
    }
    revalidatePath("/admin/boxes");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function voidVoucherAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await (await getRepo()).setVoucherStatus(uuid.parse(id), "void");
    revalidatePath("/admin/vouchers");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
