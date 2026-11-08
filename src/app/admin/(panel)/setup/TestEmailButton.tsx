"use client";

import { useState, useTransition } from "react";
import { sendSetupTestEmailAction } from "../actions";

export function TestEmailButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn btn-ghost"
        disabled={pending}
        data-testid="send-test-email"
        onClick={() =>
          start(async () => {
            const r = await sendSetupTestEmailAction();
            setMsg(r.ok ? { ok: true, text: `Sent to ${r.data?.to}. Check that inbox (and spam).` } : { ok: false, text: r.error });
          })
        }
      >
        {pending ? "Sending..." : "Send a test email to ADMIN_NOTIFY_EMAIL"}
      </button>
      {msg && (
        <span role="status" className={msg.ok ? "text-green-800" : "text-rose"} data-testid="test-email-result">
          {msg.text}
        </span>
      )}
    </div>
  );
}
