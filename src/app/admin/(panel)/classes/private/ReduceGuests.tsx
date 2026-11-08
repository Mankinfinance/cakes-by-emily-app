"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { previewReduceGuestsAction, reduceGuestsAction } from "../../actions";

/** Emily lowers a private class's guest numbers: preview first, then confirm. */
export function ReduceGuests({ id, current, min, autoRefunds }: { id: string; current: number; min: number; autoRefunds: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [guests, setGuests] = useState(Math.max(min, current - 1));
  const [waive, setWaive] = useState(false);
  const [preview, setPreview] = useState<{ ok: boolean; problem: string | null; summary: string; refundCents: number } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const note = msg && (
    <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "" : "text-rose-dark"}`} data-testid="reduce-msg">
      {msg.text}
    </p>
  );
  if (current <= min) return note || null;
  if (!open) {
    return (
      <span className="flex flex-col items-end gap-1">
        <button type="button" className="text-rose underline" onClick={() => setOpen(true)} data-testid="reduce-open">
          Fewer guests
        </button>
        {note}
      </span>
    );
  }
  const runPreview = () =>
    start(async () => {
      setMsg(null);
      const r = await previewReduceGuestsAction(id, guests, waive);
      if (r.ok) setPreview(r.data!);
      else setMsg({ ok: false, text: r.error });
    });
  const confirmIt = () =>
    start(async () => {
      const r = await reduceGuestsAction(id, guests, waive);
      if (r.ok) {
        setMsg({ ok: true, text: "Guest numbers updated. Everyone affected has been emailed." });
        setPreview(null);
        setOpen(false);
        router.refresh();
      } else setMsg({ ok: false, text: r.error });
    });
  return (
    <div className="grid w-full max-w-sm gap-2 rounded-xl border border-line p-3 text-left text-sm" data-testid="reduce-form">
      <label className="grid gap-1">
        <span className="font-semibold">New number of guests (minimum {min})</span>
        <input
          type="number"
          className="field"
          min={min}
          max={current - 1}
          value={guests}
          onChange={(e) => {
            setGuests(Number(e.target.value));
            setPreview(null);
          }}
          data-testid="reduce-guests"
        />
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={waive}
          onChange={(e) => {
            setWaive(e.target.checked);
            setPreview(null);
          }}
          data-testid="reduce-waive"
        />
        <span>Refund paid places in full, whatever the terms say</span>
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={runPreview} data-testid="reduce-preview">
          Preview
        </button>
        <button type="button" className="text-muted underline" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      {preview && (
        <div className="rounded-lg bg-blush p-3" data-testid="reduce-summary">
          <p>{preview.ok ? preview.summary : preview.problem}</p>
          {preview.ok && (
            <button type="button" className="btn btn-primary mt-2" disabled={pending} onClick={confirmIt} data-testid="reduce-confirm">
              {preview.refundCents > 0 && autoRefunds ? "Confirm and refund via Stripe" : "Confirm"}
            </button>
          )}
        </div>
      )}
      {note}
    </div>
  );
}
