import { clientIp, errorResponse, json, lightDeps } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { requestPrivate } from "@/lib/services/classes";
import { privateRequestSchema } from "@/lib/validation";

export async function POST(request: Request) {
  if (!rateLimit(`private:${clientIp(request)}`, 5, 10 * 60_000)) return json({ error: "Too many attempts. Please wait a few minutes and try again." }, 429);
  const parsed = privateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Please check your details." }, 400);
  try {
    const r = await requestPrivate(await lightDeps(request), parsed.data);
    return json({ reference: r.reference });
  } catch (err) {
    return errorResponse(err);
  }
}
