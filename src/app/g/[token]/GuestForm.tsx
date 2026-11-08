"use client";

import { useState } from "react";
import { postJson } from "@/components/client/post";
import { DIETARY_FILTERS, type DietaryFilter } from "@/lib/domain/types";

export function GuestForm({ shareToken, shareLabel }: { shareToken: string; shareLabel: string }) {
  const [f, setF] = useState({ name: "", email: "", allergies: "", messageOptIn: false });
  const [dietary, setDietary] = useState<DietaryFilter[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = f.name.trim() && /^\S+@\S+\.\S+$/.test(f.email);

  async function submit(pay: boolean) {
    setBusy(true);
    setError(null);
    try {
      const d = await postJson<{ guestUrl: string; checkoutUrl: string | null }>("/api/private/guest", { shareToken, ...f, dietary, pay });
      window.location.assign(d.checkoutUrl ?? d.guestUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="card mt-6 grid gap-3 p-5">
      <input className="field" placeholder="Your name" aria-label="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="guest-name" />
      <input className="field" type="email" placeholder="Email (for your receipt)" aria-label="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="guest-email" />
      <fieldset>
        <legend className="label">Dietary needs</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(DIETARY_FILTERS) as DietaryFilter[]).map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={dietary.includes(k)} onClick={() => setDietary(dietary.includes(k) ? dietary.filter((x) => x !== k) : [...dietary, k])}>
              {DIETARY_FILTERS[k].label}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        <span className="label">Allergies Emily should know about</span>
        <textarea className="field" rows={2} maxLength={300} value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} data-testid="guest-allergies" />
        <span className="mt-1 block text-xs text-muted">Only Emily sees this. Other guests and the organiser don&apos;t.</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={f.messageOptIn} onChange={(e) => setF({ ...f, messageOptIn: e.target.checked })} data-testid="guest-optin" />
        <span>Send me the occasional email about classes and treats. (Optional.)</span>
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={() => submit(true)} data-testid="guest-pay">
          Save and pay my share {shareLabel}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy || !ready} onClick={() => submit(false)} data-testid="guest-save">
          Just save my details
        </button>
      </div>
      {error && <p className="text-sm text-rose-dark" role="alert" data-testid="guest-error">{error}</p>}
    </div>
  );
}
