"use client";

import { useState } from "react";
import { compressImage } from "@/lib/client/image";

export function ReviewForm({ orderId, token }: { orderId: string; token: string }) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState<{ blob: Blob; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("payload", JSON.stringify({ orderId, token, rating, text, consentToPublish: consent }));
      if (photo) form.set("photo", photo.blob, photo.name);
      const res = await fetch("/api/reviews", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="mt-4 rounded-xl bg-blush px-4 py-3" role="status" data-testid="review-thanks">Thank you so much! Emily will read every word.</p>;

  return (
    <div className="card mt-6 grid gap-4 p-5">
      <fieldset>
        <legend className="label">Your rating</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={`${n} star${n > 1 ? "s" : ""}`} aria-pressed={rating === n} onClick={() => setRating(n)} className={`text-3xl ${n <= rating ? "text-gold" : "text-line"}`} data-testid={`star-${n}`}>
              ★
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        <span className="label">Your review</span>
        <textarea className="field" rows={4} maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} data-testid="review-text" />
      </label>
      <label>
        <span className="label">A photo of the cake (optional)</span>
        <input
          type="file"
          accept="image/*"
          className="block w-full text-sm"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return setPhoto(null);
            try {
              setPhoto({ blob: await compressImage(file), name: file.name });
            } catch (err) {
              setError(err instanceof Error ? err.message : "That photo could not be used.");
            }
          }}
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="review-consent" />
        <span>Emily can show my review (first name and initial only) and photo on her website.</span>
      </label>
      <button type="button" className="btn btn-primary" disabled={busy || rating === 0} onClick={submit} data-testid="review-submit">
        {busy ? "Sending..." : "Send review"}
      </button>
      {error && <p className="text-sm text-rose-dark" role="alert">{error}</p>}
    </div>
  );
}
