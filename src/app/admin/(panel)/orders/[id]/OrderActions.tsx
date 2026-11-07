"use client";

import { useState, useTransition } from "react";
import { advanceStageAction, cancelOrderAction } from "../../actions";

export function OrderActions({ orderId, nextLabel, canCancel }: { orderId: string; nextLabel: string | null; canCancel: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {nextLabel && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          data-testid="advance-stage"
          onClick={() =>
            start(async () => {
              const r = await advanceStageAction(orderId);
              setError(r.ok ? null : r.error);
            })
          }
        >
          {pending ? "Saving..." : `Move to: ${nextLabel}`}
        </button>
      )}
      {canCancel && (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pending}
          onClick={() => {
            if (!confirm("Cancel this order? This frees the date. Refunds are made separately in Stripe.")) return;
            start(async () => {
              const r = await cancelOrderAction(orderId);
              setError(r.ok ? null : r.error);
            });
          }}
        >
          Cancel order
        </button>
      )}
      {error && (
        <p className="text-sm text-rose-dark" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
