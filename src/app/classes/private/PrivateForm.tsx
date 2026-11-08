"use client";

import { useState } from "react";
import { postJson } from "@/components/client/post";
import { privateEstimate } from "@/lib/domain/classes";
import { formatAud } from "@/lib/domain/money";
import type { PrivatePackage } from "@/lib/domain/types";

export function PrivateForm({ packages, minDate }: { packages: PrivatePackage[]; minDate: string }) {
  const [key, setKey] = useState(packages[0]?.key ?? "");
  const pkg = packages.find((p) => p.key === key);
  const [guests, setGuests] = useState(pkg?.minGuests ?? 6);
  const [f, setF] = useState({ preferredDate: "", preferredTime: "14:00", occasion: "", notes: "", customerName: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const est = pkg ? privateEstimate(pkg, guests) : null;

  if (msg?.ok) return <p className="card mt-6 p-5" role="status" data-testid="private-sent">{msg.text}</p>;

  return (
    <div className="mt-6 grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {packages.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={key === p.key}
            onClick={() => {
              setKey(p.key);
              setGuests(Math.min(Math.max(guests, p.minGuests), p.maxGuests));
            }}
            className={`card p-4 text-left ${key === p.key ? "!border-rose ring-2 ring-rose/20" : ""}`}
            data-testid={`private-${p.key}`}
          >
            <span className="block font-semibold">{p.name}</span>
            <span className="block text-sm text-muted">{p.includes}</span>
            <span className="mt-1 block text-sm">
              {formatAud(p.perPersonCents)} per {p.kids ? "child" : "person"}, {p.minGuests} to {p.maxGuests}, {formatAud(p.depositCents)} deposit
            </span>
          </button>
        ))}
      </div>
      {pkg && (
        <div className="card grid gap-3 p-5">
          <label>
            <span className="label">{pkg.kids ? "Children" : "Guests"}</span>
            <input type="number" min={pkg.minGuests} max={pkg.maxGuests} className="field !w-32" value={guests} onChange={(e) => setGuests(Number(e.target.value))} data-testid="private-guests" />
          </label>
          {est && (
            <p data-testid="private-estimate" className={est.ok ? "" : "text-rose-dark"}>
              {est.ok ? `Estimate ${formatAud(est.totalCents)}, with a ${formatAud(est.depositCents)} deposit once Emily confirms.` : `${pkg.name} is for ${pkg.minGuests} to ${pkg.maxGuests}.`}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="label">Preferred date</span>
              <input type="date" min={minDate} className="field" value={f.preferredDate} onChange={(e) => setF({ ...f, preferredDate: e.target.value })} data-testid="private-date" />
            </label>
            <label>
              <span className="label">Preferred start time</span>
              <input type="time" step={1800} className="field" value={f.preferredTime} onChange={(e) => setF({ ...f, preferredTime: e.target.value })} />
            </label>
            <input className="field" placeholder="Occasion (e.g. hens)" aria-label="Occasion" value={f.occasion} onChange={(e) => setF({ ...f, occasion: e.target.value })} />
            <input className="field" placeholder="Your name" aria-label="Your name" value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} data-testid="private-name" />
            <input className="field" type="email" placeholder="Email" aria-label="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="private-email" />
            <input className="field" type="tel" placeholder="Mobile" aria-label="Mobile" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="private-phone" />
          </div>
          <textarea className="field" rows={2} maxLength={1000} placeholder="Anything else? (optional)" aria-label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !est?.ok || !f.preferredDate}
            data-testid="private-submit"
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                const d = await postJson<{ reference: string }>("/api/classes/private", { packageKey: key, guests, ...f });
                setMsg({ ok: true, text: `Thank you! Your request ${d.reference} is with Emily. She'll check the date and email you.` });
              } catch (e) {
                setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." });
              } finally {
                setBusy(false);
              }
            }}
          >
            Send request
          </button>
          {msg && !msg.ok && <p className="text-sm text-rose-dark" role="alert">{msg.text}</p>}
        </div>
      )}
    </div>
  );
}
