import { z } from "zod";
import { approveDesign } from "@/lib/services/changes";
import { orderAction } from "@/lib/token-route";

export async function POST(request: Request, ctx: RouteContext<"/api/orders/[token]/approve">) {
  const { token } = await ctx.params;
  return orderAction(request, token, "approve", z.object({}), (deps, order) => approveDesign(deps, order.id));
}
