"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { compressImage } from "@/lib/client/image";
import { sendForApprovalAction } from "../../actions";

export function SendForApproval({ orderId }: { orderId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="mt-3 grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const form = new FormData();
          form.set("orderId", orderId);
          form.set("note", note);
          const file = fileRef.current?.files?.[0];
          if (file) {
            try {
              form.set("sketch", await compressImage(file), file.name);
            } catch (err) {
              setMsg({ ok: false, text: err instanceof Error ? err.message : "That image could not be used." });
              return;
            }
          }
          const r = await sendForApprovalAction(form);
          setMsg(r.ok ? { ok: true, text: "Sent. The customer has been emailed." } : { ok: false, text: r.error });
          if (r.ok) {
            setNote("");
            if (fileRef.current) fileRef.current.value = "";
          }
          router.refresh();
        });
      }}
    >
      <input ref={fileRef} type="file" accept="image/*" className="text-sm" aria-label="Sketch or mood board" data-testid="sketch-file" />
      <textarea className="field" rows={2} maxLength={500} placeholder="A note about the design (optional)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="sketch-note" />
      <button className="btn btn-primary justify-self-start" disabled={pending} data-testid="send-sketch">
        {pending ? "Sending..." : "Send for approval"}
      </button>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "" : "text-rose-dark"}`} data-testid="sketch-msg">
          {msg.text}
        </p>
      )}
    </form>
  );
}
