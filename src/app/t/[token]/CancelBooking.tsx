"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/client/post";

export function CancelBooking({ token, summary }: { token: string; summary: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4 border-t border-line pt-4" data-testid="ticket-cancel">
      <p className="text-sm" data-testid="ticket-cancel-rule">{summary}</p>
      {!open ? (
        <button type="button" className="btn btn-ghost mt-3" onClick={() => setOpen(true)} data-testid="ticket-cancel-open">
          Cancel my booking
        </button>
      ) : (
        <div className="mt-3 rounded-xl border border-rose p-3 text-sm">
          <p className="font-semibold">Are you sure? Your seats go to the next person on the waitlist.</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              data-testid="ticket-cancel-confirm"
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await postJson(`/api/classes/booking/${encodeURIComponent(token)}/cancel`, { confirm: true });
                  router.refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Something went wrong.");
                  setBusy(false);
                }
              }}
            >
              Yes, cancel
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Keep my booking
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-rose-dark" role="alert">{error}</p>}
    </div>
  );
}
