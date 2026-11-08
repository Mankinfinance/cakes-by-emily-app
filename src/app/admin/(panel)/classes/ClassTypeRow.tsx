"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ClassType } from "@/lib/domain/types";
import { updateClassTypeAction } from "../actions";

export function ClassTypeRow({ type }: { type: ClassType }) {
  const router = useRouter();
  const [price, setPrice] = useState(String(type.priceCents / 100));
  const [min, setMin] = useState(String(type.minGuests));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (patch: Record<string, unknown>) =>
    start(async () => {
      const r = await updateClassTypeAction(type.id, patch);
      setError(r.ok ? null : r.error);
      router.refresh();
    });
  return (
    <li className={`flex flex-wrap items-center justify-between gap-3 py-2 text-sm ${type.visible ? "" : "opacity-60"}`}>
      <span>
        <span className="font-semibold">{type.name}</span> <span className="text-muted">({type.level}, {type.ageNote})</span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <span>$</span>
        <input type="number" className="field !w-24 !py-1.5" value={price} onChange={(e) => setPrice(e.target.value)} aria-label={`Price for ${type.name}`} />
        <span>min</span>
        <input type="number" className="field !w-20 !py-1.5" value={min} onChange={(e) => setMin(e.target.value)} aria-label={`Minimum guests for ${type.name}`} />
        <button type="button" className="btn btn-ghost !px-3 !py-1.5" disabled={pending} onClick={() => save({ priceCents: Math.round(Number(price) * 100), minGuests: Number(min) })}>
          Save
        </button>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={type.visible} disabled={pending} onChange={(e) => save({ visible: e.target.checked })} />
          Show to customers
        </label>
      </span>
      {error && <span className="w-full text-xs text-rose-dark">{error}</span>}
    </li>
  );
}
