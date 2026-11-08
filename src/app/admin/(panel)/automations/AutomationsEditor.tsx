"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AUTOMATION_INFO } from "@/lib/domain/automations";
import type { Automation } from "@/lib/domain/types";
import { saveAutomationAction } from "../actions";

export function AutomationsEditor({ automations }: { automations: Automation[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(automations);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = (a: Automation) =>
    start(async () => {
      const r = await saveAutomationAction(a);
      setMsg(r.ok ? { ok: true, text: `${AUTOMATION_INFO[a.key].label}: saved.` } : { ok: false, text: r.error });
      router.refresh();
    });

  return (
    <div className="mt-6 grid gap-3" data-testid="automations">
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? "bg-blush" : "border border-rose bg-white text-rose-dark"}`} data-testid="automation-msg">
          {msg.text}
        </p>
      )}
      {rows.map((a, i) => {
        const info = AUTOMATION_INFO[a.key];
        const set = (patch: Partial<Automation>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
        return (
          <div key={a.key} className="card flex flex-wrap items-center justify-between gap-3 p-4" data-testid={`automation-${a.key}`}>
            <label className="flex flex-1 items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5"
                checked={a.enabled}
                disabled={pending}
                data-testid={`toggle-${a.key}`}
                onChange={(e) => {
                  set({ enabled: e.target.checked });
                  save({ ...a, enabled: e.target.checked });
                }}
              />
              <span>
                <span className="block font-semibold">{info.label}</span>
                <span className="block text-sm text-muted">{info.help}</span>
              </span>
            </label>
            {info.daysLabel && (
              <div className="flex items-center gap-2 text-sm">
                <input type="number" min={0} max={400} className="field !w-24" value={a.days} onChange={(e) => set({ days: Number(e.target.value) })} aria-label={`${info.label} ${info.daysLabel}`} data-testid={`days-${a.key}`} />
                <span className="text-muted">{info.daysLabel}</span>
                <button type="button" className="btn btn-ghost !px-3 !py-1.5" disabled={pending} onClick={() => save(a)} data-testid={`save-${a.key}`}>
                  Save
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
