// Phase 5: the launch health checks behind /admin/setup. Pure logic: the
// service gathers the facts (which settings exist, whether Supabase and
// Stripe answer) and this turns them into green, amber or red lines with a
// plain-English fix. Secret values are never shown, only "set" or "missing".

export type CheckStatus = "ok" | "warn" | "fail";

export interface SetupCheck {
  id: string;
  group: "Settings" | "Database" | "Payments" | "Email" | "Security";
  label: string;
  status: CheckStatus;
  /** What was found, safe to show (never a secret's value). */
  detail: string;
  /** What to do about it, when it isn't green. */
  fix: string | null;
}

/** Environment variables the live site needs. `secret` ones are only ever shown as set or missing. */
export const REQUIRED_ENV: { name: string; secret: boolean; why: string }[] = [
  { name: "NEXT_PUBLIC_SITE_URL", secret: false, why: "used in every email link" },
  { name: "NEXT_PUBLIC_SUPABASE_URL", secret: false, why: "the database address" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", secret: true, why: "used for Emily's login" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", secret: true, why: "lets the server read and write orders" },
  { name: "ADMIN_EMAILS", secret: false, why: "who can sign in to the admin area" },
  { name: "ADMIN_NOTIFY_EMAIL", secret: false, why: "where new order alerts go" },
  { name: "STRIPE_SECRET_KEY", secret: true, why: "takes payments" },
  { name: "STRIPE_WEBHOOK_SECRET", secret: true, why: "confirms payments really came from Stripe" },
  { name: "RESEND_API_KEY", secret: true, why: "sends emails" },
  { name: "EMAIL_FROM", secret: false, why: "the address emails come from" },
  { name: "ORDER_LINK_SECRET", secret: true, why: "builds private order links and voucher codes" },
  { name: "CRON_SECRET", secret: true, why: "protects the daily reminders job" },
  { name: "PICKUP_DETAILS", secret: false, why: "the pickup address sent before pickup" },
];

/** Tables the four migrations create. If any is missing, a migration hasn't been run. */
export const EXPECTED_TABLES: { table: string; migration: string }[] = [
  { table: "orders", migration: "20261108000000_initial_schema.sql" },
  { table: "payments", migration: "20261108000000_initial_schema.sql" },
  { table: "catalogue_items", migration: "20261108000000_initial_schema.sql" },
  { table: "automations", migration: "20261109000000_phase2.sql" },
  { table: "vouchers", migration: "20261109000000_phase2.sql" },
  { table: "seasonal_boxes", migration: "20261109000000_phase2.sql" },
  { table: "class_sessions", migration: "20261110000000_phase3.sql" },
  { table: "class_bookings", migration: "20261110000000_phase3.sql" },
  { table: "reviews", migration: "20261110000000_phase3.sql" },
  { table: "private_guests", migration: "20261111000000_phase4.sql" },
  { table: "class_passes", migration: "20261111000000_phase4.sql" },
  { table: "refunds", migration: "20261111000000_phase4.sql" },
];

/** A column the phase 5 migration adds, to tell whether it has been run. */
export const PHASE5_MARKER = { table: "private_guests", column: "voucher_applied_cents", migration: "20261112000000_phase5.sql" };

export const EXPECTED_BUCKETS = ["order-media"];

export interface SetupFacts {
  env: Record<string, string | undefined>;
  /** The host the admin page was opened on, e.g. "cakes.example.com.au". */
  requestHost: string | null;
  memoryMode: boolean;
  supabase: { reachable: boolean; error?: string; missingTables: string[]; phase5: boolean; missingBuckets: string[] } | null;
  stripe: { reachable: boolean; error?: string; accountName?: string; chargesEnabled?: boolean } | null;
}

const present = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;

/** For a URL, show the host only. Anything that doesn't parse is shown as "set". */
export function safeHost(url: string | undefined): string {
  if (!present(url)) return "missing";
  try {
    return new URL(url!).host;
  } catch {
    return "set (not a valid URL)";
  }
}

export function stripeKeyMode(key: string | undefined): "test" | "live" | "restricted" | "unknown" | "missing" {
  if (!present(key)) return "missing";
  if (key!.startsWith("sk_test_")) return "test";
  if (key!.startsWith("sk_live_")) return "live";
  if (key!.startsWith("rk_")) return "restricted";
  return "unknown";
}

function envChecks(env: SetupFacts["env"]): SetupCheck[] {
  return REQUIRED_ENV.map(({ name, secret, why }) => {
    const v = env[name];
    const set = present(v);
    let detail = set ? "set" : "missing";
    if (set && !secret && name.endsWith("_URL")) detail = safeHost(v);
    if (set && name === "PICKUP_DETAILS" && v!.includes("[Emily to add")) {
      return { id: `env:${name}`, group: "Settings" as const, label: name, status: "warn" as const, detail: "still the placeholder", fix: "Replace the placeholder with the real pickup address and parking note in Vercel." };
    }
    if (set && name === "EMAIL_FROM" && v!.includes("your-domain")) {
      return { id: `env:${name}`, group: "Settings" as const, label: name, status: "warn" as const, detail: "still the example address", fix: "Use an address on the domain verified in Resend." };
    }
    return {
      id: `env:${name}`,
      group: "Settings" as const,
      label: name,
      status: set ? ("ok" as const) : ("fail" as const),
      detail,
      fix: set ? null : `Add ${name} in Vercel (Project, Settings, Environment Variables). It ${why}.`,
    };
  });
}

/** Everything /admin/setup shows, in order. */
export function setupChecks(f: SetupFacts): SetupCheck[] {
  const { env } = f;
  const out: SetupCheck[] = envChecks(env);

  // Site address matches where the page was opened.
  const siteHost = safeHost(env.NEXT_PUBLIC_SITE_URL);
  if (present(env.NEXT_PUBLIC_SITE_URL) && f.requestHost) {
    const same = siteHost === f.requestHost;
    out.push({
      id: "site-url",
      group: "Settings",
      label: "Site address matches this page",
      status: same ? "ok" : "warn",
      detail: same ? siteHost : `NEXT_PUBLIC_SITE_URL is ${siteHost}, this page is on ${f.requestHost}`,
      fix: same ? null : "Email links use NEXT_PUBLIC_SITE_URL. Set it to the address customers use (after adding a custom domain, update it and redeploy).",
    });
  }

  // Database.
  if (f.memoryMode) {
    out.push({ id: "db", group: "Database", label: "Database", status: "warn", detail: "test mode (in-memory data)", fix: "This is the local test mode. The live site needs DATA_ADAPTER unset and the Supabase settings above." });
  } else if (!f.supabase) {
    out.push({ id: "db", group: "Database", label: "Supabase reachable", status: "fail", detail: "not checked (settings missing)", fix: "Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then reload this page." });
  } else if (!f.supabase.reachable) {
    out.push({ id: "db", group: "Database", label: "Supabase reachable", status: "fail", detail: f.supabase.error ?? "no answer", fix: "Check the project URL and service role key are from the same Supabase project, and that the project isn't paused." });
  } else {
    out.push({ id: "db", group: "Database", label: "Supabase reachable", status: "ok", detail: "connected", fix: null });
    const missing = f.supabase.missingTables;
    const migrations = [...new Set(EXPECTED_TABLES.filter((t) => missing.includes(t.table)).map((t) => t.migration))];
    out.push({
      id: "db-tables",
      group: "Database",
      label: "Database tables",
      status: missing.length ? "fail" : "ok",
      detail: missing.length ? `missing: ${missing.join(", ")}` : "all present",
      fix: missing.length ? `Run these in the Supabase SQL editor, in order: ${migrations.join(", ")}.` : null,
    });
    out.push({
      id: "db-phase5",
      group: "Database",
      label: "Phase 5 migration",
      status: f.supabase.phase5 ? "ok" : "fail",
      detail: f.supabase.phase5 ? "run" : "not run yet",
      fix: f.supabase.phase5 ? null : `Run ${PHASE5_MARKER.migration} in the Supabase SQL editor.`,
    });
    const mb = f.supabase.missingBuckets;
    out.push({
      id: "db-storage",
      group: "Database",
      label: "Photo and video storage",
      status: mb.length ? "fail" : "ok",
      detail: mb.length ? `missing bucket: ${mb.join(", ")}` : "bucket ready",
      fix: mb.length ? "The first migration creates the storage bucket. Run it again in the SQL editor (it is safe to repeat that part)." : null,
    });
  }

  // Payments.
  const mode = stripeKeyMode(env.STRIPE_SECRET_KEY);
  out.push({
    id: "stripe-mode",
    group: "Payments",
    label: "Stripe key",
    status: mode === "test" ? "warn" : mode === "live" ? "ok" : mode === "missing" ? (f.memoryMode ? "warn" : "fail") : "warn",
    detail:
      mode === "test" ? "test mode: no real money moves" : mode === "live" ? "live mode: real payments" : mode === "missing" ? (f.memoryMode ? "not set (pretend checkout in test mode)" : "missing") : `unexpected key type (${mode})`,
    fix:
      mode === "test"
        ? "Fine for testing. Switch to the sk_live_ key (and the live webhook secret) only after the pre-launch checks."
        : mode === "live"
          ? null
          : mode === "missing"
            ? "Add STRIPE_SECRET_KEY from Stripe (Developers, API keys). Start with the sk_test_ key."
            : "Use a standard secret key that starts with sk_test_ or sk_live_.",
  });
  if (f.stripe) {
    out.push({
      id: "stripe-api",
      group: "Payments",
      label: "Stripe answers",
      status: !f.stripe.reachable ? "fail" : f.stripe.chargesEnabled === false && mode === "live" ? "warn" : "ok",
      detail: !f.stripe.reachable ? (f.stripe.error ?? "no answer") : `connected${f.stripe.accountName ? ` to ${f.stripe.accountName}` : ""}`,
      fix: !f.stripe.reachable
        ? "Check the key was copied in full, from the right Stripe account."
        : f.stripe.chargesEnabled === false && mode === "live"
          ? "Stripe hasn't enabled live payments yet. Finish the business details and bank account in the Stripe dashboard."
          : null,
    });
  }
  const hook = present(env.STRIPE_WEBHOOK_SECRET);
  const hookOk = hook && env.STRIPE_WEBHOOK_SECRET!.startsWith("whsec_");
  out.push({
    id: "stripe-webhook",
    group: "Payments",
    label: "Stripe webhook secret",
    status: hookOk ? "ok" : hook ? "warn" : f.memoryMode ? "warn" : "fail",
    detail: hookOk ? "set" : hook ? "set, but doesn't start with whsec_" : "missing",
    fix: hookOk
      ? null
      : "In Stripe, add an endpoint for /api/stripe/webhook with checkout.session.completed, checkout.session.async_payment_succeeded and charge.refunded, then copy its signing secret (whsec_...) to STRIPE_WEBHOOK_SECRET.",
  });

  // Email.
  const resend = present(env.RESEND_API_KEY);
  out.push({
    id: "email",
    group: "Email",
    label: "Resend",
    status: resend ? "ok" : f.memoryMode ? "warn" : "fail",
    detail: resend ? "key set (use the button to send a test email)" : "missing",
    fix: resend ? null : "Add RESEND_API_KEY from Resend (API Keys), and verify the sending domain in Resend.",
  });

  // Security.
  const secret = env.ORDER_LINK_SECRET ?? "";
  out.push({
    id: "order-secret",
    group: "Security",
    label: "Order link secret length",
    status: secret.length >= 32 ? "ok" : "fail",
    detail: secret.length >= 32 ? "long enough" : present(secret) ? "too short" : "missing",
    fix: secret.length >= 32 ? null : "Use a random string of at least 32 characters. Never change it after launch.",
  });
  out.push({
    id: "cron",
    group: "Security",
    label: "Reminders job secret",
    status: present(env.CRON_SECRET) ? "ok" : "fail",
    detail: present(env.CRON_SECRET) ? "set" : "missing",
    fix: present(env.CRON_SECRET) ? null : "Add CRON_SECRET (a long random string). Vercel Cron sends it to the reminders job.",
  });
  const mfa = env.ADMIN_REQUIRE_MFA !== "false";
  out.push({
    id: "mfa",
    group: "Security",
    label: "Two-factor sign in for admin",
    status: mfa ? "ok" : "fail",
    detail: mfa ? "required" : "turned off",
    fix: mfa ? null : "Set ADMIN_REQUIRE_MFA to true. Without it, a stolen password is enough to see every order.",
  });
  return out;
}

export function overall(checks: SetupCheck[]): CheckStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "ok";
}
