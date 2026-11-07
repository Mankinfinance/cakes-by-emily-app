import { clientIp, deps, errorResponse, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createOrder } from "@/lib/services/orders";
import { MAX_PHOTO_BYTES, orderRequestSchema } from "@/lib/validation";

export async function POST(request: Request) {
  if (!rateLimit(`order:${clientIp(request)}`, 8, 10 * 60_000)) {
    return json({ error: "Too many attempts. Please wait a few minutes and try again." }, 429);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(String(form.get("payload") ?? ""));
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const parsed = orderRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Please check your details." }, 400);
  }

  const file = form.get("inspiration");
  let inspiration = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PHOTO_BYTES) return json({ error: "Photos must be under 4 MB." }, 400);
    inspiration = { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type };
  }

  try {
    const { checkoutUrl } = await createOrder(await deps(request), parsed.data, inspiration);
    return json({ checkoutUrl });
  } catch (err) {
    return errorResponse(err);
  }
}
