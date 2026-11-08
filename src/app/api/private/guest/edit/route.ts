import { z } from "zod";
import { clientIp, errorResponse, json, lightDeps } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { editGuestDetails, guestFromTokens } from "@/lib/services/split";
import { guestEditSchema } from "@/lib/validation";

const tokens = z.object({ shareToken: z.string().max(60), guestId: z.string().max(40), guestToken: z.string().max(60) });

// A guest changes their own details from their own link, up to the cut-off.
export async function POST(request: Request) {
  if (!rateLimit(`guest-edit:${clientIp(request)}`, 10, 10 * 60_000)) return json({ error: "Too many attempts. Please wait a few minutes." }, 429);
  const body = await request.json().catch(() => null);
  const t = tokens.safeParse(body);
  const parsed = guestEditSchema.safeParse(body);
  if (!t.success) return json({ error: "Invalid request." }, 400);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Please check your details." }, 400);
  try {
    const d = await lightDeps(request);
    const found = await guestFromTokens(d, t.data.shareToken, t.data.guestId, t.data.guestToken);
    if (!found) return json({ error: "That link isn't valid." }, 404);
    return json({ ok: true, ...(await editGuestDetails(d, found.request, found.guest, parsed.data)) });
  } catch (err) {
    return errorResponse(err);
  }
}
