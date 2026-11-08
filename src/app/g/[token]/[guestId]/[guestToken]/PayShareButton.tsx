"use client";

import { useState } from "react";
import { postJson } from "@/components/client/post";

export function PayShareButton({ shareToken, guestId, guestToken, amount }: { shareToken: string; guestId: string; guestToken: string; amount: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        data-testid="pay-share"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const d = await postJson<{ checkoutUrl: string }>("/api/private/guest/pay", { shareToken, guestId, guestToken });
            window.location.assign(d.checkoutUrl);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not start the payment.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening secure checkout..." : `Pay my share ${amount}`}
      </button>
      {error && <p className="mt-2 text-sm text-rose-dark" role="alert">{error}</p>}
    </>
  );
}
