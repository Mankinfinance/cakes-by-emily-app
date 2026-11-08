import { z } from "zod";
import { clientIp, errorResponse, json, lightDeps } from "@/lib/http";
import { bookingFromToken } from "@/lib/orders-public";
import { rateLimit } from "@/lib/rate-limit";
import { selfCancelBooking } from "@/lib/services/classes";

export async function POST(request: Request, ctx: RouteContext<"/api/classes/booking/[token]/cancel">) {
  if (!rateLimit(`class-cancel:${clientIp(request)}`, 10, 10 * 60_000)) return json({ error: "Too many attempts. Please wait a few minutes." }, 429);
  const { token } = await ctx.params;
  const booking = await bookingFromToken(token);
  if (!booking) return json({ error: "Booking not found." }, 404);
  const parsed = z.object({ confirm: z.literal(true, { error: "Please confirm the cancellation." }) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, 400);
  try {
    const record = await selfCancelBooking(await lightDeps(request), booking.id);
    return json({ ok: true, summary: record.summary });
  } catch (err) {
    return errorResponse(err);
  }
}
