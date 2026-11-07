"use client";

import { useEffect, useState } from "react";
import { formatDateLong, formatTime12 } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import type { Settings } from "@/lib/domain/types";

export interface DayInfo {
  date: string;
  state: string;
  bookable: boolean;
  isRush: boolean;
  label: string;
  peakSurchargeCents: number;
  peakLabel: string | null;
}

interface SlotInfo {
  time: string;
  remaining: number;
  available: boolean;
}

interface Props {
  today: string;
  settings: Settings;
  selected: DayInfo | null;
  slot: string;
  onSelectDay: (d: DayInfo) => void;
  onSelectSlot: (s: string) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export function Calendar({ today, settings, selected, slot, onSelectDay, onSelectSlot }: Props) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [days, setDays] = useState<DayInfo[] | null>(null);
  const [slotData, setSlotData] = useState<{ date: string; slots: SlotInfo[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/availability?month=${month}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { days: DayInfo[] }) => live && setDays(d.days))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [month]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    fetch(`/api/slots?date=${selected.date}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { slots: SlotInfo[] }) => live && setSlotData({ date: selected.date, slots: d.slots }))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [selected]);

  const slots = selected && slotData?.date === selected.date ? slotData.slots : null;
  const firstDow = days?.length ? (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const monthLabel = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  const canGoBack = month > today.slice(0, 7);

  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        Standard notice is {settings.minNoticeDays} days.
        {settings.rushEnabled && ` Dates sooner than that may be available as a rush order for ${formatAud(settings.rushFeeCents)} extra, paid in full.`}
      </p>
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" className="btn btn-ghost !px-3 !py-1.5" disabled={!canGoBack} onClick={() => { setDays(null); setMonth(shiftMonth(month, -1)); }} aria-label="Previous month">
            &lsaquo;
          </button>
          <h3 className="font-serif text-lg" data-testid="month-label">{monthLabel}</h3>
          <button type="button" className="btn btn-ghost !px-3 !py-1.5" onClick={() => { setDays(null); setMonth(shiftMonth(month, 1)); }} aria-label="Next month" data-testid="next-month">
            &rsaquo;
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>
        {failed && <p className="p-4 text-sm text-rose-dark">Sorry, the calendar could not load. Please refresh the page.</p>}
        {!days && !failed && <p className="p-6 text-center text-sm text-muted">Loading dates...</p>}
        {days && (
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {days.map((d) => {
              const isSel = selected?.date === d.date;
              return (
                <button
                  key={d.date}
                  type="button"
                  disabled={!d.bookable}
                  onClick={() => onSelectDay(d)}
                  data-testid={`day-${d.date}`}
                  data-state={d.state}
                  aria-pressed={isSel}
                  aria-label={`${formatDateLong(d.date)}: ${d.label}`}
                  className={`relative flex aspect-square min-w-0 flex-col items-center justify-center rounded-lg border text-sm transition ${
                    isSel
                      ? "border-plum bg-plum text-white"
                      : d.bookable
                        ? d.isRush
                          ? "border-gold/60 bg-[#fbf3e6] hover:border-gold"
                          : "border-line bg-white hover:border-rose"
                        : "border-transparent text-muted/50 line-through"
                  }`}
                >
                  <span>{Number(d.date.slice(8))}</span>
                  {d.bookable && d.isRush && <span className="text-[9px] leading-none">rush</span>}
                  {d.bookable && d.peakSurchargeCents > 0 && <span className="text-[9px] leading-none">+{formatAud(d.peakSurchargeCents)}</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-line bg-white" /> Available</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-gold/60 bg-[#fbf3e6]" /> Rush (+{formatAud(settings.rushFeeCents)})</span>
          <span className="flex items-center gap-1"><span className="line-through">12</span> Unavailable</span>
        </div>
      </div>

      {selected && (
        <div className="mt-5">
          <h3 className="label">Pickup time on {formatDateLong(selected.date)}</h3>
          {selected.isRush && (
            <p className="mb-2 text-sm text-muted">This is a rush order. A {formatAud(settings.rushFeeCents)} rush fee applies and the order is paid in full.</p>
          )}
          {selected.peakSurchargeCents > 0 && (
            <p className="mb-2 text-sm text-muted">
              {selected.peakLabel}: a {formatAud(selected.peakSurchargeCents)} peak date surcharge applies.
            </p>
          )}
          {!slots ? (
            <p className="text-sm text-muted">Loading times...</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((s) => (
                <button
                  key={s.time}
                  type="button"
                  className="chip disabled:opacity-40 disabled:line-through"
                  disabled={!s.available}
                  aria-pressed={slot === s.time}
                  onClick={() => onSelectSlot(s.time)}
                  data-testid={`slot-${s.time}`}
                >
                  {formatTime12(s.time)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
