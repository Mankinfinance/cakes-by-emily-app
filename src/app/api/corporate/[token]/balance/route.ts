import { clientIp, deps, errorResponse, json } from "@/lib/http";
import { corporateFromToken } from "@/lib/orders-public";
import { rateLimit } from "@/lib/rate-limit";
import { startCorporateBalance } from "@/lib/services/corporate";

export async function POST(request: Request, ctx: RouteContext<"/api/corporate/[token]/balance">) {
  if (!rateLimit(`corp-balance:${clientIp(request)}`, 10, 10 * 60_000)) return json({ error: "Too many attempts. Please wait a few minutes." }, 429);
  const { token } = await ctx.params;
  const order = await corporateFromToken(token);
  if (!order) return json({ error: "Order not found." }, 404);
  try {
    return json({ checkoutUrl: await startCorporateBalance(await deps(request), order) });
  } catch (err) {
    return errorResponse(err);
  }
}
