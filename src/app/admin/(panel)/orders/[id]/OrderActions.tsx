"use client";

import { useState, useTransition } from "react";
import { advanceStageAction, cancelOrderAction } from "../../actions";

export function OrderActions({
  orderId,
  nextLabel,
  canCancel,
  cancelLabel = "Cancel order",
  cancelConfirm = "Cancel this order? Because you're cancelling, everything paid should be refunded, and any voucher or credit used comes back as credit. The date is offered to the waitlist.",
}: {
  orderId: string;
  nextLabel: string | null;
  canCancel: boolean;
  cancelLabel?: string;
  cancelConfirm?: string;
}) {
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
          data-testid="admin-cancel"
          onClick={() => {
            if (!confirm(cancelConfirm)) return;
            start(async () => {
              const r = await cancelOrderAction(orderId);
              setError(r.ok ? null : r.error);
            });
          }}
        >
          {cancelLabel}
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
