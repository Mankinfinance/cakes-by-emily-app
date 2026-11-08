import { getRepo } from "@/lib/data";
import { clientIp, deps, errorResponse, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { privateFromPayToken, privatePayLink } from "@/lib/services/classes";
import { payRemainingShares } from "@/lib/services/split";

export async function POST(request: Request, ctx: RouteContext<"/api/classes/private/[token]/pay-rest">) {
  if (!rateLimit(`pay-rest:${clientIp(request)}`, 10, 10 * 60_000)) return json({ error: "Too many attempts. Please wait a few minutes." }, 429);
  const { token } = await ctx.params;
  const r = await privateFromPayToken(await getRepo(), token);
  if (!r) return json({ error: "Request not found." }, 404);
  try {
    const d = await deps(request);
    return json({ checkoutUrl: await payRemainingShares(d, r, privatePayLink(d.baseUrl, token)) });
  } catch (err) {
    return errorResponse(err);
  }
}
