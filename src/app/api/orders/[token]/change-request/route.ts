import { z } from "zod";
import { requestDesignChange } from "@/lib/services/changes";
import { orderAction } from "@/lib/token-route";

export async function POST(request: Request, ctx: RouteContext<"/api/orders/[token]/change-request">) {
  const { token } = await ctx.params;
  return orderAction(request, token, "change", z.object({ request: z.string().trim().min(3, "Please describe the change you'd like.").max(1000) }), (deps, order, body) =>
    requestDesignChange(deps, order.id, body.request),
  );
}
