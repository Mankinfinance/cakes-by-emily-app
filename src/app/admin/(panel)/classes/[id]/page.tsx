import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { belowMinimum, decideBy, sessionLabel } from "@/lib/domain/classes";
import { formatDateLong } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { cancelBookingAction, cancelClassAction } from "../../actions";
import { ActionButton } from "../../ActionButton";
import { PrintButton } from "../../kitchen/KitchenControls";
import { CheckIn } from "./CheckIn";

export default async function SessionAdmin({ params }: PageProps<"/admin/classes/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const repo = await getRepo();
  const session = await repo.getSession(id);
  const type = session && (await repo.listClassTypes()).find((t) => t.id === session.classTypeId);
  if (!session || !type) notFound();
  const [bookings, waitlist] = await Promise.all([repo.listBookings({ sessionId: id }), repo.listWaitlist({ sessionId: id })]);
  const paid = bookings.filter((b) => b.status === "paid");
  const guests = paid.flatMap((b) => b.guests.map((g, i) => ({ ...g, booking: b, index: i })));
  const allergyCount = guests.filter((g) => g.allergies).length;
  const refundTotal = paid.reduce((s, b) => s + b.amountPaidCents, 0);
  return (
    <div className="kitchen-sheet grid gap-6">
      <div>
        <Link href="/admin/classes" className="no-print text-sm text-muted hover:text-rose">
          &larr; All classes
        </Link>
        <h1 className="mt-1 font-serif text-3xl">{type.name}</h1>
        <p className="text-muted">
          {sessionLabel(session)} &middot; {session.booked} of {session.seats} seats booked {session.status === "cancelled" && "(cancelled)"}
        </p>
        {belowMinimum(session, type) && (
          <p className="mt-2 rounded-xl bg-[#fbf3e6] px-4 py-2 text-sm font-semibold text-gold" data-testid="session-below-min">
            {session.booked} booked, minimum {type.minGuests}. Decide by {formatDateLong(decideBy(session.date))} whether it runs.
          </p>
        )}
      </div>
      <div className="no-print flex flex-wrap gap-3">
        <PrintButton />
        {session.status === "scheduled" && (
          <ActionButton
            action={cancelClassAction.bind(null, session.id)}
            label="Cancel class and refund everyone"
            className="btn btn-ghost"
            testId="cancel-class"
            confirmText={`Cancel this class? Everyone is emailed, and you'll need to refund ${formatAud(refundTotal)} in Stripe.`}
          />
        )}
      </div>
      <section className="card p-5">
        <h2 className="font-serif text-xl">
          Guest list ({guests.length}){allergyCount > 0 && <span className="ml-2 rounded-full bg-rose px-2 py-0.5 text-xs text-white">{allergyCount} with allergies</span>}
        </h2>
        {guests.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No paid bookings yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm" data-testid="guest-list">
            {guests.map((g) => (
              <li key={`${g.booking.id}-${g.index}`} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid={`guest-${g.name}`}>
                <span className="flex items-center gap-3">
                  <CheckIn bookingId={g.booking.id} index={g.index} checkedIn={g.checkedIn} label={g.name} />
                  <span>
                    <strong>{g.name}</strong> <span className="text-muted">({g.booking.reference}, {g.booking.contactName})</span>
                  </span>
                </span>
                {g.allergies && <span className="allergy rounded-md bg-rose px-2 py-0.5 font-semibold text-white">ALLERGIES: {g.allergies}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card p-5 text-sm">
        <h2 className="font-serif text-xl">Class-day prep</h2>
        <ul className="mt-2 list-disc pl-5">
          <li>{session.booked} cakes baked and cooled{type.id === "class-kids" ? " (or 6 cupcakes each)" : ""}</li>
          <li>Buttercream, colours and piping bags for {session.booked}</li>
          <li>Boxes and aprons for {session.booked}</li>
          <li>Allergy-safe set-up for {allergyCount} guest{allergyCount === 1 ? "" : "s"}</li>
        </ul>
      </section>
      <section className="no-print card p-5 text-sm">
        <h2 className="font-serif text-xl">Bookings</h2>
        <ul className="mt-3 divide-y divide-line" data-testid="session-bookings">
          {bookings.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {b.reference}: {b.contactName}, {b.seats} seat{b.seats === 1 ? "" : "s"}, {formatAud(b.amountPaidCents)} {b.status === "cancelled" && "(cancelled)"}
              </span>
              {b.status === "paid" && (
                <ActionButton action={cancelBookingAction.bind(null, b.id)} label="Cancel booking" confirmText={`Cancel ${b.reference}? Refund ${formatAud(b.amountPaidCents)} in Stripe.`} />
              )}
            </li>
          ))}
        </ul>
        {waitlist.length > 0 && (
          <>
            <h3 className="mt-4 font-semibold">Waitlist</h3>
            <ul className="mt-1 divide-y divide-line" data-testid="session-waitlist">
              {waitlist.map((w) => (
                <li key={w.id} className="flex justify-between py-1">
                  <span>
                    {w.customerName} ({w.email}), {w.seats} seat{w.seats === 1 ? "" : "s"}
                  </span>
                  <span className="text-muted">{w.status}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
