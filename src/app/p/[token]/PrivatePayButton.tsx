"use client";

import { useState } from "react";
import { postJson } from "@/components/client/post";

export function PrivatePayButton({ token, amount }: { token: string; amount: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        data-testid="private-pay"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const d = await postJson<{ checkoutUrl: string }>(`/api/classes/private/${encodeURIComponent(token)}/pay`, {});
            window.location.assign(d.checkoutUrl);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not start the payment.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening secure checkout..." : `Pay the ${amount} deposit`}
      </button>
      {error && <p className="mt-2 text-sm text-rose-dark" role="alert">{error}</p>}
    </>
  );
}
