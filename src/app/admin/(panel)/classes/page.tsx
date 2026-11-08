import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { decideBy, sessionLabel } from "@/lib/domain/classes";
import { formatDateLong, todayInBusinessTz } from "@/lib/domain/dates";
import { sessionsWithTypes } from "@/lib/services/classes";
import { ClassTypeRow } from "./ClassTypeRow";
import { SeriesForm } from "./SeriesForm";

export default async function ClassesAdmin() {
  await requireAdmin();
  const repo = await getRepo();
  const today = todayInBusinessTz();
  const [rows, types, requests] = await Promise.all([sessionsWithTypes(repo, today, { includeCancelled: true }), repo.listClassTypes(), repo.listPrivateRequests()]);
  const waiting = requests.filter((r) => r.status === "requested").length;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl">Classes</h1>
        <Link href="/admin/classes/private" className="btn btn-ghost" data-testid="private-requests-link">
          Private requests{waiting ? ` (${waiting} new)` : ""}
        </Link>
      </div>
      <section className="card p-5">
        <h2 className="font-serif text-xl">Upcoming classes</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No classes scheduled. Add one below.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm" data-testid="admin-sessions">
            {rows.map(({ session, type, belowMin }) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/admin/classes/${session.id}`} className="font-semibold underline" data-testid={`admin-session-${session.date}`}>
                  {type.name}, {sessionLabel(session)}
                </Link>
                <span className="flex flex-wrap items-center gap-3">
                  {session.status === "cancelled" ? (
                    <span className="text-muted">Cancelled</span>
                  ) : (
                    <>
                      <span>
                        {session.booked} / {session.seats} booked
                      </span>
                      {belowMin && (
                        <span className="rounded-full bg-[#fbf3e6] px-2 py-0.5 text-xs font-semibold text-gold" data-testid="below-min">
                          Below minimum of {type.minGuests}: decide by {formatDateLong(decideBy(session.date))}
                        </span>
                      )}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <SeriesForm types={types.map((t) => ({ id: t.id, name: t.name, defaultSeats: t.defaultSeats }))} />
      <section className="card p-5">
        <h2 className="font-serif text-xl">Class types</h2>
        <ul className="mt-3 divide-y divide-line">
          {types.map((t) => (
            <ClassTypeRow key={t.id} type={t} />
          ))}
        </ul>
      </section>
    </div>
  );
}
