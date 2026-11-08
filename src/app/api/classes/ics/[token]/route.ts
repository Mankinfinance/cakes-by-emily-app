import { BUSINESS } from "@/lib/config";
import { getRepo } from "@/lib/data";
import { classIcs } from "@/lib/domain/classes";
import { bookingFromToken } from "@/lib/orders-public";

// "Add to calendar" for a booked class. Only the address-free suburb is included.
export async function GET(_request: Request, ctx: RouteContext<"/api/classes/ics/[token]">) {
  const { token } = await ctx.params;
  const booking = await bookingFromToken(token);
  if (!booking || booking.status !== "paid") return new Response("Not found", { status: 404 });
  const repo = await getRepo();
  const session = await repo.getSession(booking.sessionId);
  const type = session && (await repo.listClassTypes()).find((t) => t.id === session.classTypeId);
  if (!session || !type) return new Response("Not found", { status: 404 });
  const ics = classIcs({
    uid: `${booking.id}@cakesbyemily`,
    title: `${type.name} (${BUSINESS.name})`,
    date: session.date,
    startTime: session.startTime,
    durationMinutes: type.durationMinutes,
    location: `${BUSINESS.name}, ${BUSINESS.suburb} NSW`,
    description: `${booking.seats} ${booking.seats === 1 ? "seat" : "seats"}. Booking ${booking.reference}.`,
    stamp: new Date(),
  });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="class-${booking.reference}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
