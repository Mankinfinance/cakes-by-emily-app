"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/client/post";
import { DIETARY_FILTERS, type DietaryFilter } from "@/lib/domain/types";

type Initial = { name: string; email: string; allergies: string; dietary: DietaryFilter[]; messageOptIn: boolean };

/** A guest changes their own details, up to the cut-off. */
export function GuestEditForm({ tokens, initial, deadline }: { tokens: { shareToken: string; guestId: string; guestToken: string }; initial: Initial; deadline: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ready = f.name.trim() && /^\S+@\S+\.\S+$/.test(f.email);

  if (!open) {
    return (
      <div className="mt-4">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)} data-testid="guest-edit-open">
          Change my details
        </button>
        <p className="mt-1 text-xs text-muted">You can change your details until {deadline}.</p>
        {msg && <p className={`mt-2 text-sm ${msg.ok ? "" : "text-rose-dark"}`} role="status" data-testid="guest-edit-result">{msg.text}</p>}
      </div>
    );
  }
  return (
    <div className="mt-4 grid gap-3 rounded-xl border border-line p-4" data-testid="guest-edit">
      <input className="field" aria-label="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="edit-name" />
      <input className="field" type="email" aria-label="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="edit-email" />
      <fieldset>
        <legend className="label">Dietary needs</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(DIETARY_FILTERS) as DietaryFilter[]).map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={f.dietary.includes(k)} onClick={() => setF({ ...f, dietary: f.dietary.includes(k) ? f.dietary.filter((x) => x !== k) : [...f.dietary, k] })}>
              {DIETARY_FILTERS[k].label}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        <span className="label">Allergies Emily should know about</span>
        <textarea className="field" rows={2} maxLength={300} value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} data-testid="edit-allergies" />
        <span className="mt-1 block text-xs text-muted">Only Emily sees this. If you change it, she&apos;s told straight away.</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={f.messageOptIn} onChange={(e) => setF({ ...f, messageOptIn: e.target.checked })} />
        <span>Send me the occasional email about classes and treats. (Optional.)</span>
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !ready}
          data-testid="edit-save"
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const r = await postJson<{ allergyChanged: boolean }>("/api/private/guest/edit", { ...tokens, ...f });
              setMsg({ ok: true, text: r.allergyChanged ? "Saved. Emily has been told about the allergy change." : "Saved." });
              setOpen(false);
              router.refresh();
            } catch (e) {
              setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." });
            } finally {
              setBusy(false);
            }
          }}
        >
          Save changes
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => { setF(initial); setOpen(false); }}>
          Cancel
        </button>
      </div>
      {msg && !msg.ok && <p className="text-sm text-rose-dark" role="alert" data-testid="guest-edit-error">{msg.text}</p>}
    </div>
  );
}
