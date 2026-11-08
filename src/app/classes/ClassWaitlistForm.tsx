"use client";

import { useState } from "react";
import { postJson } from "@/components/client/post";

export function ClassWaitlistForm({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ customerName: "", email: "", phone: "", seats: 1 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn btn-ghost !py-2" onClick={() => setOpen(true)} data-testid="class-waitlist-open">
        Join the waitlist
      </button>
    );
  }
  return (
    <div className="grid w-full gap-2 sm:grid-cols-5" data-testid="class-waitlist">
      {msg?.ok ? (
        <p className="sm:col-span-5" role="status" data-testid="class-waitlist-msg">{msg.text}</p>
      ) : (
        <>
          <input className="field" placeholder="Name" aria-label="Waitlist name" value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} />
          <input className="field" type="email" placeholder="Email" aria-label="Waitlist email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input className="field" type="tel" placeholder="Mobile" aria-label="Waitlist mobile" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <select className="field" aria-label="Seats wanted" value={f.seats} onChange={(e) => setF({ ...f, seats: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "seat" : "seats"}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            data-testid="class-waitlist-join"
            onClick={async () => {
              setBusy(true);
              try {
                const d = await postJson<{ place: number }>("/api/classes/waitlist", { sessionId, ...f });
                setMsg({ ok: true, text: `You're number ${d.place} on the waitlist. We'll email you if seats open up.` });
              } catch (e) {
                setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not join the waitlist." });
              } finally {
                setBusy(false);
              }
            }}
          >
            Join
          </button>
          {msg && !msg.ok && <p className="text-sm text-rose-dark sm:col-span-5" role="alert">{msg.text}</p>}
        </>
      )}
    </div>
  );
}
