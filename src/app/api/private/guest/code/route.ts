import { z } from "zod";
import { clientIp, errorResponse, json, lightDeps } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { applyCodeToShare, guestFromTokens } from "@/lib/services/split";

const schema = z.object({ shareToken: z.string().max(60), guestId: z.string().max(40), guestToken: z.string().max(60), code: z.string().trim().min(1, "Please enter a code.").max(40) });

// A guest uses a gift voucher, credit code or class pass on their own share.
// Codes carry 80 bits of randomness and attempts are limited per address, so
// guessing one isn't practical; the code is taken atomically in the database.
export async function POST(request: Request) {
  if (!rateLimit(`share-code:${clientIp(request)}`, 10, 15 * 60_000)) return json({ error: "Too many attempts. Please wait 15 minutes and try again." }, 429);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, 400);
  try {
    const d = await lightDeps(request);
    const found = await guestFromTokens(d, parsed.data.shareToken, parsed.data.guestId, parsed.data.guestToken);
    if (!found) return json({ error: "That link isn't valid." }, 404);
    return json({ ok: true, ...(await applyCodeToShare(d, found.request, found.guest, parsed.data.code)) });
  } catch (err) {
    return errorResponse(err);
  }
}
