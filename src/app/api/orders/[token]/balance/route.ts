import { clientIp, deps, errorResponse, json } from "@/lib/http";
import { orderFromToken } from "@/lib/orders-public";
import { rateLimit } from "@/lib/rate-limit";
import { startBalancePayment } from "@/lib/services/orders";

export async function POST(request: Request, ctx: RouteContext<"/api/orders/[token]/balance">) {
  if (!rateLimit(`balance:${clientIp(request)}`, 10, 10 * 60_000)) {
    return json({ error: "Too many attempts. Please wait a few minutes." }, 429);
  }
  const { token } = await ctx.params;
  const order = await orderFromToken(token);
  if (!order) return json({ error: "Order not found." }, 404);
  try {
    return json({ checkoutUrl: await startBalancePayment(await deps(request), order) });
  } catch (err) {
    return errorResponse(err);
  }
}
