import { clientIp, errorResponse, json, lightDeps } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { joinWaitlist } from "@/lib/services/waitlist";
import { waitlistRequestSchema } from "@/lib/validation";

export async function POST(request: Request) {
  if (!rateLimit(`waitlist:${clientIp(request)}`, 6, 10 * 60_000)) {
    return json({ error: "Too many attempts. Please wait a few minutes and try again." }, 429);
  }
  const parsed = waitlistRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Please check your details." }, 400);
  try {
    const { place } = await joinWaitlist(await lightDeps(request), parsed.data);
    return json({ place });
  } catch (err) {
    return errorResponse(err);
  }
}
