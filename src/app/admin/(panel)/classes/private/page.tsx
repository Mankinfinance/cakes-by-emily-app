import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { formatDateLong, formatTime12 } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { shareDueDate, splitProgress } from "@/lib/domain/split";
import { DIETARY_FILTERS } from "@/lib/domain/types";
import { refundButtonLabel } from "@/lib/services/refunds";
import { cancelPrivateAction, privateAction } from "../../actions";
import { ActionButton } from "../../ActionButton";
import { ReduceGuests } from "./ReduceGuests";

const STATUS = { requested: "New request", accepted: "Accepted (deposit link sent)", declined: "Declined", paid: "Deposit paid", cancelled: "Cancelled" } as const;

export default async function PrivateRequestsAdmin() {
  await requireAdmin();
  const repo = await getRepo();
  const [requests, settings] = await Promise.all([repo.listPrivateRequests(), repo.getSettings()]);
  const details = await Promise.all(
    requests.map(async (r) => {
      const [guests, payments] = await Promise.all([repo.listGuests(r.id), repo.listPaidPayments("private", r.id)]);
      return { guests, paidCents: payments.reduce((s, p) => s + p.amountCents - (p.refundedCents ?? 0), 0) };
    }),
  );
  return (
    <div>
      <Link href="/admin/classes" className="text-sm text-muted hover:text-rose">
        &larr; Classes
      </Link>
      <h1 className="mt-1 font-serif text-3xl">Private class requests</h1>
      <p className="mt-1 text-sm text-muted">
        Accepting emails the customer a link to pay the deposit. Once it&apos;s paid they get a share link for their guests: each guest adds their details and
        pays their share. Accepted and paid dates take no cake orders when that setting is on.
      </p>
      {requests.length === 0 && <p className="mt-8 text-muted">No requests yet.</p>}
      <ul className="mt-6 grid gap-3" data-testid="private-requests">
        {requests.map((r, i) => {
          const { guests, paidCents } = details[i];
          const progress = splitProgress(guests);
          const cancel = refundButtonLabel(settings.autoRefunds, paidCents, "Cancel private class");
          return (
            <li key={r.id} className="card grid gap-3 p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {r.packageName} x {r.guests} <span className="font-normal text-muted">{r.reference}</span>
                  </p>
                  <p>
                    {formatDateLong(r.preferredDate)} at {formatTime12(r.preferredTime)} {r.occasion && `· ${r.occasion}`}
                  </p>
                  <p className="text-muted">
                    {r.contactName}, {r.email}, {r.phone}
                  </p>
                  {r.notes && <p className="text-muted">Notes: {r.notes}</p>}
                  <p>
                    Estimate {formatAud(r.estimateCents)}, deposit {formatAud(r.depositCents)}. Paid so far {formatAud(paidCents)}.
                  </p>
                  {r.cancellation && <p className="mt-1">{r.cancellation.summary}</p>}
                  {(r.guestReductions ?? []).map((g) => (
                    <p key={g.at} className="mt-1" data-testid="reduction-record">
                      {g.summary}
                      {(g.autoRefundedCents ?? 0) > 0 && (
                        <span className="text-muted">
                          {" "}
                          Refunded through Stripe: {formatAud(g.autoRefundedCents!)} ({(g.refundIds ?? []).join(", ")}).
                        </span>
                      )}
                    </p>
                  ))}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="font-semibold" data-testid="private-status">
                    {STATUS[r.status]}
                  </span>
                  {r.status === "requested" && (
                    <span className="flex gap-3">
                      <ActionButton action={privateAction.bind(null, r.id, "accept")} label="Accept" testId="private-accept" />
                      <ActionButton action={privateAction.bind(null, r.id, "decline")} label="Decline" confirmText="Decline this request? The customer is emailed." />
                    </span>
                  )}
                  {(r.status === "accepted" || r.status === "paid") && (
                    <ActionButton action={cancelPrivateAction.bind(null, r.id)} label={cancel.label} confirmText={cancel.confirm} testId="private-cancel" />
                  )}
                  {r.status === "paid" && guests.length > 0 && (
                    <ReduceGuests
                      id={r.id}
                      current={r.guests}
                      min={settings.privatePackages.find((p) => p.key === r.packageKey)?.minGuests ?? 1}
                      autoRefunds={settings.autoRefunds}
                    />
                  )}
                </div>
              </div>
              {guests.length > 0 && (
                <div data-testid={`split-${r.reference}`}>
                  <p className="font-semibold" data-testid="split-progress">
                    {progress.paid} of {progress.guests} shares paid ({formatAud(progress.paidCents)} in, {formatAud(progress.owingCents)} to come) &middot; due{" "}
                    {formatDateLong(shareDueDate(r, settings.splitDueDays))}
                  </p>
                  <ul className="mt-2 divide-y divide-line" data-testid="private-guests">
                    {guests.map((g) => (
                      <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                        <span>
                          {g.name ? <strong>{g.name}</strong> : <span className="rounded-full bg-[#fbf3e6] px-2 py-0.5 text-xs font-semibold text-gold">Details missing</span>}
                          {g.email && <span className="text-muted"> ({g.email})</span>}
                          {g.messageOptIn && <span className="text-muted"> · happy to get emails</span>}
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          {(g.allergies || g.dietary.length > 0) && (
                            <span className="rounded-md bg-rose px-2 py-0.5 text-xs font-semibold text-white">
                              ALLERGIES: {[...g.dietary.map((d) => DIETARY_FILTERS[d]?.label ?? d), g.allergies].filter(Boolean).join(". ")}
                            </span>
                          )}
                          <span className={g.status === "paid" ? "font-semibold text-rose" : "text-muted"}>
                            {g.status === "paid" ? "Paid" : "Not paid"} {formatAud(g.shareCents)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
