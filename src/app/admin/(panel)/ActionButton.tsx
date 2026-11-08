"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "./actions";

/** A button that runs one (bound) server action, with an optional confirm prompt. */
export function ActionButton({
  action,
  label,
  confirmText,
  className = "text-rose underline",
  testId,
}: {
  action: () => Promise<ActionResult>;
  label: string;
  confirmText?: string;
  className?: string;
  testId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        className={className}
        disabled={pending}
        data-testid={testId}
        onClick={() => {
          if (confirmText && !confirm(confirmText)) return;
          start(async () => {
            const r = await action();
            setError(r.ok ? null : r.error);
            router.refresh();
          });
        }}
      >
        {pending ? "..." : label}
      </button>
      {error && (
        <span className="text-xs text-rose-dark" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
