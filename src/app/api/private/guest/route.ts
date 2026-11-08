import { clientIp, deps, errorResponse, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { joinAsGuest } from "@/lib/services/split";
import { guestDetailsSchema } from "@/lib/validation";

// A guest adds their details from the organiser's share link, and optionally pays their share.
export async function POST(request: Request) {
  if (!rateLimit(`guest:${clientIp(request)}`, 10, 10 * 60_000)) return json({ error: "Too many attempts. Please wait a few minutes." }, 429);
  const parsed = guestDetailsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Please check your details." }, 400);
  try {
    return json(await joinAsGuest(await deps(request), parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}
