// Phase 5: gathers the facts for /admin/setup (which settings exist, whether
// Supabase and Stripe answer) and hands them to the pure checks in
// domain/setup.ts. Only light, read-only calls are made, each with a time
// limit. No secret value ever leaves this file.

import "server-only";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { EXPECTED_BUCKETS, EXPECTED_TABLES, PHASE5_MARKER, REQUIRED_ENV, safeHost, setupChecks, type SetupCheck, type SetupFacts } from "../domain/setup";
import { getMailer, sendSafely, setupTestEmail } from "./email";

const TIME_LIMIT_MS = 6000;

function withTimeout<T>(p: PromiseLike<T>, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} did not answer within ${TIME_LIMIT_MS / 1000} seconds`)), TIME_LIMIT_MS)),
  ]);
}

/** A missing table or column, rather than a connection problem. */
function isMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return ["42P01", "42703", "PGRST205", "PGRST204"].includes(error.code ?? "") || /does not exist|could not find/i.test(error.message ?? "");
}

/** Never let a provider's error text carry a key back to the page. */
function scrub(message: string): string {
  return message.replace(/(sk|rk|pk|whsec|re)_[A-Za-z0-9_]+/g, "[hidden]").replace(/eyJ[A-Za-z0-9._-]+/g, "[hidden]").slice(0, 160);
}

async function probeSupabase(env: Record<string, string | undefined>): Promise<SetupFacts["supabase"]> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const missingTables: string[] = [];
    for (const { table } of EXPECTED_TABLES) {
      const { error } = await withTimeout(db.from(table).select("*", { head: true, count: "exact" }).limit(1), "Supabase");
      if (isMissing(error)) missingTables.push(table);
      else if (error) return { reachable: false, error: scrub(error.message), missingTables: [], phase5: false, missingBuckets: [] };
    }
    const marker = await withTimeout(db.from(PHASE5_MARKER.table).select(PHASE5_MARKER.column).limit(1), "Supabase");
    const phase5 = !marker.error;
    const buckets = await withTimeout(db.storage.listBuckets(), "Supabase storage");
    const names = new Set((buckets.data ?? []).map((b) => b.id));
    const missingBuckets = buckets.error ? EXPECTED_BUCKETS : EXPECTED_BUCKETS.filter((b) => !names.has(b));
    return { reachable: true, missingTables, phase5, missingBuckets };
  } catch (err) {
    return { reachable: false, error: scrub(err instanceof Error ? err.message : String(err)), missingTables: [], phase5: false, missingBuckets: [] };
  }
}

async function probeStripe(env: Record<string, string | undefined>): Promise<SetupFacts["stripe"]> {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    const account = await withTimeout(new Stripe(key).accounts.retrieveCurrent(), "Stripe");
    return {
      reachable: true,
      accountName: account.settings?.dashboard?.display_name || account.business_profile?.name || undefined,
      chargesEnabled: account.charges_enabled,
    };
  } catch (err) {
    return { reachable: false, error: scrub(err instanceof Error ? err.message : String(err)) };
  }
}

/** Only the variables the checks read, so nothing else from the environment is passed around. */
export function pickEnv(source: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const names = [...REQUIRED_ENV.map((e) => e.name), "ADMIN_REQUIRE_MFA"];
  return Object.fromEntries(names.map((n) => [n, source[n]]));
}

export async function runSetupChecks(requestHost: string | null, opts?: { memoryMode?: boolean }): Promise<SetupCheck[]> {
  const env = pickEnv();
  const memoryMode = opts?.memoryMode ?? process.env.DATA_ADAPTER === "memory";
  const [supabase, stripe] = await Promise.all([memoryMode ? Promise.resolve(null) : probeSupabase(env), probeStripe(env)]);
  return setupChecks({ env, requestHost, memoryMode, supabase, stripe });
}

/** The "send a test email" button. */
export async function sendSetupTestEmail(): Promise<{ to: string } | { error: string }> {
  const to = process.env.ADMIN_NOTIFY_EMAIL;
  if (!to) return { error: "Set ADMIN_NOTIFY_EMAIL first, so the test email has somewhere to go." };
  const ok = await sendSafely(getMailer(), setupTestEmail(to, safeHost(process.env.NEXT_PUBLIC_SITE_URL)));
  return ok === false ? { error: "Resend refused the email. Check RESEND_API_KEY and that the EMAIL_FROM domain is verified in Resend." } : { to };
}
