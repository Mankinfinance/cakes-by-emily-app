"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toggleKitchenAction } from "../actions";

export function KitchenTick({ kind, id, done, label }: { kind: "cake" | "box"; id: string; done: boolean; label: string }) {
  const router = useRouter();
  const [checked, setChecked] = useState(done);
  const [pending, start] = useTransition();
  return (
    <input
      type="checkbox"
      className="mt-1 h-5 w-5 shrink-0"
      checked={checked}
      disabled={pending}
      aria-label={`Done: ${label}`}
      data-testid={`tick-${label}`}
      onChange={(e) => {
        const next = e.target.checked;
        setChecked(next);
        start(async () => {
          const r = await toggleKitchenAction(kind, id, next);
          if (!r.ok) setChecked(!next);
          router.refresh();
        });
      }}
    />
  );
}

export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary !py-1.5" onClick={() => window.print()} data-testid="print">
      Print
    </button>
  );
}
