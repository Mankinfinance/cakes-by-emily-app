"use client";

import { useState } from "react";
import { postJson } from "@/components/client/post";
import type { BoxStatus } from "@/lib/domain/boxes";
import { formatDateLong, formatTime12, weekday } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import type { SeasonalBox } from "@/lib/domain/types";

interface Props {
  box: SeasonalBox;
  status: BoxStatus;
  today: string;
  slots: string[];
  closedWeekdays: number[];
  daysOff: string[];
}

export function BoxOrderForm({ box, status, today, slots, closedWeekdays, daysOff }: Props) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ quantity: 1, pickupDate: "", pickupSlot: "", customerName: "", email: "", phone: "", marketingOptIn: false, acceptTerms: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orderable = status.state === "open";
  const max = Math.min(10, status.remaining);
  const minDate = box.pickupFrom > today ? box.pickupFrom : today;
  const dateProblem =
    f.pickupDate && (closedWeekdays.includes(weekday(f.pickupDate)) || daysOff.includes(f.pickupDate)) ? "Emily is closed that day. Please choose another." : "";
  const sold = box.cap > 0 ? Math.round((Math.min(box.sold, box.cap) / box.cap) * 100) : 100;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<{ checkoutUrl: string }>("/api/boxes", { boxId: box.id, ...f });
      window.location.assign(data.checkoutUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <article className="card p-5" data-testid={`box-${box.name}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-serif text-2xl">{box.name}</h2>
        <p className="text-lg font-semibold">{formatAud(box.priceCents)}</p>
      </div>
      <p className="mt-1 text-sm text-muted">{box.description}</p>
      <p className="mt-2 text-sm">
        Pickup {formatDateLong(box.pickupFrom)} to {formatDateLong(box.pickupTo)}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-blush" aria-hidden>
        <div className="h-full bg-rose" style={{ width: `${sold}%` }} />
      </div>
      <p className="mt-1 flex justify-between text-sm">
        <span data-testid="box-remaining">{status.state === "sold_out" ? "Sold out" : `${status.remaining} left`}</span>
        <span className="font-semibold text-rose" data-testid="box-countdown">{status.label}</span>
      </p>

      {orderable && !open && (
        <button type="button" className="btn btn-primary mt-4" onClick={() => setOpen(true)} data-testid="box-preorder">
          Pre-order
        </button>
      )}
      {orderable && open && (
        <div className="mt-4 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label>
              <span className="label">How many</span>
              <input type="number" min={1} max={max} className="field" value={f.quantity} onChange={(e) => setF({ ...f, quantity: Math.max(1, Math.min(max, Number(e.target.value) || 1)) })} data-testid="box-qty" />
            </label>
            <label>
              <span className="label">Pickup date</span>
              <input type="date" min={minDate} max={box.pickupTo} className="field" value={f.pickupDate} onChange={(e) => setF({ ...f, pickupDate: e.target.value })} data-testid="box-date" />
            </label>
            <label>
              <span className="label">Pickup time</span>
              <select className="field" value={f.pickupSlot} onChange={(e) => setF({ ...f, pickupSlot: e.target.value })} data-testid="box-slot">
                <option value="">Choose</option>
                {slots.map((s) => (
                  <option key={s} value={s}>
                    {formatTime12(s)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {dateProblem && <p className="text-sm text-rose-dark">{dateProblem}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <input className="field" placeholder="Your name" aria-label="Your name" value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} data-testid="box-name" />
            <input className="field" type="email" placeholder="Email" aria-label="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="box-email" />
            <input className="field" type="tel" placeholder="Mobile" aria-label="Mobile" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="box-phone" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={f.acceptTerms} onChange={(e) => setF({ ...f, acceptTerms: e.target.checked })} data-testid="box-terms" />
            <span>
              I agree to the{" "}
              <a href="/terms" target="_blank" className="underline">
                terms
              </a>
              . Seasonal boxes are paid in full and aren&apos;t refundable.
            </span>
          </label>
          <button type="button" className="btn btn-primary" disabled={busy || !f.acceptTerms || !f.pickupDate || !f.pickupSlot || Boolean(dateProblem)} onClick={submit} data-testid="box-pay">
            {busy ? "Opening secure checkout..." : `Pay ${formatAud(box.priceCents * f.quantity)}`}
          </button>
          {error && <p className="text-sm text-rose-dark" role="alert" data-testid="box-error">{error}</p>}
        </div>
      )}
    </article>
  );
}
