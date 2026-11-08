import { getRepo } from "@/lib/data";
import { clientIp, errorResponse, json, lightDeps } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { privateFromPayToken } from "@/lib/services/classes";
import { nudgeGuests } from "@/lib/services/split";

export async function POST(request: Request, ctx: RouteContext<"/api/classes/private/[token]/nudge">) {
  if (!rateLimit(`nudge:${clientIp(request)}`, 5, 60 * 60_000)) return json({ error: "Too many attempts. Please try again later." }, 429);
  const { token } = await ctx.params;
  const r = await privateFromPayToken(await getRepo(), token);
  if (!r) return json({ error: "Request not found." }, 404);
  try {
    return json({ sent: await nudgeGuests(await lightDeps(request), r) });
  } catch (err) {
    return errorResponse(err);
  }
}
