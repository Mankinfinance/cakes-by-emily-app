import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { formatDateLong, todayInBusinessTz } from "@/lib/domain/dates";
import { removeWaitlistAction } from "../actions";
import { ActionButton } from "../ActionButton";

const STATUS: Record<string, string> = { waiting: "Waiting", offered: "Offered (24h)", claimed: "Booked", expired: "Offer expired", removed: "Removed" };

export default async function WaitlistPage() {
  await requireAdmin();
  const repo = await getRepo();
  const [entries, catalogue] = await Promise.all([repo.listWaitlist({ fromDate: todayInBusinessTz() }), repo.listCatalogue()]);
  const name = (id: string) => catalogue.find((c) => c.id === id)?.name ?? id;
  const dates = [...new Set(entries.map((e) => e.date))];

  return (
    <div>
      <h1 className="font-serif text-3xl">Waitlist</h1>
      <p className="mt-1 text-sm text-muted">
        When an order is cancelled, the first person waiting for that date is emailed automatically and has 24 hours to claim the spot. If they
        don&apos;t, it goes to the next person.
      </p>
      {dates.length === 0 && <p className="mt-8 text-muted">Nobody is on the waitlist.</p>}
      <div className="mt-6 grid gap-6" data-testid="admin-waitlist">
        {dates.map((d) => (
          <section key={d} className="card p-4">
            <h2 className="font-serif text-xl">{formatDateLong(d)}</h2>
            <ol className="mt-2 divide-y divide-line text-sm">
              {entries
                .filter((e) => e.date === d)
                .map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid={`wl-${e.email}`}>
                    <span>
                      <strong>{e.customerName}</strong> ({e.email}, {e.phone}) &middot; {name(e.config.size)}, {name(e.config.finish)}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-muted" data-testid="wl-status">{STATUS[e.status]}</span>
                      {(e.status === "waiting" || e.status === "offered") && (
                        <ActionButton action={removeWaitlistAction.bind(null, e.id)} label="Remove" confirmText="Remove from the waitlist?" />
                      )}
                    </span>
                  </li>
                ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
