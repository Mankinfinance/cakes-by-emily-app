import { clientIp, deps, errorResponse, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createCorporateOrder } from "@/lib/services/corporate";
import { corporateRequestSchema, MAX_PHOTO_BYTES } from "@/lib/validation";

export async function POST(request: Request) {
  if (!rateLimit(`corporate:${clientIp(request)}`, 6, 10 * 60_000)) {
    return json({ error: "Too many attempts. Please wait a few minutes and try again." }, 429);
  }
  let form: FormData;
  let payload: unknown;
  try {
    form = await request.formData();
    payload = JSON.parse(String(form.get("payload") ?? ""));
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const parsed = corporateRequestSchema.safeParse(payload);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Please check your details." }, 400);
  const file = form.get("logo");
  let logo = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PHOTO_BYTES) return json({ error: "The logo must be under 4 MB." }, 400);
    logo = { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type };
  }
  try {
    const { checkoutUrl } = await createCorporateOrder(await deps(request), parsed.data, logo);
    return json({ checkoutUrl });
  } catch (err) {
    return errorResponse(err);
  }
}
