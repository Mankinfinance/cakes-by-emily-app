import { z } from "zod";
import { clientIp, deps, errorResponse, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { guestFromTokens, payOwnShare } from "@/lib/services/split";

const schema = z.object({ shareToken: z.string().max(60), guestId: z.string().max(40), guestToken: z.string().max(60) });

export async function POST(request: Request) {
  if (!rateLimit(`guest-pay:${clientIp(request)}`, 10, 10 * 60_000)) return json({ error: "Too many attempts. Please wait a few minutes." }, 429);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request." }, 400);
  try {
    const d = await deps(request);
    const found = await guestFromTokens(d, parsed.data.shareToken, parsed.data.guestId, parsed.data.guestToken);
    if (!found) return json({ error: "That link isn't valid." }, 404);
    return json({ checkoutUrl: await payOwnShare(d, found.request, found.guest) });
  } catch (err) {
    return errorResponse(err);
  }
}
