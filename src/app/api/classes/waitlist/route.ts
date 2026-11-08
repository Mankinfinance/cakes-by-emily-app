import { clientIp, errorResponse, json, lightDeps } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { joinClassWaitlist } from "@/lib/services/classes";
import { classWaitlistSchema } from "@/lib/validation";

export async function POST(request: Request) {
  if (!rateLimit(`class-wl:${clientIp(request)}`, 6, 10 * 60_000)) return json({ error: "Too many attempts. Please wait a few minutes and try again." }, 429);
  const parsed = classWaitlistSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Please check your details." }, 400);
  try {
    return json(await joinClassWaitlist(await lightDeps(request), parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}
