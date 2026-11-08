"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/client/post";

type Quote = { ok: boolean; problem: string | null; summary: string; discountLost: boolean };

/** Cancel some seats: pick guests, see the new price and what comes back, then confirm. */
export function CancelSeats({ token, guests }: { token: string; guests: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/classes/booking/${encodeURIComponent(token)}/cancel-seats`;

  async function preview(next: number[]) {
    setPicked(next);
    setQuote(null);
    setError(null);
    if (next.length === 0) return;
    try {
      setQuote(await postJson<Quote>(url, { guests: next, confirm: false }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost mt-3" onClick={() => setOpen(true)} data-testid="seats-cancel-open">
        Cancel some seats
      </button>
    );
  }
  return (
    <div className="mt-3 rounded-xl border border-line p-3 text-sm" data-testid="seats-cancel">
      <p className="font-semibold">Who can&apos;t come?</p>
      <ul className="mt-2 grid gap-1">
        {guests.map((name, i) => (
          <li key={i}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={picked.includes(i)} onChange={(e) => preview(e.target.checked ? [...picked, i].sort((a, b) => a - b) : picked.filter((x) => x !== i))} data-testid={`seat-${i}`} />
              <span>{name}</span>
            </label>
          </li>
        ))}
      </ul>
      {quote && (
        <p className={`mt-3 ${quote.ok ? "" : "text-rose-dark"}`} data-testid="seats-quote" role="status">
          {quote.ok ? quote.summary : quote.problem}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !quote?.ok}
          data-testid="seats-cancel-confirm"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await postJson(url, { guests: picked, confirm: true });
              router.refresh();
              setOpen(false);
              setPicked([]);
              setQuote(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Something went wrong.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {picked.length === 1 ? "Cancel this seat" : picked.length > 1 ? `Cancel these ${picked.length} seats` : "Cancel seats"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); setPicked([]); setQuote(null); }}>
          Keep everyone
        </button>
      </div>
      {error && <p className="mt-2 text-rose-dark" role="alert">{error}</p>}
    </div>
  );
}
