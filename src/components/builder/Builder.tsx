"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CakePreview } from "@/components/CakePreview";
import { compressImage } from "@/lib/client/image";
import { formatDateLong, formatTime12 } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { BIRTHDAY_OCCASIONS } from "@/lib/domain/automations";
import { dueAtCheckout, priceCake } from "@/lib/domain/pricing";
import { termsLines } from "@/lib/domain/terms";
import {
  DIETARY_FILTERS,
  type CakeConfig,
  type CatalogueItem,
  type Category,
  type DietaryFilter,
  type Settings,
} from "@/lib/domain/types";
import { clashesWith, emptyConfig, sanitizeConfig } from "@/lib/domain/visibility";
import { Calendar, type DayInfo } from "./Calendar";

interface Props {
  items: CatalogueItem[];
  settings: Settings;
  today: string;
  cancelled: boolean;
}

const STEPS = ["Occasion", "Size", "Flavour", "Finish", "Decorations", "Extras", "Date and pickup", "Your details", "Review"] as const;

interface Details {
  customerName: string;
  email: string;
  phone: string;
  allergyNotes: string;
  notes: string;
  marketingOptIn: boolean;
  remindNextYear: boolean;
}

interface Draft {
  config: CakeConfig;
  dietary: DietaryFilter[];
  details: Details;
}

const DRAFT_KEY = "cbe-order-draft";
const emptyDetails: Details = { customerName: "", email: "", phone: "", allergyNotes: "", notes: "", marketingOptIn: false, remindNextYear: false };

function loadDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function Builder({ items, settings, today, cancelled }: Props) {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<CakeConfig>(() => emptyConfig(items));
  const [dietary, setDietary] = useState<DietaryFilter[]>([]);
  const [notice, setNotice] = useState<string | null>(cancelled ? "Payment was cancelled. Your cake is saved below, so you can try again." : null);
  const [day, setDay] = useState<DayInfo | null>(null);
  const [slot, setSlot] = useState<string>("");
  const [details, setDetails] = useState<Details>(emptyDetails);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoName, setPhotoName] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullDate, setFullDate] = useState<string | null>(null);
  const [wl, setWl] = useState({ busy: false, msg: "", ok: false });
  const [code, setCode] = useState("");
  const [codeState, setCodeState] = useState<{ applied: string; balanceCents: number } | null>(null);
  const [codeMsg, setCodeMsg] = useState<string | null>(null);
  const [referral, setReferral] = useState("");
  const topRef = useRef<HTMLDivElement>(null);

  // Restore a saved draft (for example after cancelling at checkout).
  useEffect(() => {
    const d = loadDraft();
    if (!d) return;
    const { config: clean, removed } = sanitizeConfig(d.config, items, d.dietary ?? []);
    /* eslint-disable react-hooks/set-state-in-effect -- one-off restore from sessionStorage after hydration */
    setConfig(clean);
    setDietary(d.dietary ?? []);
    setDetails({ ...emptyDetails, ...d.details });
    if (removed.length) setNotice(`Sorry, ${removed.join(", ")} ${removed.length > 1 ? "are" : "is"} not available right now, so we've reset that choice.`);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [items]);

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ config, dietary, details } satisfies Draft));
    } catch {
      // Storage can be unavailable in private browsing. The builder still works.
    }
  }, [config, dietary, details]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const of = (cat: Category) => items.filter((i) => i.category === cat);
  const size = byId.get(config.size);
  const colour = byId.get(config.colour);

  const price = useMemo(() => {
    try {
      return priceCake(config, items, settings, {
        isRush: day?.isRush ?? false,
        peakSurchargeCents: day?.peakSurchargeCents ?? 0,
        peakLabel: day?.peakLabel ?? undefined,
      });
    } catch {
      return null;
    }
  }, [config, items, settings, day]);

  function update(patch: Partial<CakeConfig>) {
    setConfig((c) => ({ ...c, ...patch }));
  }

  function toggleDietary(f: DietaryFilter) {
    const next = dietary.includes(f) ? dietary.filter((x) => x !== f) : [...dietary, f];
    setDietary(next);
    const { config: clean, removed } = sanitizeConfig(config, items, next);
    setConfig(clean);
    setNotice(removed.length ? `We removed ${removed.join(", ")} because it doesn't suit ${DIETARY_FILTERS[f].label.toLowerCase()}.` : null);
  }

  function go(to: number) {
    setError(null);
    setStep(to);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const isBirthday = BIRTHDAY_OCCASIONS.includes(config.occasion);
  const voucherOff = price && codeState ? Math.min(codeState.balanceCents, price.totalCents) : 0;
  const payNow = price ? dueAtCheckout(price.depositCents, voucherOff) : 0;

  async function applyCode() {
    setCodeMsg(null);
    setCodeState(null);
    try {
      const res = await fetch("/api/vouchers/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; balanceCents?: number; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "That code wasn't recognised.");
      setCodeState({ applied: code.trim(), balanceCents: data.balanceCents ?? 0 });
    } catch (e) {
      setCodeMsg(e instanceof Error ? e.message : "That code wasn't recognised.");
    }
  }

  async function joinWaitlist() {
    if (!fullDate) return;
    setWl({ busy: true, msg: "", ok: false });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: fullDate, config, dietary, customerName: details.customerName, email: details.email, phone: details.phone }),
      });
      const data = (await res.json().catch(() => ({}))) as { place?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not join the waitlist.");
      setWl({ busy: false, ok: true, msg: `You're number ${data.place} on the waitlist for ${formatDateLong(fullDate)}. We've emailed you, and if a spot opens you'll get a link to claim it.` });
    } catch (e) {
      setWl({ busy: false, ok: false, msg: e instanceof Error ? e.message : "Could not join the waitlist." });
    }
  }

  const detailsValid =
    details.customerName.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(details.email) && /^[0-9 +()-]{8,20}$/.test(details.phone.trim());
  const canNext = step === 6 ? Boolean(day && slot) : step === 7 ? detailsValid : true;

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(null);
    if (!file) return;
    try {
      const blob = await compressImage(file);
      setPhoto(blob);
      setPhotoName(file.name);
    } catch (err) {
      setPhoto(null);
      setPhotoName("");
      setError(err instanceof Error ? err.message : "That photo could not be used.");
    }
  }

  async function submit() {
    if (!day || !slot) return;
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set(
        "payload",
        JSON.stringify({
          config,
          dietary,
          pickupDate: day.date,
          pickupSlot: slot,
          ...details,
          remindNextYear: isBirthday && details.remindNextYear,
          voucherCode: codeState?.applied ?? "",
          referralCode: referral.trim(),
          acceptTerms,
        }),
      );
      if (photo) form.set("inspiration", photo, photoName || "inspiration.jpg");
      const res = await fetch("/api/orders", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { checkoutUrl?: string; error?: string };
      if (!res.ok || !data.checkoutUrl) throw new Error(data.error ?? "Something went wrong. Please try again.");
      window.location.assign(data.checkoutUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  const option = (item: CatalogueItem, cat: Category, multi = false) => {
    const clash = clashesWith(item, dietary);
    const key = cat === "decoration" ? "decorations" : "extras";
    const selected = multi ? (config[key] as string[]).includes(item.id) : config[cat as keyof CakeConfig] === item.id;
    const amount = item.priceMode === "per_tier" ? item.priceCents * (size?.tiers ?? 1) : item.priceCents;
    return (
      <button
        key={item.id}
        type="button"
        aria-pressed={selected}
        disabled={Boolean(clash)}
        data-testid={`opt-${item.id}`}
        onClick={() => {
          if (multi) {
            const list = config[key] as string[];
            update({ [key]: selected ? list.filter((x) => x !== item.id) : [...list, item.id] });
          } else {
            update({ [cat]: item.id } as Partial<CakeConfig>);
          }
        }}
        className={`card flex w-full items-start gap-3 p-4 text-left transition ${
          selected ? "!border-rose ring-2 ring-rose/20" : "hover:border-blush-deep"
        } ${clash ? "cursor-not-allowed opacity-50" : ""}`}
      >
        {item.hex && <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full border border-line" style={{ background: item.hex }} />}
        <span className="flex-1">
          <span className="block font-semibold">{item.name}</span>
          {item.description && <span className="block text-sm text-muted">{item.description}</span>}
          {item.allergens.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {item.allergens.map((a) => (
                <span key={a} className="rounded-full bg-blush px-2 py-0.5 text-xs capitalize">
                  {a}
                </span>
              ))}
            </span>
          )}
          {clash && <span className="mt-1 block text-xs font-semibold text-rose-dark">Not suitable: {clash}</span>}
        </span>
        <span className="shrink-0 text-sm font-semibold">
          {amount > 0 ? (cat === "size" ? formatAud(amount) : `+${formatAud(amount)}`) : cat === "size" ? "" : "Included"}
        </span>
      </button>
    );
  };

  const grid = "grid gap-3 sm:grid-cols-2";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8" ref={topRef}>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-serif text-3xl">Design your cake</h1>
        <p className="text-sm text-muted">
          Step {step + 1} of {STEPS.length}: <span className="font-semibold text-plum">{STEPS[step]}</span>
        </p>
      </div>
      <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-blush" aria-hidden>
        <div className="h-full bg-rose transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>

      {notice && (
        <p role="status" className="mb-4 rounded-xl bg-blush px-4 py-3 text-sm" data-testid="builder-notice">
          {notice}
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <section aria-label={STEPS[step]}>
          {step === 0 && <div className={grid}>{of("occasion").map((i) => option(i, "occasion"))}</div>}
          {step === 1 && <div className={grid}>{of("size").map((i) => option(i, "size"))}</div>}
          {step === 2 && (
            <>
              <fieldset className="mb-5">
                <legend className="label">Dietary needs</legend>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(DIETARY_FILTERS) as DietaryFilter[]).map((f) => (
                    <button key={f} type="button" className="chip" aria-pressed={dietary.includes(f)} onClick={() => toggleDietary(f)}>
                      {DIETARY_FILTERS[f].label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">
                  Allergen information is a guide. Emily&apos;s kitchen also handles nuts, gluten, egg and dairy, so please add any allergies in
                  your details and Emily will confirm.
                </p>
              </fieldset>
              <div className={grid}>{of("flavour").map((i) => option(i, "flavour"))}</div>
            </>
          )}
          {step === 3 && (
            <>
              <h2 className="label">Finish</h2>
              <div className={grid}>{of("finish").map((i) => option(i, "finish"))}</div>
              <h2 className="label mt-6">Colour</h2>
              <div className={grid}>{of("colour").map((i) => option(i, "colour"))}</div>
            </>
          )}
          {step === 4 && (
            <>
              <div className={grid}>{of("decoration").map((i) => option(i, "decoration", true))}</div>
              {config.decorations.includes("dec-topper") && (
                <div className="mt-5">
                  <label className="label" htmlFor="topper">
                    Topper name or message
                  </label>
                  <input
                    id="topper"
                    className="field"
                    maxLength={30}
                    value={config.topperText}
                    onChange={(e) => update({ topperText: e.target.value })}
                    placeholder="e.g. Sophia"
                  />
                </div>
              )}
            </>
          )}
          {step === 5 && (
            <>
              <p className="mb-4 text-sm text-muted">Optional. Skip this step if you just want the cake.</p>
              <div className={grid}>{of("extra").map((i) => option(i, "extra", true))}</div>
            </>
          )}
          {step === 6 && (
            <Calendar
              today={today}
              settings={settings}
              selected={day}
              slot={slot}
              onSelectDay={(d) => {
                setDay(d);
                setSlot("");
                setFullDate(null);
              }}
              onSelectSlot={setSlot}
              fullDate={fullDate}
              onSelectFull={(date) => {
                setFullDate(date);
                setDay(null);
                setSlot("");
                setWl({ busy: false, msg: "", ok: false });
              }}
              waitlist={
                <div className="card mt-5 p-4" data-testid="waitlist-panel">
                  <h3 className="font-semibold">{fullDate ? formatDateLong(fullDate) : ""} is fully booked</h3>
                  <p className="mt-1 text-sm text-muted">Join the waitlist with your cake design. If a spot opens, you&apos;ll get an email with 24 hours to claim it.</p>
                  {!wl.ok && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <input className="field" placeholder="Your name" aria-label="Waitlist name" value={details.customerName} onChange={(e) => setDetails({ ...details, customerName: e.target.value })} />
                      <input className="field" type="email" placeholder="Email" aria-label="Waitlist email" value={details.email} onChange={(e) => setDetails({ ...details, email: e.target.value })} />
                      <input className="field" type="tel" placeholder="Mobile" aria-label="Waitlist mobile" value={details.phone} onChange={(e) => setDetails({ ...details, phone: e.target.value })} />
                    </div>
                  )}
                  {!wl.ok && (
                    <button type="button" className="btn btn-primary mt-3" disabled={wl.busy || !detailsValid} onClick={joinWaitlist} data-testid="join-waitlist">
                      Join the waitlist
                    </button>
                  )}
                  {wl.msg && (
                    <p role={wl.ok ? "status" : "alert"} className={`mt-3 text-sm ${wl.ok ? "" : "text-rose-dark"}`} data-testid="waitlist-msg">
                      {wl.msg}
                    </p>
                  )}
                </div>
              }
            />
          )}
          {step === 7 && (
            <div className="grid gap-4">
              <div>
                <label className="label" htmlFor="name">
                  Your name
                </label>
                <input id="name" className="field" autoComplete="name" value={details.customerName} onChange={(e) => setDetails({ ...details, customerName: e.target.value })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="email">
                    Email
                  </label>
                  <input id="email" type="email" className="field" autoComplete="email" value={details.email} onChange={(e) => setDetails({ ...details, email: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="phone">
                    Mobile
                  </label>
                  <input id="phone" type="tel" className="field" autoComplete="tel" value={details.phone} onChange={(e) => setDetails({ ...details, phone: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="allergies">
                  Allergies Emily should know about
                </label>
                <textarea id="allergies" className="field" rows={2} maxLength={500} value={details.allergyNotes} onChange={(e) => setDetails({ ...details, allergyNotes: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="notes">
                  Anything else? (theme, colours, ideas)
                </label>
                <textarea id="notes" className="field" rows={3} maxLength={1000} value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="photo">
                  Inspiration photo (optional)
                </label>
                <input id="photo" type="file" accept="image/*" onChange={onPhoto} className="block w-full text-sm" />
                {photoName && <p className="mt-1 text-xs text-muted">Added: {photoName}</p>}
              </div>
              {isBirthday && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={details.remindNextYear} onChange={(e) => setDetails({ ...details, remindNextYear: e.target.checked })} data-testid="remind-next-year" />
                  <span>Remind me before next year&apos;s birthday, so I can book early.</span>
                </label>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={details.marketingOptIn} onChange={(e) => setDetails({ ...details, marketingOptIn: e.target.checked })} />
                <span>Send me the occasional email about seasonal treats and offers. (Optional, unsubscribe any time.)</span>
              </label>
            </div>
          )}
          {step === 8 && price && day && (
            <div className="grid gap-4">
              <div className="card p-5">
                <h2 className="font-serif text-xl">Your order</h2>
                <ul className="mt-3 divide-y divide-line text-sm" data-testid="review-lines">
                  {price.lines.map((l, i) => (
                    <li key={i} className="flex justify-between py-2">
                      <span>{l.name}</span>
                      <span>{l.amountCents ? formatAud(l.amountCents) : "Included"}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm">
                  Pickup: <strong>{formatDateLong(day.date)}</strong> at <strong>{formatTime12(slot)}</strong>
                </p>
                {config.topperText && config.decorations.includes("dec-topper") && <p className="mt-1 text-sm">Topper: {config.topperText}</p>}
              </div>
              {of("addon").length > 0 && (
                <div className="card p-5 text-sm">
                  <h3 className="font-semibold">Party add-ons</h3>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="addons">
                    {of("addon").map((item) => {
                      const on = (config.addons ?? []).includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-pressed={on}
                          data-testid={`addon-${item.id}`}
                          onClick={() => update({ addons: on ? (config.addons ?? []).filter((x) => x !== item.id) : [...(config.addons ?? []), item.id] })}
                          className={`flex items-start justify-between gap-2 rounded-xl border p-3 text-left ${on ? "border-rose ring-2 ring-rose/20" : "border-line"}`}
                        >
                          <span>
                            <span className="block font-semibold">{item.name}</span>
                            {item.description && <span className="block text-xs text-muted">{item.description}</span>}
                          </span>
                          <span className="shrink-0 font-semibold">
                            +{formatAud(item.priceCents)}
                            {item.bondCents > 0 && <span className="block text-xs font-normal text-muted">+{formatAud(item.bondCents)} bond</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="card p-5 text-sm">
                <h3 className="font-semibold">Referral code</h3>
                <p className="text-muted">First order? A friend&apos;s code takes money off. It&apos;s checked and taken off at checkout.</p>
                <input className="field mt-2 max-w-xs uppercase" placeholder="NAME-XXXX" aria-label="Referral code" value={referral} onChange={(e) => setReferral(e.target.value)} data-testid="referral-input" />
              </div>
              <div className="card p-5 text-sm">
                <h3 className="font-semibold">Gift voucher or credit code</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input className="field max-w-xs flex-1 uppercase" placeholder="XXXX-XXXX-XXXX-XXXX" aria-label="Voucher code" value={code} onChange={(e) => { setCode(e.target.value); setCodeState(null); }} data-testid="voucher-code" />
                  <button type="button" className="btn btn-ghost" disabled={code.trim().length < 16} onClick={applyCode} data-testid="apply-code">
                    Apply
                  </button>
                </div>
                {codeState && price && (
                  <p className="mt-2" role="status" data-testid="code-applied">
                    {formatAud(voucherOff)} will come off your order.
                    {payNow === 0 ? " Nothing more to pay today." : ` You'll pay ${formatAud(payNow)} today.`}
                  </p>
                )}
                {codeMsg && <p className="mt-2 text-rose-dark" role="alert" data-testid="code-error">{codeMsg}</p>}
              </div>
              <div className="card p-5 text-sm">
                <h3 className="font-semibold">Terms</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted" data-testid="terms-lines">
                  {termsLines(settings).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                {settings.cancellationPolicy && <p className="mt-2 whitespace-pre-line text-muted">{settings.cancellationPolicy}</p>}
                <label className="mt-3 flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} data-testid="accept-terms" />
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
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded-xl border border-rose bg-white px-4 py-3 text-sm text-rose-dark">
              {error}
            </p>
          )}

          <div className="mt-6 flex items-center justify-between gap-3">
            <button type="button" className="btn btn-ghost" onClick={() => go(step - 1)} disabled={step === 0} style={{ visibility: step === 0 ? "hidden" : "visible" }}>
              Back
            </button>
            {step < STEPS.length - 1 ? (
              <button type="button" className="btn btn-primary" onClick={() => go(step + 1)} disabled={!canNext} data-testid="next">
                Next
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={submit} disabled={!acceptTerms || submitting || !price} data-testid="pay">
                {submitting
                  ? "Opening secure checkout..."
                  : price && codeState && payNow === 0
                    ? "Place order"
                    : `Pay ${price?.isRush ? "in full" : "deposit"} ${price ? formatAud(payNow) : ""}`}
              </button>
            )}
          </div>
        </section>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="card p-5">
            <CakePreview
              tiers={size?.tiers ?? 1}
              tall={config.size === "size-6-tall"}
              wide={config.size === "size-8-round"}
              colour={colour?.hex ?? "#F2C4CE"}
              finish={config.finish}
              decorations={config.decorations}
              topperText={config.topperText}
              className="mx-auto w-full max-w-[260px]"
            />
            <p className="mt-2 text-center text-xs text-muted">Illustration only. Emily will confirm the final design.</p>
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex justify-between text-lg font-semibold">
                <span>Total</span>
                <span data-testid="total">{price ? formatAud(price.totalCents) : "..."}</span>
              </div>
              {price && (
                <p className="mt-1 text-sm text-muted" data-testid="deposit">
                  {price.isRush ? `Rush order: paid in full today (includes ${formatAud(price.rushFeeCents)} rush fee)` : `${settings.depositPercent}% deposit today: ${formatAud(price.depositCents)}`}
                </p>
              )}
              {price && price.peakSurchargeCents > 0 && <p className="mt-1 text-sm text-muted">Includes {formatAud(price.peakSurchargeCents)} peak date surcharge</p>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
