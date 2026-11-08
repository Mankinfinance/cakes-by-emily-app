// Phase 5: the pure parts of the live smoke test (scripts/smoke-live.ts).
// The script itself needs a deployed site and Stripe test keys, so it can't
// run in the automated tests; these helpers can, and are tested with Vitest.

/** Reads STRIPE_SECRET_KEY, SMOKE_CONFIRM and SMOKE_BASE_URL. */
export type SmokeEnv = Record<string, string | undefined>;

/** Refuse unless this is clearly a test run against a real address. Returns the problems, if any. */
export function smokeGuard(env: SmokeEnv): string[] {
  const problems: string[] = [];
  const key = env.STRIPE_SECRET_KEY ?? "";
  if (!key) problems.push("STRIPE_SECRET_KEY is not set. Use the Stripe test key (sk_test_...).");
  else if (!key.startsWith("sk_test_")) problems.push("STRIPE_SECRET_KEY must be a test key (sk_test_...). The smoke test never runs against live payments.");
  if (env.SMOKE_CONFIRM !== "yes") problems.push("Set SMOKE_CONFIRM=yes to confirm you want to create a test order on the deployed site.");
  const base = env.SMOKE_BASE_URL ?? "";
  if (!base) problems.push("Set SMOKE_BASE_URL to the deployed site, e.g. https://your-site.vercel.app");
  else {
    try {
      const u = new URL(base);
      if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") problems.push("SMOKE_BASE_URL must use https (or localhost).");
    } catch {
      problems.push("SMOKE_BASE_URL is not a valid URL.");
    }
  }
  return problems;
}

/** First bookable date and slot from the availability API's answers. */
export function pickDateAndSlot(
  days: { date: string; bookable: boolean; isRush: boolean; peakSurchargeCents: number }[],
  slotsFor: (date: string) => { time: string; available: boolean }[] | undefined,
): { date: string; slot: string } | null {
  for (const d of days) {
    if (!d.bookable || d.isRush || d.peakSurchargeCents > 0) continue;
    const slot = slotsFor(d.date)?.find((s) => s.available);
    if (slot) return { date: d.date, slot: slot.time };
  }
  return null;
}

/** The two months to look in, starting from today's month (YYYY-MM). */
export function nextMonths(today: string, count = 3): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** The Checkout session id inside a Stripe Checkout URL (cs_test_...). */
export function sessionIdFromCheckoutUrl(url: string): string | null {
  return url.match(/(cs_(?:test|live)_[A-Za-z0-9]+)/)?.[1] ?? null;
}

/** The order page token inside the order's success URL ("<site>/o/<token>?paid=1"). */
export function orderTokenFromUrl(url: string): string | null {
  try {
    return new URL(url).pathname.match(/^\/o\/([A-Za-z0-9_-]{20,})$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** A sample cake order using the seeded menu, marked clearly as a smoke test. */
export function smokeOrderPayload(date: string, slot: string, stamp: string) {
  return {
    config: { occasion: "occ-other", size: "size-6-round", flavour: "fl-vanilla", finish: "fin-buttercream", colour: "col-blush", decorations: [], extras: [], topperText: "" },
    dietary: [],
    pickupDate: date,
    pickupSlot: slot,
    customerName: "Smoke Test",
    email: `smoke-test+${stamp}@example.com`,
    phone: "0400 000 000",
    allergyNotes: "",
    notes: `[SMOKE TEST ${stamp}] Automated test order. Safe to ignore; it cancels itself.`,
    marketingOptIn: false,
    acceptTerms: true,
    remindNextYear: false,
  };
}

export type StepResult = { step: string; status: "PASS" | "FAIL" | "SKIP"; detail: string };

/** A plain-text PASS/FAIL table. */
export function resultsTable(rows: StepResult[]): string {
  const w1 = Math.max(4, ...rows.map((r) => r.step.length));
  const line = (a: string, b: string, c: string) => `${a.padEnd(w1)}  ${b.padEnd(6)}  ${c}`;
  const out = [line("Step", "Result", "Detail"), line("-".repeat(w1), "------", "------")];
  for (const r of rows) out.push(line(r.step, r.status, r.detail));
  const failed = rows.filter((r) => r.status === "FAIL").length;
  out.push("", failed ? `FAILED: ${failed} of ${rows.length} steps` : `PASSED: ${rows.filter((r) => r.status === "PASS").length} steps (${rows.filter((r) => r.status === "SKIP").length} skipped)`);
  return out.join("\n");
}

export function smokeExitCode(rows: StepResult[]): number {
  return rows.some((r) => r.status === "FAIL") ? 1 : 0;
}
