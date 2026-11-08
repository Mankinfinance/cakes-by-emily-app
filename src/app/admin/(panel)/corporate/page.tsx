import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { formatDateLong, formatTime12 } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { corporateStatusAction } from "../actions";
import { ActionButton } from "../ActionButton";
import { refundButtonLabel } from "@/lib/services/refunds";
import { PackageRow } from "./PackageRow";

const STATUS = { awaiting_payment: "Unpaid", confirmed: "Confirmed", ready: "Ready", collected: "Collected", cancelled: "Cancelled" } as const;

export default async function CorporateAdmin() {
  await requireAdmin();
  const repo = await getRepo();
  const [packages, orders, settings] = await Promise.all([repo.listCorporatePackages(), repo.listCorporateOrders(), repo.getSettings()]);
  const logos = await Promise.all(orders.map((o) => (o.logoPath ? repo.mediaUrl(o.logoPath) : Promise.resolve(null))));
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-serif text-3xl">Corporate</h1>
        <p className="mt-1 text-sm text-muted">Logo cookie and cupcake packages. Corporate orders take a cake slot on their pickup day and appear on the kitchen sheet.</p>
      </div>
      <section className="card p-5">
        <h2 className="font-serif text-xl">Packages</h2>
        <ul className="mt-3 divide-y divide-line" data-testid="corp-packages">
          {packages.map((p) => (
            <PackageRow key={p.id} pkg={p} />
          ))}
        </ul>
      </section>
      <section className="card p-5">
        <h2 className="font-serif text-xl">Orders</h2>
        {orders.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No corporate orders yet.</p>
        ) : (
          <ul className="mt-3 grid gap-3" data-testid="corp-orders">
            {orders.map((o, i) => (
              <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line p-3 text-sm">
                <div className="flex gap-3">
                  {logos[i] && (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                    <img src={logos[i]!} alt={`${o.companyName} logo`} className="h-14 w-14 rounded-lg border border-line object-contain" />
                  )}
                  <div>
                    <p className="font-semibold">
                      {o.companyName} <span className="font-normal text-muted">{o.reference}</span>
                    </p>
                    <p>
                      {o.packageName} &middot; {formatDateLong(o.pickupDate)} {formatTime12(o.pickupSlot)}
                    </p>
                    <p className="text-muted">
                      {o.contactName}, {o.email}, {o.phone}
                      {o.abn && `, ABN ${o.abn}`}
                    </p>
                    {o.notes && <p className="text-muted">Notes: {o.notes}</p>}
                    <p>
                      Paid {formatAud(o.amountPaidCents)} of {formatAud(o.totalCents)}
                      {(o.voucherAppliedCents ?? 0) > 0 && `, plus ${formatAud(o.voucherAppliedCents!)} by voucher`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold" data-testid="corp-admin-status">{STATUS[o.status]}</span>
                  {o.status === "confirmed" && <ActionButton action={corporateStatusAction.bind(null, o.id, "ready")} label="Ready" testId="corp-ready" />}
                  {(o.status === "confirmed" || o.status === "ready") && <ActionButton action={corporateStatusAction.bind(null, o.id, "collected")} label="Collected" />}
                  {o.status !== "cancelled" && o.status !== "collected" && (
                    <ActionButton
                      action={corporateStatusAction.bind(null, o.id, "cancel")}
                      label={refundButtonLabel(settings.autoRefunds, o.amountPaidCents, "Cancel").label}
                      confirmText={refundButtonLabel(settings.autoRefunds, o.amountPaidCents, "Cancel this order").confirm}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
