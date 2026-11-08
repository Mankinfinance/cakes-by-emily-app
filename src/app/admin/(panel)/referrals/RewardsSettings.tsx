"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Settings } from "@/lib/domain/types";
import { saveSettingsAction } from "../actions";

export function RewardsSettings({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const money = (key: "referralGiveCents" | "referralGetCents") => ({
    value: String(s[key] / 100),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [key]: Math.round(Number(e.target.value) * 100) }),
  });
  return (
    <section className="card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" checked={s.referralsEnabled} onChange={(e) => setS({ ...s, referralsEnabled: e.target.checked })} data-testid="referrals-enabled" />
          <span className="font-semibold">Referrals on</span>
        </label>
        <label>
          <span className="label">New customer gets ($ off)</span>
          <input type="number" min={0} className="field" {...money("referralGiveCents")} />
        </label>
        <label>
          <span className="label">Referrer gets ($ credit)</span>
          <input type="number" min={0} className="field" {...money("referralGetCents")} />
        </label>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" checked={s.stampsEnabled} onChange={(e) => setS({ ...s, stampsEnabled: e.target.checked })} data-testid="stamps-enabled" />
          <span className="font-semibold">Stamp card on</span>
        </label>
        <label>
          <span className="label">Reward every Nth collected order</span>
          <input type="number" min={2} className="field" value={s.stampEvery} onChange={(e) => setS({ ...s, stampEvery: Number(e.target.value) })} data-testid="stamp-every" />
        </label>
        <label>
          <span className="label">Reward</span>
          <input className="field" value={s.stampRewardName} onChange={(e) => setS({ ...s, stampRewardName: e.target.value })} />
        </label>
      </div>
      <button
        type="button"
        className="btn btn-primary mt-4"
        disabled={pending}
        data-testid="save-rewards"
        onClick={() =>
          start(async () => {
            const r = await saveSettingsAction(s);
            setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
            router.refresh();
          })
        }
      >
        Save
      </button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "" : "text-rose-dark"}`} data-testid="rewards-msg">{msg.text}</p>}
    </section>
  );
}
