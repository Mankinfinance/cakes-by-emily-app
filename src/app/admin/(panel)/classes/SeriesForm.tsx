"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatDateLong } from "@/lib/domain/dates";
import { seriesAction } from "../actions";

export function SeriesForm({ types }: { types: { id: string; name: string; defaultSeats: number }[] }) {
  const router = useRouter();
  const [f, setF] = useState({ classTypeId: types[0]?.id ?? "", date: "", startTime: "14:00", seats: types[0]?.defaultSeats ?? 8, everyDays: 7, count: 1 });
  const [preview, setPreview] = useState<{ date: string; skipped: boolean }[] | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (create: boolean) =>
    start(async () => {
      const r = await seriesAction(f, create);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setPreview(create ? null : (r.data?.dates ?? []));
      setMsg(create ? { ok: true, text: `Added ${r.data?.dates.filter((d) => !d.skipped).length} class${r.data?.dates.filter((d) => !d.skipped).length === 1 ? "" : "es"}.` } : null);
      if (create) router.refresh();
    });
  return (
    <section className="card p-5">
      <h2 className="font-serif text-xl">Add classes</h2>
      <p className="text-sm text-muted">One class, or a repeating series. Days off and closed weekdays are skipped.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="sm:col-span-3 lg:col-span-2">
          <span className="label">Class</span>
          <select className="field" value={f.classTypeId} onChange={(e) => setF({ ...f, classTypeId: e.target.value, seats: types.find((t) => t.id === e.target.value)?.defaultSeats ?? f.seats })} data-testid="series-type">
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">First date</span>
          <input type="date" className="field" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-testid="series-date" />
        </label>
        <label>
          <span className="label">Start</span>
          <input type="time" step={1800} className="field" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} data-testid="series-time" />
        </label>
        <label>
          <span className="label">Seats</span>
          <input type="number" min={1} className="field" value={f.seats} onChange={(e) => setF({ ...f, seats: Number(e.target.value) })} data-testid="series-seats" />
        </label>
        <label>
          <span className="label">Repeat</span>
          <select className="field" value={f.everyDays} onChange={(e) => setF({ ...f, everyDays: Number(e.target.value) })} data-testid="series-every">
            <option value={7}>Weekly</option>
            <option value={14}>Fortnightly</option>
            <option value={28}>Every 4 weeks</option>
          </select>
        </label>
        <label>
          <span className="label">How many</span>
          <input type="number" min={1} max={26} className="field" value={f.count} onChange={(e) => setF({ ...f, count: Number(e.target.value) })} data-testid="series-count" />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className="btn btn-ghost" disabled={pending || !f.date} onClick={() => run(false)} data-testid="series-preview">
          Preview dates
        </button>
        <button type="button" className="btn btn-primary" disabled={pending || !f.date} onClick={() => run(true)} data-testid="series-create">
          Add {f.count > 1 ? "series" : "class"}
        </button>
      </div>
      {preview && (
        <ul className="mt-3 flex flex-wrap gap-2 text-sm" data-testid="series-dates">
          {preview.map((d) => (
            <li key={d.date} className={`rounded-full border px-3 py-1 ${d.skipped ? "border-dashed text-muted line-through" : "border-line"}`}>
              {formatDateLong(d.date)}
            </li>
          ))}
        </ul>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "" : "text-rose-dark"}`} data-testid="series-msg">{msg.text}</p>}
    </section>
  );
}
