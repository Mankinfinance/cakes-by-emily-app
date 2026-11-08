import { z } from "zod";
import { getRepo } from "@/lib/data";
import { clientIp, errorResponse, json, lightDeps } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { privateFromPayToken } from "@/lib/services/classes";
import { reduceGuests, reduceGuestsPreview } from "@/lib/services/private-reduce";

const body = z.object({ guests: z.number().int().min(1).max(50), confirm: z.boolean().default(false) });

/** The organiser lowers their guest numbers (unpaid places only, until the shares are due). Preview first, then confirm. */
export async function POST(request: Request, ctx: RouteContext<"/api/classes/private/[token]/reduce">) {
  if (!rateLimit(`reduce:${clientIp(request)}`, 20, 60 * 60_000)) return json({ error: "Too many attempts. Please try again later." }, 429);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Please choose a number of guests." }, 400);
  const { token } = await ctx.params;
  const r = await privateFromPayToken(await getRepo(), token);
  if (!r) return json({ error: "Request not found." }, 404);
  try {
    const deps = await lightDeps(request);
    if (!parsed.data.confirm) {
      const { quote } = await reduceGuestsPreview(deps, r, parsed.data.guests, { by: "organiser" });
      return json({ ok: quote.ok, problem: quote.problem, summary: quote.summary });
    }
    const rec = await reduceGuests(deps, r.id, parsed.data.guests, { by: "organiser" });
    return json({ ok: true, summary: rec.summary });
  } catch (err) {
    return errorResponse(err);
  }
}
