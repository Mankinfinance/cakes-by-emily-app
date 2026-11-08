import { getRepo } from "@/lib/data";
import { isIsoDate } from "@/lib/domain/dates";
import { errorResponse, json } from "@/lib/http";
import { orderFromToken } from "@/lib/orders-public";
import { slotAvailability } from "@/lib/services/calendar";
import { offerFromToken } from "@/lib/services/waitlist";

// ?order=<token> leaves that order's own booking out (moving its date).
// ?claim=<token> leaves a live waitlist offer's hold out (its holder booking it).
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const date = params.get("date") ?? "";
  if (!isIsoDate(date)) return json({ error: "Invalid date" }, 400);
  try {
    const repo = await getRepo();
    const orderToken = params.get("order");
    const claimToken = params.get("claim");
    const order = orderToken ? await orderFromToken(orderToken) : null;
    const claim = claimToken ? await offerFromToken({ repo }, claimToken) : null;
    return json(
      await slotAvailability(repo, date, new Date(), {
        excludeOrderId: order?.id,
        excludeWaitlistId: claim?.id,
      }),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
