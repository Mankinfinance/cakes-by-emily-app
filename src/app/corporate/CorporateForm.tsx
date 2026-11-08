"use client";

import { useEffect, useState } from "react";
import { compressImage } from "@/lib/client/image";
import { formatTime12 } from "@/lib/domain/dates";
import { formatAud, percentOfRoundedDollar } from "@/lib/domain/money";
import type { CorporatePackage } from "@/lib/domain/types";

export function CorporateForm({ packages, depositPercent, minDate }: { packages: CorporatePackage[]; depositPercent: number; minDate: string }) {
  const [pkgId, setPkgId] = useState(packages[0]?.id ?? "");
  const [f, setF] = useState({ companyName: "", abn: "", contactName: "", email: "", phone: "", notes: "", pickupDate: "", pickupSlot: "", acceptTerms: false });
  const [slots, setSlots] = useState<{ time: string; available: boolean }[] | null>(null);
  const [slotNote, setSlotNote] = useState("");
  const [logo, setLogo] = useState<{ blob: Blob; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pkg = packages.find((p) => p.id === pkgId);

  useEffect(() => {
    if (!f.pickupDate) return;
    let live = true;
    fetch(`/api/slots?date=${f.pickupDate}`)
      .then((r) => r.json())
      .then((d: { slots?: { time: string; available: boolean }[]; bookable?: boolean; isRush?: boolean }) => {
        if (!live) return;
        setSlots(d.bookable && !d.isRush ? (d.slots ?? []) : []);
        setSlotNote(!d.bookable ? "That date isn't available." : d.isRush ? "Corporate orders need the standard notice." : "");
      })
      .catch(() => live && setSlotNote("Could not load times."));
    return () => {
      live = false;
    };
  }, [f.pickupDate]);

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(null);
    if (!file) return setLogo(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setLogo(null);
      return setError("Please upload the logo as a PNG, JPG or WebP image.");
    }
    try {
      setLogo({ blob: await compressImage(file), name: file.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That image could not be used.");
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("payload", JSON.stringify({ packageId: pkgId, ...f }));
      if (logo) form.set("logo", logo.blob, logo.name);
      const res = await fetch("/api/corporate", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { checkoutUrl?: string; error?: string };
      if (!res.ok || !data.checkoutUrl) throw new Error(data.error ?? "Something went wrong.");
      window.location.assign(data.checkoutUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const grouped = (["cookies", "cupcakes"] as const).map((product) => ({ product, items: packages.filter((p) => p.product === product) }));

  return (
    <div className="mt-6 grid gap-6">
      {grouped.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.product}>
              <h2 className="font-serif text-xl capitalize">Logo {g.product}</h2>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                {g.items.map((p) => (
                  <button key={p.id} type="button" aria-pressed={pkgId === p.id} onClick={() => setPkgId(p.id)} data-testid={`pkg-${p.id}`} className={`card p-4 text-left ${pkgId === p.id ? "!border-rose ring-2 ring-rose/20" : ""}`}>
                    <span className="block font-semibold">{p.quantity} {g.product}</span>
                    <span className="block text-lg">{formatAud(p.priceCents)}</span>
                    <span className="block text-xs text-muted">{formatAud(Math.round(p.priceCents / p.quantity))} each</span>
                  </button>
                ))}
              </div>
            </section>
          ),
      )}
      <section className="card grid gap-3 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <input className="field" placeholder="Company name" aria-label="Company name" value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} data-testid="corp-company" />
          <input className="field" placeholder="ABN (optional)" aria-label="ABN" inputMode="numeric" value={f.abn} onChange={(e) => setF({ ...f, abn: e.target.value })} data-testid="corp-abn" />
          <input className="field" placeholder="Your name" aria-label="Contact name" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} data-testid="corp-name" />
          <input className="field" type="email" placeholder="Email" aria-label="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="corp-email" />
          <input className="field" type="tel" placeholder="Phone" aria-label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="corp-phone" />
          <label>
            <span className="label">Pickup date</span>
            <input type="date" min={minDate} className="field" value={f.pickupDate} onChange={(e) => { setF({ ...f, pickupDate: e.target.value, pickupSlot: "" }); setSlots(null); }} data-testid="corp-date" />
          </label>
        </div>
        {slotNote && <p className="text-sm text-muted">{slotNote}</p>}
        {slots && slots.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {slots.map((s) => (
              <button key={s.time} type="button" className="chip disabled:opacity-40" disabled={!s.available} aria-pressed={f.pickupSlot === s.time} onClick={() => setF({ ...f, pickupSlot: s.time })} data-testid={`corp-slot-${s.time}`}>
                {formatTime12(s.time)}
              </button>
            ))}
          </div>
        )}
        <label>
          <span className="label">Logo (PNG, JPG or WebP)</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onLogo} className="block w-full text-sm" data-testid="corp-logo" />
          {logo && <span className="mt-1 block text-xs text-muted">Added: {logo.name}</span>}
        </label>
        <textarea className="field" rows={2} maxLength={1000} placeholder="Colours, wording or anything else (optional)" aria-label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={f.acceptTerms} onChange={(e) => setF({ ...f, acceptTerms: e.target.checked })} data-testid="corp-terms" />
          <span>
            I agree to the{" "}
            <a href="/terms" target="_blank" className="underline">
              terms
            </a>
            .
          </span>
        </label>
        <button type="button" className="btn btn-primary" disabled={busy || !pkg || !f.pickupSlot || !f.acceptTerms} onClick={submit} data-testid="corp-pay">
          {busy ? "Opening secure checkout..." : pkg ? `Pay ${depositPercent}% deposit ${formatAud(Math.min(pkg.priceCents, percentOfRoundedDollar(pkg.priceCents, depositPercent)))}` : "Choose a package"}
        </button>
        {error && <p className="text-sm text-rose-dark" role="alert" data-testid="corp-error">{error}</p>}
      </section>
    </div>
  );
}
