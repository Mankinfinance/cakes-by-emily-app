"use client";

import { useState } from "react";

export function PayBalanceButton({ token, amount }: { token: string; amount: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(token)}/balance`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { checkoutUrl?: string; error?: string };
      if (!res.ok || !data.checkoutUrl) throw new Error(data.error ?? "Could not start the payment.");
      window.location.assign(data.checkoutUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the payment.");
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={pay} disabled={busy} data-testid="pay-balance">
        {busy ? "Opening secure checkout..." : `Pay balance ${amount}`}
      </button>
      {error && <p className="mt-2 text-sm text-rose-dark" role="alert">{error}</p>}
    </>
  );
}
