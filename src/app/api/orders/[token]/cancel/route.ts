import { z } from "zod";
import { cancelWithTerms } from "@/lib/services/changes";
import { orderAction } from "@/lib/token-route";

export async function POST(request: Request, ctx: RouteContext<"/api/orders/[token]/cancel">) {
  const { token } = await ctx.params;
  return orderAction(request, token, "cancel", z.object({ confirm: z.literal(true, { error: "Please confirm the cancellation." }) }), async (deps, order) => {
    const record = await cancelWithTerms(deps, order.id, "customer");
    return { summary: record.summary };
  });
}
