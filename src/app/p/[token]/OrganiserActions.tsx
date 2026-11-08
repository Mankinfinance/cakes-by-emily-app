"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/client/post";

export function OrganiserActions({
  token,
  canNudge,
  canPayRest,
  restLabel,
  dueLabel,
  guests,
  minGuests,
  canReduce,
}: {
  token: string;
  canNudge: boolean;
  canPayRest: boolean;
  restLabel: string;
  dueLabel: string;
  guests: number;
  minGuests: number;
  canReduce: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newCount, setNewCount] = useState(Math.max(minGuests, guests - 1));
  const [preview, setPreview] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (path: string, done: (d: Record<string, unknown>) => void, payload: Record<string, unknown> = {}) => {
    setBusy(true);
    setMsg(null);
    try {
      done(await postJson(`/api/classes/private/${encodeURIComponent(token)}/${path}`, payload));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 grid gap-3">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || !canNudge}
          data-testid="nudge"
          onClick={() =>
            run("nudge", (d) => {
              setMsg({ ok: true, text: `Reminder sent to ${d.sent} guest${d.sent === 1 ? "" : "s"}.` });
              router.refresh();
            })
          }
        >
          Send a reminder
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !canPayRest}
          data-testid="pay-rest"
          onClick={() => run("pay-rest", (d) => window.location.assign(String(d.checkoutUrl)))}
        >
          Pay the remaining {restLabel}
        </button>
      </div>
      {canReduce && guests > minGuests && (
        <div className="grid gap-2 rounded-xl border border-line p-3" data-testid="organiser-reduce">
          <p className="font-semibold">Fewer guests coming?</p>
          <p className="text-xs text-muted">
            You can remove places that haven&apos;t been paid, down to {minGuests} guests, until {dueLabel}. The places still to pay are worked out again.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              className="field w-24"
              min={minGuests}
              max={guests - 1}
              value={newCount}
              onChange={(e) => {
                setNewCount(Number(e.target.value));
                setPreview(null);
              }}
              aria-label="New number of guests"
              data-testid="organiser-reduce-guests"
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              data-testid="organiser-reduce-preview"
              onClick={() => run("reduce", (d) => setPreview({ ok: !!d.ok, text: String(d.ok ? d.summary : d.problem) }), { guests: newCount, confirm: false })}
            >
              Preview
            </button>
          </div>
          {preview && (
            <div className="rounded-lg bg-blush p-3 text-sm" data-testid="organiser-reduce-summary">
              <p>{preview.text}</p>
              {preview.ok && (
                <button
                  type="button"
                  className="btn btn-primary mt-2"
                  disabled={busy}
                  data-testid="organiser-reduce-confirm"
                  onClick={() =>
                    run(
                      "reduce",
                      () => {
                        setPreview(null);
                        setMsg({ ok: true, text: "Guest numbers updated." });
                        router.refresh();
                      },
                      { guests: newCount, confirm: true },
                    )
                  }
                >
                  Confirm
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {!canPayRest && <p className="text-xs text-muted">You can pay any shares still owing from {dueLabel}.</p>}
      {!canNudge && <p className="text-xs text-muted">Reminders can be sent once a day to guests who have added their details but not paid.</p>}
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "" : "text-rose-dark"}`} data-testid="organiser-msg">
          {msg.text}
        </p>
      )}
    </div>
  );
}
