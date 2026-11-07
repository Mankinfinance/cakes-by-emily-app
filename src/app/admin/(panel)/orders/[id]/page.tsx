import Link from "next/link";
import { notFound } from "next/navigation";
import { Tracker } from "@/components/Tracker";
import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { formatDateLong, formatTime12 } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { balanceOwing } from "@/lib/domain/pricing";
import { nextStage, stageLabel } from "@/lib/domain/stages";
import { OrderActions } from "./OrderActions";
import { PostUpdate } from "./PostUpdate";

export default async function AdminOrder({ params }: PageProps<"/admin/orders/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const repo = await getRepo();
  const order = await repo.getOrderById(id);
  if (!order) notFound();
  const [updates, inspiration] = await Promise.all([
    repo.listUpdates(order.id),
    order.inspirationPath ? repo.mediaUrl(order.inspirationPath) : Promise.resolve(null),
  ]);
  const media = await Promise.all(updates.map((u) => (u.mediaPath ? repo.mediaUrl(u.mediaPath) : Promise.resolve(null))));
  const next = nextStage(order.stage);

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/admin" className="text-sm text-muted hover:text-rose">
          &larr; All orders
        </Link>
        <h1 className="mt-1 font-serif text-3xl">
          {order.customerName} <span className="text-lg text-muted">{order.reference}</span>
        </h1>
        <p className="text-muted">
          Pickup {formatDateLong(order.pickupDate)} at {formatTime12(order.pickupSlot)}
          {order.isRush && " (rush order)"}
        </p>
      </div>

      <section className="card p-5">
        <Tracker stage={order.stage} />
        <div className="mt-4">
          <OrderActions orderId={order.id} nextLabel={next ? stageLabel(next) : null} canCancel={order.stage !== "cancelled" && order.stage !== "collected"} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5 text-sm">
          <h2 className="font-serif text-xl">Cake</h2>
          <ul className="mt-3 divide-y divide-line">
            {order.items.map((i, k) => (
              <li key={k} className="flex justify-between py-2">
                <span>{i.name}</span>
                <span>{i.amountCents ? formatAud(i.amountCents) : "-"}</span>
              </li>
            ))}
          </ul>
          {order.config.topperText && (
            <p className="mt-3">
              <strong>Topper:</strong> {order.config.topperText}
            </p>
          )}
          <p className={`mt-3 rounded-lg p-3 ${order.allergyNotes ? "bg-rose text-white" : "bg-paper"}`}>
            <strong>Allergies:</strong> {order.allergyNotes || "None noted"}
          </p>
          {order.notes && (
            <p className="mt-3 whitespace-pre-line">
              <strong>Notes:</strong> {order.notes}
            </p>
          )}
          {inspiration && (
            <div className="mt-3">
              <p className="font-semibold">Inspiration photo</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
              <img src={inspiration} alt="Customer's inspiration" className="mt-2 max-h-80 rounded-lg" />
            </div>
          )}
        </section>

        <section className="card p-5 text-sm">
          <h2 className="font-serif text-xl">Customer and payment</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">Email</dt>
            <dd>
              <a className="underline" href={`mailto:${order.email}`}>
                {order.email}
              </a>
            </dd>
            <dt className="text-muted">Mobile</dt>
            <dd>
              <a className="underline" href={`tel:${order.phone.replace(/\s/g, "")}`}>
                {order.phone}
              </a>
            </dd>
            <dt className="text-muted">Marketing</dt>
            <dd>{order.marketingOptIn ? "Opted in" : "No"}</dd>
            <dt className="text-muted">Total</dt>
            <dd>{formatAud(order.totalCents)}</dd>
            <dt className="text-muted">Paid</dt>
            <dd>{formatAud(order.amountPaidCents)}</dd>
            <dt className="font-semibold">Owing</dt>
            <dd className="font-semibold">{formatAud(balanceOwing(order))}</dd>
          </dl>
          <p className="mt-3 text-xs text-muted">Refunds are made in the Stripe dashboard.</p>
        </section>
      </div>

      <section className="card p-5">
        <h2 className="font-serif text-xl">Post an update</h2>
        <p className="text-sm text-muted">Photos and videos appear on the customer&apos;s order page straight away and they get an email.</p>
        <PostUpdate orderId={order.id} />
        {updates.length > 0 && (
          <ul className="mt-5 grid gap-3 sm:grid-cols-2" data-testid="admin-updates">
            {updates.map((u, i) => (
              <li key={u.id} className="rounded-xl border border-line p-3 text-sm">
                {u.kind === "photo" && media[i] && (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                  <img src={media[i]!} alt={u.caption} className="mb-2 max-h-56 w-full rounded-lg object-cover" />
                )}
                {u.kind === "video" && media[i] && <video src={media[i]!} controls preload="metadata" className="mb-2 max-h-56 w-full rounded-lg" />}
                <p>{u.caption}</p>
                <p className="text-xs text-muted">{new Date(u.createdAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
