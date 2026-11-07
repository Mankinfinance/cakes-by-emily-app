import { getRepo } from "@/lib/data";
import { isIsoDate } from "@/lib/domain/dates";
import { errorResponse, json } from "@/lib/http";
import { slotAvailability } from "@/lib/services/orders";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!isIsoDate(date)) return json({ error: "Invalid date" }, 400);
  try {
    return json(await slotAvailability(await getRepo(), date));
  } catch (err) {
    return errorResponse(err);
  }
}
