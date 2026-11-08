"use client";

import { useState } from "react";
import { postJson } from "@/components/client/post";
import { classPrice } from "@/lib/domain/classes";
import { formatAud } from "@/lib/domain/money";

interface Props {
  sessionId: string;
  unitCents: number;
  maxSeats: number;
  isSip: boolean;
  discount: { groupDiscountMinSeats: number; groupDiscountPercent: number };
  /** Claiming a waitlist offer: fixed seats and the claim token. */
  claim?: { token: string; seats: number; name: string; email: string; phone: string };
}

export function BookingForm({ sessionId, unitCents, maxSeats, isSip, discount, claim }: Props) {
  const [seats, setSeats] = useState(claim?.seats ?? 1);
  const [guests, setGuests] = useState(Array.from({ length: 6 }, (_, i) => ({ name: i === 0 && claim ? claim.name : "", allergies: "" })));
  const [contact, setContact] = useState({ contactName: claim?.name ?? "", email: claim?.email ?? "", phone: claim?.phone ?? "" });
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = classPrice(unitCents, seats, discount);
  const ready = terms && (!isSip || adult) && guests.slice(0, seats).every((g) => g.name.trim()) && contact.contactName && contact.email && contact.phone;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const d = await postJson<{ checkoutUrl: string }>("/api/classes/book", {
        sessionId,
        seats,
        guests: guests.slice(0, seats),
        ...contact,
        adultConfirmed: adult,
        acceptTerms: terms,
        waitlistToken: claim?.token ?? "",
      });
      window.location.assign(d.checkoutUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="card mt-6 grid gap-4 p-5">
      <label>
        <span className="label">Seats</span>
        <select className="field !w-40" value={seats} disabled={Boolean(claim)} onChange={(e) => setSeats(Number(e.target.value))} data-testid="class-seats">
          {Array.from({ length: Math.max(1, claim ? claim.seats : maxSeats) }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      {seats < discount.groupDiscountMinSeats && discount.groupDiscountPercent > 0 && (
        <p className="text-sm text-muted">Book {discount.groupDiscountMinSeats} seats and save {discount.groupDiscountPercent}%.</p>
      )}
      <fieldset className="grid gap-2">
        <legend className="label">Guests</legend>
        {guests.slice(0, seats).map((g, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-2">
            <input className="field" placeholder={`Guest ${i + 1} name`} aria-label={`Guest ${i + 1} name`} value={g.name} onChange={(e) => setGuests(guests.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} data-testid={`guest-name-${i}`} />
            <input className="field" placeholder="Allergies (if any)" aria-label={`Guest ${i + 1} allergies`} value={g.allergies} onChange={(e) => setGuests(guests.map((x, j) => (j === i ? { ...x, allergies: e.target.value } : x)))} data-testid={`guest-allergies-${i}`} />
          </div>
        ))}
      </fieldset>
      <div className="grid gap-2 sm:grid-cols-3">
        <input className="field" placeholder="Your name" aria-label="Your name" value={contact.contactName} onChange={(e) => setContact({ ...contact, contactName: e.target.value })} data-testid="class-contact" />
        <input className="field" type="email" placeholder="Email" aria-label="Email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} data-testid="class-email" />
        <input className="field" type="tel" placeholder="Mobile" aria-label="Mobile" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} data-testid="class-phone" />
      </div>
      {isSip && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={adult} onChange={(e) => setAdult(e.target.checked)} data-testid="class-adult" />
          <span>Everyone in this booking is 18 or over. This is a BYO drinks class: please drink responsibly.</span>
        </label>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={terms} onChange={(e) => setTerms(e.target.checked)} data-testid="class-terms" />
        <span>
          I agree to the{" "}
          <a href="/terms" target="_blank" className="underline">
            terms
          </a>
          . Classes are paid in full when booking.
        </span>
      </label>
      <div className="flex justify-between text-sm">
        <span>{seats} x {formatAud(unitCents)}{price.discountCents > 0 && `, less ${formatAud(price.discountCents)} group discount`}</span>
        <span className="font-semibold" data-testid="class-total">{formatAud(price.totalCents)}</span>
      </div>
      <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={submit} data-testid="class-pay">
        {busy ? "Opening secure checkout..." : `Pay ${formatAud(price.totalCents)}`}
      </button>
      {error && <p className="text-sm text-rose-dark" role="alert" data-testid="class-error">{error}</p>}
    </div>
  );
}
