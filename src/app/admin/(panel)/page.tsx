import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { formatDateLong, formatTime12, todayInBusinessTz } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { balanceOwing } from "@/lib/domain/pricing";
import { stageLabel } from "@/lib/domain/stages";

export default async function AdminOrders({ searchParams }: PageProps<"/admin">) {
  await requireAdmin();
  const { view } = await searchParams;
  const repo = await getRepo();
  const today = todayInBusinessTz();
  const all = await repo.listOrders();
  const orders = all.filter((o) => {
    if (view === "past") return o.pickupDate < today || o.stage === "collected";
    if (view === "cancelled") return o.stage === "cancelled";
    return o.pickupDate >= today && o.stage !== "cancelled" && o.stage !== "collected";
  });
  if (view === "past") orders.reverse();

  const tabs = [
    { key: undefined, label: "Upcoming" },
    { key: "past", label: "Past" },
    { key: "cancelled", label: "Cancelled" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl">Orders</h1>
        <div className="flex gap-1 text-sm">
          {tabs.map((t) => (
            <Link
              key={t.label}
              href={t.key ? `/admin?view=${t.key}` : "/admin"}
              className={`chip ${view === t.key ? "!bg-plum !text-white" : ""}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>
      {orders.length === 0 ? (
        <p className="mt-8 text-muted">No orders here yet.</p>
      ) : (
        <ul className="mt-6 grid gap-3" data-testid="admin-orders">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/admin/orders/${o.id}`} className="card flex flex-wrap items-center justify-between gap-3 p-4 hover:border-rose">
                <div>
                  <p className="font-semibold">
                    {o.customerName} <span className="text-sm font-normal text-muted">{o.reference}</span>
                    {o.isRush && <span className="ml-2 rounded-full bg-[#fbf3e6] px-2 py-0.5 text-xs font-semibold text-gold">Rush</span>}
                    {o.allergyNotes && <span className="ml-2 rounded-full bg-rose px-2 py-0.5 text-xs font-semibold text-white">Allergies</span>}
                  </p>
                  <p className="text-sm text-muted">
                    {formatDateLong(o.pickupDate)}, {formatTime12(o.pickupSlot)} &middot; {o.items.find((i) => i.category === "size")?.name},{" "}
                    {o.items.find((i) => i.category === "finish")?.name}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-semibold">{stageLabel(o.stage)}</p>
                  <p className="text-muted">{balanceOwing(o) > 0 ? `${formatAud(balanceOwing(o))} owing` : "Paid in full"}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
