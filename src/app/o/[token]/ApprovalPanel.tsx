"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/client/post";

export function ApprovalPanel({ token, freeRoundsLeft, canChange, changeReason }: { token: string; freeRoundsLeft: number; canChange: boolean; changeReason: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "change">("idle");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(path: string, body: unknown, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      await postJson(`/api/orders/${encodeURIComponent(token)}/${path}`, body);
      setMsg({ ok: true, text: okText });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary" disabled={busy} data-testid="approve-design" onClick={() => run("approve", {}, "Thank you! Your design is confirmed.")}>
            Approve design
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy || !canChange} data-testid="request-change" onClick={() => setMode("change")}>
            Request a change
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          <label className="label" htmlFor="change-text">
            What would you like changed?
          </label>
          <textarea id="change-text" className="field" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} data-testid="change-text" />
          <p className="text-xs text-muted" data-testid="change-rounds">
            {freeRoundsLeft > 0
              ? `${freeRoundsLeft === 1 ? "1 free change round" : `${freeRoundsLeft} free change rounds`} left.`
              : "You've used your free change round. Further changes may incur a fee, and Emily will confirm."}
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary" disabled={busy || text.trim().length < 3} data-testid="send-change" onClick={() => run("change-request", { request: text }, "Sent to Emily. She'll be in touch with an updated design.")}>
              Send to Emily
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode("idle")}>
              Back
            </button>
          </div>
        </div>
      )}
      {!canChange && changeReason && <p className="mt-2 text-xs text-muted">{changeReason}</p>}
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`mt-3 text-sm ${msg.ok ? "" : "text-rose-dark"}`} data-testid="approval-msg">
          {msg.text}
        </p>
      )}
    </div>
  );
}
