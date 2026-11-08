"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { postJson } from "@/components/client/post";
import { formatTime12 } from "@/lib/domain/dates";
import type { TermsCheck } from "@/lib/domain/terms";

interface Props {
  token: string;
  check: TermsCheck;
  minDate: string;
}

interface SlotInfo {
  time: string;
  available: boolean;
}

export function ChangeOrCancel({ token, check, minDate }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState<"none" | "date" | "cancel">("none");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<SlotInfo[] | null>(null);
  const [slotNote, setSlotNote] = useState("");
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!date) return;
    let live = true;
    fetch(`/api/slots?date=${date}&order=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d: { slots?: SlotInfo[]; bookable?: boolean; isRush?: boolean }) => {
        if (!live) return;
        setSlots(d.slots ?? []);
        setSlotNote(!d.bookable ? "That date isn't available." : d.isRush ? "That date is inside the notice period. Please message Emily." : "");
      })
      .catch(() => live && setSlotNote("Could not load times. Please try again."));
    return () => {
      live = false;
    };
  }, [date, token]);

  async function run(path: string, body: unknown, okText: (d: Record<string, unknown>) => string) {
    setBusy(true);
    setMsg(null);
    try {
      const data = await postJson(`/api/orders/${encodeURIComponent(token)}/${path}`, body);
      setMsg({ ok: true, text: okText(data) });
      setOpen("none");
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="change-cancel">
      <ul className="grid gap-2 text-sm">
        <li className="flex items-start gap-2">
          <span aria-hidden>{check.canChangeDesign ? "✓" : "✕"}</span>
          <span>{check.canChangeDesign ? "You can still ask for design changes." : check.designReason}</span>
        </li>
        <li className="flex items-start gap-2">
          <span aria-hidden>{check.canChangeDate ? "✓" : "✕"}</span>
          <span data-testid="date-rule">{check.canChangeDate ? "You can move your pickup date once for free." : check.dateReason}</span>
        </li>
        <li className="flex items-start gap-2">
          <span aria-hidden>{check.canCancel ? "!" : "✕"}</span>
          <span data-testid="cancel-rule">{check.canCancel ? check.cancel.summary : check.cancelReason}</span>
        </li>
      </ul>

      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className="btn btn-ghost" disabled={!check.canChangeDate} onClick={() => setOpen(open === "date" ? "none" : "date")} data-testid="open-change-date">
          Change date
        </button>
        <button type="button" className="btn btn-ghost" disabled={!check.canCancel} onClick={() => setOpen(open === "cancel" ? "none" : "cancel")} data-testid="open-cancel">
          Cancel order
        </button>
      </div>

      {open === "date" && (
        <div className="mt-4 grid gap-3 rounded-xl border border-line p-4">
          <label className="label" htmlFor="new-date">
            New pickup date
          </label>
          <input id="new-date" type="date" className="field" min={minDate} value={date} onChange={(e) => { setDate(e.target.value); setSlot(""); setSlots(null); }} data-testid="new-date" />
          {slotNote && <p className="text-sm text-muted">{slotNote}</p>}
          {slots && slots.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((s) => (
                <button key={s.time} type="button" className="chip disabled:opacity-40" disabled={!s.available} aria-pressed={slot === s.time} onClick={() => setSlot(s.time)} data-testid={`new-slot-${s.time}`}>
                  {formatTime12(s.time)}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="btn btn-primary" disabled={busy || !date || !slot} onClick={() => run("date", { date, slot }, () => "Done! Your pickup has moved.")} data-testid="confirm-date">
            Move my pickup
          </button>
        </div>
      )}

      {open === "cancel" && (
        <div className="mt-4 rounded-xl border border-rose p-4 text-sm">
          <p className="font-semibold">Are you sure you want to cancel?</p>
          <p className="mt-1">{check.cancel.summary}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run("cancel", { confirm: true }, (d) => String(d.summary ?? "Your order has been cancelled."))} data-testid="confirm-cancel">
              Yes, cancel my order
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen("none")}>
              Keep my order
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`mt-3 text-sm ${msg.ok ? "" : "text-rose-dark"}`} data-testid="change-msg">
          {msg.text}
        </p>
      )}
    </div>
  );
}
