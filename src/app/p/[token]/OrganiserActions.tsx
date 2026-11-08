"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/client/post";

export function OrganiserActions({ token, canNudge, canPayRest, restLabel, dueLabel }: { token: string; canNudge: boolean; canPayRest: boolean; restLabel: string; dueLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (path: string, done: (d: Record<string, unknown>) => void) => {
    setBusy(true);
    setMsg(null);
    try {
      done(await postJson(`/api/classes/private/${encodeURIComponent(token)}/${path}`, {}));
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
