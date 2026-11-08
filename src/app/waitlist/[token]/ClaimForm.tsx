"use client";

import { useEffect, useState } from "react";
import { formatTime12 } from "@/lib/domain/dates";
import type { CakeConfig, DietaryFilter } from "@/lib/domain/types";

interface Props {
  token: string;
  entry: { date: string; config: CakeConfig; dietary: DietaryFilter[]; customerName: string; email: string; phone: string };
}

export function ClaimForm({ token, entry }: Props) {
  const [slots, setSlots] = useState<{ time: string; available: boolean }[] | null>(null);
  const [slot, setSlot] = useState("");
  const [allergyNotes, setAllergyNotes] = useState("");
  const [voucherCode, setVoucherCode] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/slots?date=${entry.date}&claim=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d: { slots?: { time: string; available: boolean }[] }) => setSlots(d.slots ?? []))
      .catch(() => setError("Could not load pickup times. Please refresh."));
  }, [entry.date, token]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set(
        "payload",
        JSON.stringify({
          config: entry.config,
          dietary: entry.dietary,
          pickupDate: entry.date,
          pickupSlot: slot,
          customerName: entry.customerName,
          email: entry.email,
          phone: entry.phone,
          allergyNotes,
          notes: "",
          marketingOptIn: false,
          acceptTerms,
          voucherCode,
          waitlistToken: token,
        }),
      );
      const res = await fetch("/api/orders", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { checkoutUrl?: string; error?: string };
      if (!res.ok || !data.checkoutUrl) throw new Error(data.error ?? "Something went wrong.");
      window.location.assign(data.checkoutUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <section className="card mt-6 grid gap-4 p-5">
      <div>
        <h2 className="label">Pickup time</h2>
        {!slots ? (
          <p className="text-sm text-muted">Loading times...</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-rose-dark">Sorry, there are no pickup times left on this date.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((s) => (
              <button key={s.time} type="button" className="chip disabled:opacity-40" disabled={!s.available} aria-pressed={slot === s.time} onClick={() => setSlot(s.time)} data-testid={`claim-slot-${s.time}`}>
                {formatTime12(s.time)}
              </button>
            ))}
          </div>
        )}
      </div>
      <label>
        <span className="label">Allergies Emily should know about</span>
        <textarea className="field" rows={2} maxLength={500} value={allergyNotes} onChange={(e) => setAllergyNotes(e.target.value)} />
      </label>
      <label>
        <span className="label">Gift voucher or credit code (optional)</span>
        <input className="field uppercase" value={voucherCode} onChange={(e) => setVoucherCode(e.target.value)} />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} data-testid="claim-terms" />
        <span>
          I agree to the{" "}
          <a href="/terms" target="_blank" className="underline">
            terms
          </a>{" "}
          and{" "}
          <a href="/privacy" target="_blank" className="underline">
            privacy policy
          </a>
          .
        </span>
      </label>
      <button type="button" className="btn btn-primary" disabled={busy || !slot || !acceptTerms} onClick={submit} data-testid="claim-pay">
        {busy ? "Opening secure checkout..." : "Book it and pay the deposit"}
      </button>
      {error && <p className="text-sm text-rose-dark" role="alert" data-testid="claim-error">{error}</p>}
    </section>
  );
}
