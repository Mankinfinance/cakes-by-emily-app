"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatAud } from "@/lib/domain/money";
import type { Settings } from "@/lib/domain/types";
import { saveSettingsAction } from "../actions";

export function VoucherSettings({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [newAmount, setNewAmount] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = (next: Settings) =>
    start(async () => {
      const r = await saveSettingsAction(next);
      setMsg(r.ok ? { ok: true, text: "Voucher settings saved." } : { ok: false, text: r.error });
      if (r.ok) setS(next);
      router.refresh();
    });

  return (
    <section className="card p-5">
      <h2 className="font-serif text-xl">Voucher amounts</h2>
      <ul className="mt-3 flex flex-wrap gap-3">
        {s.voucherOptions.map((o, i) => (
          <li key={o.cents} className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={o.visible}
                disabled={pending}
                data-testid={`voucher-visible-${o.cents}`}
                onChange={(e) => save({ ...s, voucherOptions: s.voucherOptions.map((x, j) => (j === i ? { ...x, visible: e.target.checked } : x)) })}
              />
              {formatAud(o.cents)}
            </label>
            <button type="button" className="text-muted" aria-label={`Remove ${formatAud(o.cents)}`} onClick={() => save({ ...s, voucherOptions: s.voucherOptions.filter((_, j) => j !== i) })}>
              &times;
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label>
          <span className="label">Add an amount ($)</span>
          <input type="number" min={5} className="field !w-32" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pending || !newAmount}
          onClick={() => {
            const cents = Math.round(Number(newAmount) * 100);
            if (s.voucherOptions.some((o) => o.cents === cents)) return;
            save({ ...s, voucherOptions: [...s.voucherOptions, { cents, visible: true }].sort((a, b) => a.cents - b.cents) });
            setNewAmount("");
          }}
        >
          Add
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="flex items-center gap-2 sm:col-span-3">
          <input type="checkbox" checked={s.voucherCustomEnabled} onChange={(e) => setS({ ...s, voucherCustomEnabled: e.target.checked })} />
          <span>Let buyers choose their own amount</span>
        </label>
        <label>
          <span className="label">Smallest custom amount ($)</span>
          <input type="number" className="field" value={s.voucherCustomMinCents / 100} onChange={(e) => setS({ ...s, voucherCustomMinCents: Math.round(Number(e.target.value) * 100) })} />
        </label>
        <label>
          <span className="label">Largest custom amount ($)</span>
          <input type="number" className="field" value={s.voucherCustomMaxCents / 100} onChange={(e) => setS({ ...s, voucherCustomMaxCents: Math.round(Number(e.target.value) * 100) })} />
        </label>
        <label>
          <span className="label">Valid for (months)</span>
          <input type="number" className="field" value={s.voucherValidMonths} onChange={(e) => setS({ ...s, voucherValidMonths: Number(e.target.value) })} />
        </label>
      </div>
      <button type="button" className="btn btn-primary mt-4" disabled={pending} onClick={() => save(s)} data-testid="save-voucher-settings">
        Save
      </button>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "" : "text-rose-dark"}`} data-testid="voucher-settings-msg">
          {msg.text}
        </p>
      )}
    </section>
  );
}
