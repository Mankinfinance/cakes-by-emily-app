"use client";

import { useState } from "react";
import { postJson } from "@/components/client/post";
import { formatAud } from "@/lib/domain/money";

export function VoucherForm({ amounts, custom }: { amounts: number[]; custom: { min: number; max: number } | null }) {
  const [amount, setAmount] = useState<number | null>(amounts[0] ?? null);
  const [customValue, setCustomValue] = useState("");
  const [f, setF] = useState({ buyerName: "", buyerEmail: "", recipientName: "", recipientEmail: "", message: "", acceptTerms: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = amount ?? Math.round(Number(customValue) * 100);
  const customOk = amount !== null || (custom && cents >= custom.min && cents <= custom.max);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<{ checkoutUrl: string }>("/api/vouchers/buy", { amountCents: cents, ...f });
      window.location.assign(data.checkoutUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="card mt-6 grid gap-4 p-5">
      <fieldset>
        <legend className="label">Amount</legend>
        <div className="flex flex-wrap gap-2">
          {amounts.map((a) => (
            <button key={a} type="button" className="chip" aria-pressed={amount === a} onClick={() => setAmount(a)} data-testid={`amount-${a}`}>
              {formatAud(a)}
            </button>
          ))}
          {custom && (
            <button type="button" className="chip" aria-pressed={amount === null} onClick={() => setAmount(null)} data-testid="amount-custom">
              Other amount
            </button>
          )}
        </div>
        {amount === null && custom && (
          <label className="mt-3 block">
            <span className="label">
              Amount ({formatAud(custom.min)} to {formatAud(custom.max)})
            </span>
            <input type="number" min={custom.min / 100} max={custom.max / 100} className="field !w-40" value={customValue} onChange={(e) => setCustomValue(e.target.value)} data-testid="custom-amount" />
          </label>
        )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <input className="field" placeholder="Your name" aria-label="Your name" value={f.buyerName} onChange={(e) => setF({ ...f, buyerName: e.target.value })} data-testid="buyer-name" />
        <input className="field" type="email" placeholder="Your email" aria-label="Your email" value={f.buyerEmail} onChange={(e) => setF({ ...f, buyerEmail: e.target.value })} data-testid="buyer-email" />
        <input className="field" placeholder="Who is it for?" aria-label="Recipient name" value={f.recipientName} onChange={(e) => setF({ ...f, recipientName: e.target.value })} data-testid="recipient-name" />
        <input className="field" type="email" placeholder="Their email (optional, we'll send it to them)" aria-label="Recipient email" value={f.recipientEmail} onChange={(e) => setF({ ...f, recipientEmail: e.target.value })} data-testid="recipient-email" />
      </div>
      <textarea className="field" rows={2} maxLength={300} placeholder="A message (optional)" aria-label="Message" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={f.acceptTerms} onChange={(e) => setF({ ...f, acceptTerms: e.target.checked })} data-testid="voucher-terms" />
        <span>
          I agree to the{" "}
          <a href="/terms" target="_blank" className="underline">
            terms
          </a>
          . Vouchers can&apos;t be exchanged for cash.
        </span>
      </label>
      <button type="button" className="btn btn-primary" disabled={busy || !f.acceptTerms || !customOk || !cents} onClick={submit} data-testid="buy-voucher">
        {busy ? "Opening secure checkout..." : `Buy ${cents ? formatAud(cents) : ""} voucher`}
      </button>
      {error && <p className="text-sm text-rose-dark" role="alert">{error}</p>}
    </div>
  );
}
