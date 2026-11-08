import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { sessionLabel } from "@/lib/domain/classes";
import { formatAud } from "@/lib/domain/money";
import { bookingFromToken } from "@/lib/orders-public";

export const metadata: Metadata = { title: "Your class ticket", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function TicketPage({ params, searchParams }: PageProps<"/t/[token]">) {
  await connection();
  const { token } = await params;
  const { paid } = await searchParams;
  const booking = await bookingFromToken(token);
  if (!booking) notFound();
  const repo = await getRepo();
  const session = await repo.getSession(booking.sessionId);
  const type = session && (await repo.listClassTypes()).find((t) => t.id === session.classTypeId);
  if (!session || !type) notFound();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        {paid === "1" && booking.status === "awaiting_payment" && <p className="mb-4 rounded-xl bg-blush px-4 py-3 text-sm">Thank you! We&apos;re confirming your payment with Stripe. Refresh in a moment.</p>}
        <article className="card overflow-hidden" data-testid="ticket">
          <div className="bg-plum p-5 text-white">
            <p className="text-xs uppercase tracking-widest opacity-80">Ticket {booking.reference}</p>
            <h1 className="mt-1 font-serif text-2xl">{type.name}</h1>
            <p className="opacity-90">{sessionLabel(session)}, Grasmere</p>
          </div>
          <div className="p-5 text-sm">
            <p className="text-lg font-semibold" data-testid="ticket-status">
              {booking.status === "paid" ? "Booked" : booking.status === "cancelled" ? "Cancelled" : "Waiting for payment"}
            </p>
            {booking.cancellation && <p className="mt-1">{booking.cancellation.summary}</p>}
            <ul className="mt-3 divide-y divide-line" data-testid="ticket-guests">
              {booking.guests.map((g, i) => (
                <li key={i} className="flex justify-between py-2">
                  <span>{g.name}</span>
                  {g.allergies && <span className="text-rose-dark">Allergies: {g.allergies}</span>}
                </li>
              ))}
            </ul>
            <p className="mt-3">
              Paid {formatAud(booking.amountPaidCents)}
              {booking.discountCents > 0 && ` (including a ${formatAud(booking.discountCents)} group discount)`}
            </p>
            {booking.status === "paid" && (
              <a href={`/api/classes/ics/${token}`} className="btn btn-ghost mt-4" data-testid="add-to-calendar">
                Add to calendar
              </a>
            )}
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
