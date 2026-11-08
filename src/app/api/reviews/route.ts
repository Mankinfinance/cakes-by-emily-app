import { clientIp, errorResponse, json, lightDeps } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { orderForReview, submitReview } from "@/lib/services/reviews";
import { MAX_PHOTO_BYTES, reviewSchema } from "@/lib/validation";

export async function POST(request: Request) {
  if (!rateLimit(`review:${clientIp(request)}`, 6, 10 * 60_000)) return json({ error: "Too many attempts. Please wait a few minutes." }, 429);
  let form: FormData;
  let payload: { orderId?: unknown; token?: unknown };
  try {
    form = await request.formData();
    payload = JSON.parse(String(form.get("payload") ?? ""));
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const d = await lightDeps(request);
  const order = await orderForReview(d, String(payload.orderId ?? ""), String(payload.token ?? ""));
  if (!order) return json({ error: "That review link isn't valid." }, 404);
  const parsed = reviewSchema.safeParse(payload);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Please check your review." }, 400);
  const file = form.get("photo");
  let photo = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PHOTO_BYTES) return json({ error: "Photos must be under 4 MB." }, 400);
    photo = { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type };
  }
  try {
    await submitReview(d, order, parsed.data, photo);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
