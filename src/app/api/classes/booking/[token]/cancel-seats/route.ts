import { z } from "zod";
import { getRepo } from "@/lib/data";
import { clientIp, errorResponse, json, lightDeps } from "@/lib/http";
import { bookingFromToken } from "@/lib/orders-public";
import { rateLimit } from "@/lib/rate-limit";
import { cancelSomeSeats, partialCancelPreview } from "@/lib/services/classes";

const schema = z.object({
  guests: z.array(z.number().int().min(0).max(5)).min(1, "Choose at least one guest to cancel.").max(6),
  /** false: just show what would happen. true: do it. */
  confirm: z.boolean().default(false),
});

// The customer cancels some seats from their ticket page. Without confirm it
// only returns the quote, so the page can show the new price first.
export async function POST(request: Request, ctx: RouteContext<"/api/classes/booking/[token]/cancel-seats">) {
  if (!rateLimit(`class-seats:${clientIp(request)}`, 20, 10 * 60_000)) return json({ error: "Too many attempts. Please wait a few minutes." }, 429);
  const { token } = await ctx.params;
  const booking = await bookingFromToken(token);
  if (!booking) return json({ error: "Booking not found." }, 404);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, 400);
  try {
    if (!parsed.data.confirm) {
      const preview = await partialCancelPreview(await getRepo(), booking, parsed.data.guests);
      if (!preview) return json({ error: "Booking not found." }, 404);
      const q = preview.quote;
      return json({ ok: q.ok, problem: q.problem, summary: q.summary, newTotalCents: q.newTotalCents, discountLost: q.discountLost, refundCents: q.refundCents, creditCents: q.creditCents + q.voucherCreditCents, passCreditsReturned: q.passCreditsReturned });
    }
    const record = await cancelSomeSeats(await lightDeps(request), booking.id, parsed.data.guests);
    return json({ ok: true, summary: record.summary });
  } catch (err) {
    return errorResponse(err);
  }
}
