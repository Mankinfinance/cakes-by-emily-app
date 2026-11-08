import Link from "next/link";
import { notFound } from "next/navigation";
import { Tracker } from "@/components/Tracker";
import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { formatDateLong, formatTime12 } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { balanceOwing } from "@/lib/domain/pricing";
import { nextStage, stageLabel } from "@/lib/domain/stages";
import { DIETARY_FILTERS } from "@/lib/domain/types";
import { siteUrl } from "@/lib/config";
import { reviewLink } from "@/lib/services/common";
import { OrderActions } from "./OrderActions";
import { SendForApproval } from "./SendForApproval";
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
        {order.stage === "collected" && (
          <p className="mt-3 break-all text-sm">
            Review link (sent with the thank-you email):{" "}
            <a className="underline" href={reviewLink(siteUrl(), order.id)} data-testid="review-link">
              {reviewLink(siteUrl(), order.id)}
            </a>
          </p>
        )}
        {order.approvedAt && (
          <p className="mt-3 text-sm" data-testid="approved-at">
            Design approved by the customer on {new Date(order.approvedAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}.
          </p>
        )}
        {order.cancellation && (
          <div className="mt-3 rounded-xl bg-paper p-3 text-sm" data-testid="admin-cancellation">
            <p className="font-semibold">Cancelled by {order.cancellation.by === "emily" ? "you" : order.cancellation.by === "expired" ? "expiry (unpaid)" : "the customer"}</p>
            <p>{order.cancellation.summary}</p>
            {order.cancellation.refundCents > 0 && <p className="mt-1 font-semibold text-rose-dark">Refund {formatAud(order.cancellation.refundCents)} in the Stripe dashboard.</p>}
            {order.cancellation.creditCents > 0 && <p>{formatAud(order.cancellation.creditCents)} issued as a credit code.</p>}
          </div>
        )}
      </section>

      {(order.stage === "received" || order.stage === "awaiting_approval") && (
        <section className="card p-5">
          <h2 className="font-serif text-xl">Send the design for approval</h2>
          <p className="text-sm text-muted">
            Upload a sketch or mood board. The customer approves it, or asks for a change ({order.designChangesUsed} change
            {order.designChangesUsed === 1 ? "" : "s"} so far), from their order page.
          </p>
          <SendForApproval orderId={order.id} />
        </section>
      )}

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
          <p className={`mt-3 rounded-lg p-3 ${order.allergyNotes || order.dietary.length ? "bg-rose text-white" : "bg-paper"}`}>
            <strong>Allergies:</strong> {[...order.dietary.map((d) => DIETARY_FILTERS[d]?.label ?? d), order.allergyNotes].filter(Boolean).join(". ") || "None noted"}
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
            <dt className="text-muted">Birthday reminder</dt>
            <dd>{order.remindNextYear ? "Yes, next year" : "No"}</dd>
            <dt className="text-muted">Date changes</dt>
            <dd>{order.dateChangesUsed}</dd>
            {order.voucherAppliedCents > 0 && (
              <>
                <dt className="text-muted">Voucher or credit</dt>
                <dd>{formatAud(order.voucherAppliedCents)}</dd>
              </>
            )}
            {order.waitlistId && (
              <>
                <dt className="text-muted">Source</dt>
                <dd>Claimed from the waitlist</dd>
              </>
            )}
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
                {(u.kind === "photo" || u.kind === "sketch") && media[i] && (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                  <img src={media[i]!} alt={u.caption} className="mb-2 max-h-56 w-full rounded-lg object-cover" />
                )}
                {u.kind === "video" && media[i] && <video src={media[i]!} controls preload="metadata" className="mb-2 max-h-56 w-full rounded-lg" />}
                {u.kind === "change_request" && <p className="text-xs font-semibold uppercase text-rose">Change requested</p>}
                {u.kind === "sketch" && <p className="text-xs font-semibold uppercase text-rose">Sketch sent</p>}
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
