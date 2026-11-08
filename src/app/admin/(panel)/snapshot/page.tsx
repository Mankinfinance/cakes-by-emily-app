import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { formatDateLong } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import type { Ranked, SalesSummary } from "@/lib/domain/snapshot";
import { buildSnapshot } from "@/lib/services/snapshot";

function Bars({ title, rows }: { title: string; rows: Ranked[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="card p-5">
      <h3 className="font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No orders yet this month.</p>
      ) : (
        <svg role="img" aria-label={`${title}: ${rows.map((r) => `${r.name} ${r.count}`).join(", ")}`} viewBox={`0 0 300 ${rows.length * 28}`} className="mt-3 w-full">
          {rows.map((r, i) => (
            <g key={r.name} transform={`translate(0 ${i * 28})`}>
              <text x="0" y="12" fontSize="11" fill="currentColor">{r.name}</text>
              <rect x="0" y="16" height="8" rx="4" width={Math.max(6, (r.count / max) * 260)} fill="#B4506E" />
              <text x={Math.max(6, (r.count / max) * 260) + 6} y="24" fontSize="10" fill="#75636B">{r.count}</text>
            </g>
          ))}
        </svg>
      )}
    </section>
  );
}

function Stats({ label, s }: { label: string; s: SalesSummary }) {
  const items = [
    ["Orders", String(s.orders)],
    ["Revenue booked", formatAud(s.revenueCents)],
    ["Deposits taken", formatAud(s.depositsCents)],
    ["Average order", formatAud(s.averageCents)],
  ];
  return (
    <section className="card p-5">
      <h2 className="font-serif text-xl">{label}</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
            <dd className="text-xl font-semibold" data-testid={`${label === "This month" ? "this" : "last"}-${k.split(" ")[0].toLowerCase()}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default async function SnapshotPage() {
  await requireAdmin();
  const snap = await buildSnapshot(await getRepo());
  return (
    <div className="grid gap-6" data-testid="snapshot">
      <div>
        <h1 className="font-serif text-3xl">Sales snapshot</h1>
        <p className="mt-1 text-sm text-muted">Cake orders by the date they were booked. Money is in AUD; refunds made in Stripe aren&apos;t taken off here.</p>
      </div>
      <Stats label="This month" s={snap.thisMonth} />
      <Stats label="Last month" s={snap.lastMonth} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Bars title="Top flavours" rows={snap.thisMonth.topFlavours} />
        <Bars title="Top finishes" rows={snap.thisMonth.topFinishes} />
        <Bars title="Top occasions" rows={snap.thisMonth.topOccasions} />
      </div>
      <section className="card p-5">
        <h2 className="font-serif text-xl">Capacity, next 4 weeks</h2>
        <ul className="mt-3 grid gap-2 text-sm" data-testid="capacity">
          {snap.capacity.map((w) => (
            <li key={w.weekOf} className="grid grid-cols-[110px_1fr_70px] items-center gap-3">
              <span>w/c {formatDateLong(w.weekOf).replace(/ \d{4}$/, "")}</span>
              <span className="h-2 overflow-hidden rounded-full bg-blush" aria-hidden>
                <span className="block h-full bg-rose" style={{ width: `${Math.min(100, (w.booked / Math.max(1, w.cap)) * 100)}%` }} />
              </span>
              <span className="text-right">
                {w.booked} / {w.cap}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="font-serif text-xl">Balances owed: {formatAud(snap.balancesTotalCents)}</h2>
          {snap.balances.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing owing.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line text-sm" data-testid="balances">
              {snap.balances.map((b) => (
                <li key={b.id} className="flex justify-between py-2">
                  <Link href={`/admin/orders/${b.id}`} className="underline">
                    {b.name} ({formatDateLong(b.pickupDate)})
                  </Link>
                  <span>{formatAud(b.owingCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-5">
          <h2 className="font-serif text-xl">Seasonal boxes and credit</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {snap.boxes.map((b) => (
              <li key={b.name} className="flex justify-between py-2">
                <span>{b.name}</span>
                <span>
                  {b.sold} / {b.cap} sold &middot; {b.state}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm" data-testid="vouchers-outstanding">
            Gift vouchers outstanding: {formatAud(snap.giftOutstandingCents)} &middot; Credit codes outstanding: {formatAud(snap.creditOutstandingCents)}
          </p>
        </section>
      </div>
    </div>
  );
}
