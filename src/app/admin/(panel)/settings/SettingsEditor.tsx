"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatDateLong } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import type { DayOff, PeakDate, Settings } from "@/lib/domain/types";
import { addDayOffAction, removeDayOffAction, removePeakAction, saveSettingsAction, upsertPeakAction } from "../actions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SettingsEditor({ settings, daysOff, peaks }: { settings: Settings; daysOff: DayOff[]; peaks: PeakDate[] }) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [dayOff, setDayOff] = useState({ date: "", note: "" });
  const [peak, setPeak] = useState({ date: "", label: "", surcharge: "30" });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? "Something went wrong." });
      router.refresh();
    });

  const num = (key: keyof Settings) => ({
    value: String(s[key] as number),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [key]: Number(e.target.value) }),
  });
  const dollars = (key: "rushFeeCents" | "cancelAdminFeeCents" | "passPriceCents") => ({
    value: String(s[key] / 100),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [key]: Math.round(Number(e.target.value) * 100) }),
  });

  return (
    <div className="mt-6 grid gap-6">
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? "bg-blush" : "border border-rose bg-white text-rose-dark"}`} data-testid="settings-msg">
          {msg.text}
        </p>
      )}

      <section className="card p-5">
        <h2 className="font-serif text-xl">Notice, capacity and pickups</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label>
            <span className="label">Minimum notice (days)</span>
            <input type="number" min={0} className="field" {...num("minNoticeDays")} />
          </label>
          <label>
            <span className="label">Cakes per day</span>
            <input type="number" min={0} className="field" {...num("dailyCap")} data-testid="daily-cap" />
          </label>
          <label>
            <span className="label">Cakes per week</span>
            <input type="number" min={0} className="field" {...num("weeklyCap")} />
          </label>
          <label>
            <span className="label">Pickups from</span>
            <input type="time" step={1800} className="field" value={s.pickupStart} onChange={(e) => setS({ ...s, pickupStart: e.target.value })} />
          </label>
          <label>
            <span className="label">Pickups until</span>
            <input type="time" step={1800} className="field" value={s.pickupEnd} onChange={(e) => setS({ ...s, pickupEnd: e.target.value })} />
          </label>
          <label>
            <span className="label">Pickups per 30 minute slot</span>
            <input type="number" min={1} className="field" {...num("slotCap")} />
          </label>
          <label>
            <span className="label">Book up to (days ahead)</span>
            <input type="number" min={7} className="field" {...num("bookingHorizonDays")} />
          </label>
        </div>
        <fieldset className="mt-4">
          <legend className="label">Closed every week on</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                className="chip"
                aria-pressed={s.closedWeekdays.includes(i)}
                onClick={() => setS({ ...s, closedWeekdays: s.closedWeekdays.includes(i) ? s.closedWeekdays.filter((x) => x !== i) : [...s.closedWeekdays, i] })}
              >
                {d}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="card p-5">
        <h2 className="font-serif text-xl">Rush orders, deposits and terms</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
            <input type="checkbox" checked={s.rushEnabled} onChange={(e) => setS({ ...s, rushEnabled: e.target.checked })} />
            <span>Allow rush orders inside the notice period (when there&apos;s room)</span>
          </label>
          <label>
            <span className="label">Rush fee ($)</span>
            <input type="number" min={0} className="field" {...dollars("rushFeeCents")} />
          </label>
          <label>
            <span className="label">Rush orders no sooner than (days)</span>
            <input type="number" min={1} className="field" {...num("rushMinDays")} />
          </label>
          <label>
            <span className="label">Deposit (%)</span>
            <input type="number" min={10} max={100} className="field" {...num("depositPercent")} />
          </label>
          <label>
            <span className="label">Balance reminder (days before pickup)</span>
            <input type="number" min={0} className="field" {...num("balanceDueDays")} />
          </label>
          <label>
            <span className="label">Design changes until (days before)</span>
            <input type="number" min={0} className="field" {...num("changeCutoffDays")} />
          </label>
        </div>
        <h3 className="mt-6 font-semibold">Changes and cancellations</h3>
        <p className="text-sm text-muted">These rules drive the &ldquo;Change or cancel&rdquo; options on each order and the terms page.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label>
            <span className="label">Full refund if cancelled (days or more before)</span>
            <input type="number" min={0} className="field" {...num("cancelFullRefundDays")} data-testid="cancel-full-days" />
          </label>
          <label>
            <span className="label">Admin fee on those refunds ($)</span>
            <input type="number" min={0} className="field" {...dollars("cancelAdminFeeCents")} data-testid="cancel-fee" />
          </label>
          <label>
            <span className="label">Credit instead if cancelled (days or more before)</span>
            <input type="number" min={0} className="field" {...num("cancelCreditDays")} />
          </label>
          <label>
            <span className="label">Free date changes</span>
            <input type="number" min={0} className="field" {...num("freeDateChanges")} />
          </label>
          <label>
            <span className="label">Free design change rounds</span>
            <input type="number" min={0} className="field" {...num("freeDesignChangeRounds")} />
          </label>
          <label>
            <span className="label">Review link (Google review URL)</span>
            <input type="url" className="field" placeholder="https://..." value={s.reviewUrl} onChange={(e) => setS({ ...s, reviewUrl: e.target.value })} data-testid="review-url" />
          </label>
        </div>
        <h3 className="mt-6 font-semibold">Classes</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label>
            <span className="label">Group discount from (seats)</span>
            <input type="number" min={2} className="field" {...num("groupDiscountMinSeats")} />
          </label>
          <label>
            <span className="label">Group discount (%)</span>
            <input type="number" min={0} max={50} className="field" {...num("groupDiscountPercent")} data-testid="group-discount" />
          </label>
          <label className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
            <input type="checkbox" checked={s.classBlocksCakes} onChange={(e) => setS({ ...s, classBlocksCakes: e.target.checked })} data-testid="class-blocks" />
            <span>No cake orders on class days</span>
          </label>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label>
            <span className="label">Class full refund (days or more before)</span>
            <input type="number" min={0} className="field" {...num("classFullRefundDays")} />
          </label>
          <label>
            <span className="label">Class credit instead (days or more before)</span>
            <input type="number" min={0} className="field" {...num("classCreditDays")} />
          </label>
          <label>
            <span className="label">Private class shares due (days before)</span>
            <input type="number" min={0} className="field" {...num("splitDueDays")} />
          </label>
          <label>
            <span className="label">Guests can change their details until (days before)</span>
            <input type="number" min={0} max={60} className="field" {...num("guestEditCutoffDays")} data-testid="guest-edit-cutoff" />
          </label>
          <label className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
            <input type="checkbox" checked={s.passEnabled} onChange={(e) => setS({ ...s, passEnabled: e.target.checked })} />
            <span>Sell class passes</span>
          </label>
          <label>
            <span className="label">Class pass price ($)</span>
            <input type="number" min={1} className="field" {...dollars("passPriceCents")} />
          </label>
          <label>
            <span className="label">Classes per pass</span>
            <input type="number" min={1} className="field" {...num("passCredits")} />
          </label>
          <label>
            <span className="label">Pass valid for (months)</span>
            <input type="number" min={1} className="field" {...num("passValidMonths")} />
          </label>
        </div>
        <h3 className="mt-6 font-semibold">Refunds</h3>
        <label className="mt-2 flex items-start gap-2 rounded-xl border border-rose p-3 text-sm">
          <input type="checkbox" className="mt-1" checked={s.autoRefunds} onChange={(e) => setS({ ...s, autoRefunds: e.target.checked })} data-testid="auto-refunds" />
          <span>
            <strong>Refund automatically through Stripe.</strong> When a cancellation leaves money to refund, the website sends the refund to Stripe straight away
            instead of asking you to do it. Try it in Stripe test mode first. If Stripe refuses a refund, you&apos;ll get an email to do it by hand.
          </span>
        </label>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={s.legalDraftBanner} onChange={(e) => setS({ ...s, legalDraftBanner: e.target.checked })} data-testid="legal-draft-banner-toggle" />
          <span>
            Show &ldquo;Draft for review. Not legal advice.&rdquo; on the terms and privacy pages. Untick once the wording has been checked and the [square
            bracket] placeholders are filled in.
          </span>
        </label>
        <label className="mt-4 block">
          <span className="label">Extra notes added to the terms (optional)</span>
          <textarea className="field" rows={3} value={s.cancellationPolicy} onChange={(e) => setS({ ...s, cancellationPolicy: e.target.value })} />
        </label>
        <button type="button" className="btn btn-primary mt-4" disabled={pending} onClick={() => run(() => saveSettingsAction(s), "Settings saved.")} data-testid="save-settings">
          Save settings
        </button>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="font-serif text-xl">Days off</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input type="date" className="field" value={dayOff.date} onChange={(e) => setDayOff({ ...dayOff, date: e.target.value })} aria-label="Day off date" />
            <input className="field" placeholder="Note (optional)" value={dayOff.note} onChange={(e) => setDayOff({ ...dayOff, note: e.target.value })} aria-label="Day off note" />
            <button type="button" className="btn btn-primary" disabled={!dayOff.date || pending} onClick={() => run(() => addDayOffAction(dayOff), "Day off added.")}>
              Add
            </button>
          </div>
          <ul className="mt-3 divide-y divide-line text-sm">
            {daysOff.length === 0 && <li className="py-2 text-muted">No days off set.</li>}
            {daysOff.map((d) => (
              <li key={d.date} className="flex items-center justify-between py-2">
                <span>
                  {formatDateLong(d.date)} {d.note && <span className="text-muted">({d.note})</span>}
                </span>
                <button type="button" className="text-rose underline" onClick={() => run(() => removeDayOffAction(d.date), "Day off removed.")}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-5">
          <h2 className="font-serif text-xl">Peak dates</h2>
          <p className="text-sm text-muted">A surcharge added to cakes picked up on these dates, shown on the calendar.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_90px_auto]">
            <input type="date" className="field" value={peak.date} onChange={(e) => setPeak({ ...peak, date: e.target.value })} aria-label="Peak date" />
            <input className="field" placeholder="e.g. Mother's Day" value={peak.label} onChange={(e) => setPeak({ ...peak, label: e.target.value })} aria-label="Peak date label" />
            <input type="number" min={0} className="field" value={peak.surcharge} onChange={(e) => setPeak({ ...peak, surcharge: e.target.value })} aria-label="Surcharge in dollars" />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!peak.date || !peak.label || pending}
              onClick={() => run(() => upsertPeakAction({ date: peak.date, label: peak.label, surchargeCents: Math.round(Number(peak.surcharge) * 100) }), "Peak date saved.")}
            >
              Add
            </button>
          </div>
          <ul className="mt-3 divide-y divide-line text-sm">
            {peaks.map((p) => (
              <li key={p.date} className="flex items-center justify-between py-2">
                <span>
                  {formatDateLong(p.date)}: {p.label} (+{formatAud(p.surchargeCents)})
                </span>
                <button type="button" className="text-rose underline" onClick={() => run(() => removePeakAction(p.date), "Peak date removed.")}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
