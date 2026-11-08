import { errorResponse, json } from "@/lib/http";
import { getRepo } from "@/lib/data";
import { monthAvailability } from "@/lib/services/calendar";

export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: "Invalid month" }, 400);
  try {
    return json(await monthAvailability(await getRepo(), month));
  } catch (err) {
    return errorResponse(err);
  }
}
