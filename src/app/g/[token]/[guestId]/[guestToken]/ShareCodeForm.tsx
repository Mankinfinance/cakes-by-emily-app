"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/client/post";

/** A guest uses a gift voucher, credit code or class pass on their own share. */
export function ShareCodeForm({ tokens }: { tokens: { shareToken: string; guestId: string; guestToken: string } }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4 rounded-xl border border-line p-3" data-testid="share-code">
      <label className="label" htmlFor="share-code-input">
        Have a gift voucher, credit code or class pass?
      </label>
      <div className="flex flex-wrap gap-2">
        <input id="share-code-input" className="field min-w-0 flex-1 font-mono uppercase" placeholder="XXXX-XXXX-XXXX-XXXX" value={code} maxLength={24} onChange={(e) => setCode(e.target.value)} data-testid="share-code-input" />
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || code.trim().length < 16}
          data-testid="share-code-apply"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await postJson("/api/private/guest/code", { ...tokens, code });
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Something went wrong.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Apply
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">One code per share. A class pass credit covers up to what one credit cost.</p>
      {error && <p className="mt-2 text-sm text-rose-dark" role="alert" data-testid="share-code-error">{error}</p>}
    </div>
  );
}
