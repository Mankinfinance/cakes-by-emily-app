"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SeasonalBox } from "@/lib/domain/types";
import { saveBoxAction } from "../actions";

const blank = { name: "", description: "", price: "40", cap: "20", opensOn: "", closesOn: "", pickupFrom: "", pickupTo: "", visible: true, sort: 100 };

export function BoxEditor({ box, status }: { box: SeasonalBox | null; status: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(
    box
      ? { name: box.name, description: box.description, price: String(box.priceCents / 100), cap: String(box.cap), opensOn: box.opensOn, closesOn: box.closesOn, pickupFrom: box.pickupFrom, pickupTo: box.pickupTo, visible: box.visible, sort: box.sort }
      : blank,
  );
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const testId = box ? `box-${box.id.slice(-4)}` : "box-new";

  const save = (override?: Partial<typeof f>) =>
    start(async () => {
      const v = { ...f, ...override };
      const r = await saveBoxAction(box?.id ?? null, {
        name: v.name,
        description: v.description,
        priceCents: Math.round(Number(v.price) * 100),
        cap: Number(v.cap),
        opensOn: v.opensOn,
        closesOn: v.closesOn,
        pickupFrom: v.pickupFrom,
        pickupTo: v.pickupTo,
        visible: v.visible,
        sort: v.sort,
      });
      setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
      if (r.ok && !box) setF(blank);
      router.refresh();
    });

  const input = (key: keyof typeof f, label: string, type = "text") => (
    <label>
      <span className="label">{label}</span>
      <input type={type} className="field" value={String(f[key])} onChange={(e) => setF({ ...f, [key]: e.target.value })} data-testid={`${testId}-${key}`} />
    </label>
  );

  return (
    <div className="card p-4" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {box ? (
          <div>
            <p className="font-semibold">
              {box.name} {!box.visible && <span className="ml-1 rounded-full bg-paper px-2 py-0.5 text-xs text-muted">Hidden</span>}
            </p>
            <p className="text-sm text-muted">
              {box.sold} of {box.cap} sold &middot; {status}
            </p>
          </div>
        ) : (
          <p className="font-semibold">Add a new box</p>
        )}
        <div className="flex items-center gap-3">
          {box && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.visible}
                disabled={pending}
                data-testid={`${testId}-visible`}
                onChange={(e) => {
                  setF({ ...f, visible: e.target.checked });
                  save({ visible: e.target.checked });
                }}
              />
              Show to customers
            </label>
          )}
          <button type="button" className="btn btn-ghost !px-3 !py-1.5" onClick={() => setOpen(!open)} data-testid={`${testId}-edit`}>
            {open ? "Close" : box ? "Edit" : "Add"}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {input("name", "Name")}
          {input("price", "Price ($)", "number")}
          {input("cap", "How many available", "number")}
          <label className="sm:col-span-2 lg:col-span-1">
            <span className="label">Sort order</span>
            <input type="number" className="field" value={f.sort} onChange={(e) => setF({ ...f, sort: Number(e.target.value) })} />
          </label>
          <label className="sm:col-span-2 lg:col-span-4">
            <span className="label">Description</span>
            <input className="field" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} data-testid={`${testId}-description`} />
          </label>
          {input("opensOn", "Pre-orders open", "date")}
          {input("closesOn", "Pre-orders close", "date")}
          {input("pickupFrom", "Pickup from", "date")}
          {input("pickupTo", "Pickup until", "date")}
          <div className="sm:col-span-2 lg:col-span-4">
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => save()} data-testid={`${testId}-save`}>
              Save box
            </button>
          </div>
        </div>
      )}
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "" : "text-rose-dark"}`} data-testid={`${testId}-msg`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
