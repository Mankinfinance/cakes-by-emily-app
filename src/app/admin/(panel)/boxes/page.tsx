import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { boxStatus } from "@/lib/domain/boxes";
import { formatDateLong, formatTime12, todayInBusinessTz } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { boxOrderAction } from "../actions";
import { ActionButton } from "../ActionButton";
import { refundButtonLabel } from "@/lib/services/refunds";
import { BoxEditor } from "./BoxEditor";

export default async function BoxesPage() {
  await requireAdmin();
  const repo = await getRepo();
  const [boxes, orders, settings] = await Promise.all([repo.listBoxes(), repo.listBoxOrders(), repo.getSettings()]);
  const today = todayInBusinessTz();
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-serif text-3xl">Seasonal boxes</h1>
        <p className="mt-1 text-sm text-muted">Limited pre-order boxes, paid in full. Untick &ldquo;Show to customers&rdquo; to hide one.</p>
      </div>
      <div className="grid gap-4" data-testid="admin-boxes">
        {boxes.map((b) => (
          <BoxEditor key={b.id} box={b} status={boxStatus(b, today).label} />
        ))}
        <BoxEditor box={null} status="" />
      </div>
      <section className="card p-5">
        <h2 className="font-serif text-xl">Pre-orders</h2>
        {orders.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No pre-orders yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm" data-testid="box-orders">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{o.customerName}</strong> {o.reference}: {o.quantity} x {o.boxName} &middot; {formatDateLong(o.pickupDate)} {formatTime12(o.pickupSlot)} &middot;{" "}
                  {formatAud(o.amountPaidCents)} paid
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-muted">{o.status === "paid" ? "Paid" : o.status === "collected" ? "Collected" : "Cancelled"}</span>
                  {o.status === "paid" && <ActionButton action={boxOrderAction.bind(null, o.id, "collected")} label="Collected" />}
                  {o.status === "paid" && (
                    <ActionButton
                      action={boxOrderAction.bind(null, o.id, "cancel")}
                      label={refundButtonLabel(settings.autoRefunds, o.amountPaidCents, "Cancel").label}
                      confirmText={refundButtonLabel(settings.autoRefunds, o.amountPaidCents, "Cancel this pre-order").confirm}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
