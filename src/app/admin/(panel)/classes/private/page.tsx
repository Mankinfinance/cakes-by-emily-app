import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { formatDateLong, formatTime12 } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { privateAction } from "../../actions";
import { ActionButton } from "../../ActionButton";

const STATUS = { requested: "New request", accepted: "Accepted (deposit link sent)", declined: "Declined", paid: "Deposit paid" } as const;

export default async function PrivateRequestsAdmin() {
  await requireAdmin();
  const requests = await (await getRepo()).listPrivateRequests();
  return (
    <div>
      <Link href="/admin/classes" className="text-sm text-muted hover:text-rose">
        &larr; Classes
      </Link>
      <h1 className="mt-1 font-serif text-3xl">Private class requests</h1>
      <p className="mt-1 text-sm text-muted">Accepting emails the customer a link to pay the deposit. Accepted and paid dates take no cake orders when that setting is on.</p>
      {requests.length === 0 && <p className="mt-8 text-muted">No requests yet.</p>}
      <ul className="mt-6 grid gap-3" data-testid="private-requests">
        {requests.map((r) => (
          <li key={r.id} className="card flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
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
                Estimate {formatAud(r.estimateCents)}, deposit {formatAud(r.depositCents)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="font-semibold" data-testid="private-status">{STATUS[r.status]}</span>
              {r.status === "requested" && (
                <span className="flex gap-3">
                  <ActionButton action={privateAction.bind(null, r.id, "accept")} label="Accept" testId="private-accept" />
                  <ActionButton action={privateAction.bind(null, r.id, "decline")} label="Decline" confirmText="Decline this request? The customer is emailed." />
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
