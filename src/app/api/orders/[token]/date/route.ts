import { z } from "zod";
import { isIsoDate } from "@/lib/domain/dates";
import { changeDate } from "@/lib/services/changes";
import { orderAction } from "@/lib/token-route";

const schema = z.object({
  date: z.string().refine(isIsoDate, "Please choose a date"),
  slot: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Please choose a pickup time"),
});

export async function POST(request: Request, ctx: RouteContext<"/api/orders/[token]/date">) {
  const { token } = await ctx.params;
  return orderAction(request, token, "date", schema, async (deps, order, body) => {
    await changeDate(deps, order.id, body.date, body.slot);
  });
}
