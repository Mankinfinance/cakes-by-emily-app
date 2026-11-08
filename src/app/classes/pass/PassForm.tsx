"use client";

import { useState } from "react";
import { postJson } from "@/components/client/post";

export function PassForm({ price }: { price: string }) {
  const [f, setF] = useState({ buyerName: "", buyerEmail: "", acceptTerms: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="card mt-6 grid gap-3 p-5">
      <input className="field" placeholder="Your name" aria-label="Your name" value={f.buyerName} onChange={(e) => setF({ ...f, buyerName: e.target.value })} data-testid="pass-name" />
      <input className="field" type="email" placeholder="Email (the code is sent here)" aria-label="Email" value={f.buyerEmail} onChange={(e) => setF({ ...f, buyerEmail: e.target.value })} data-testid="pass-email" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={f.acceptTerms} onChange={(e) => setF({ ...f, acceptTerms: e.target.checked })} data-testid="pass-terms" />
        <span>
          I agree to the{" "}
          <a href="/terms" target="_blank" className="underline">
            terms
          </a>
          . Passes can&apos;t be exchanged for cash.
        </span>
      </label>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || !f.acceptTerms}
        data-testid="pass-buy"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const d = await postJson<{ checkoutUrl: string }>("/api/classes/pass/buy", f);
            window.location.assign(d.checkoutUrl);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Something went wrong.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening secure checkout..." : `Buy the pass for ${price}`}
      </button>
      {error && <p className="text-sm text-rose-dark" role="alert">{error}</p>}
    </div>
  );
}
