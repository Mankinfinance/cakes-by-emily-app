import { getRepo } from "@/lib/data";
import { clientIp, deps, errorResponse, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { privateFromPayToken, startPrivateDeposit } from "@/lib/services/classes";

export async function POST(request: Request, ctx: RouteContext<"/api/classes/private/[token]/pay">) {
  if (!rateLimit(`private-pay:${clientIp(request)}`, 10, 10 * 60_000)) return json({ error: "Too many attempts. Please wait a few minutes." }, 429);
  const { token } = await ctx.params;
  const r = await privateFromPayToken(await getRepo(), token);
  if (!r) return json({ error: "Request not found." }, 404);
  try {
    return json({ checkoutUrl: await startPrivateDeposit(await deps(request), r, token) });
  } catch (err) {
    return errorResponse(err);
  }
}
