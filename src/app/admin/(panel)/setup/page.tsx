import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { overall, type CheckStatus, type SetupCheck } from "@/lib/domain/setup";
import { runSetupChecks } from "@/lib/services/setup";
import { TestEmailButton } from "./TestEmailButton";

export const metadata: Metadata = { title: "Setup" };

const STYLE: Record<CheckStatus, { label: string; cls: string }> = {
  ok: { label: "Ready", cls: "bg-green-100 text-green-900" },
  warn: { label: "Check", cls: "bg-amber-100 text-amber-900" },
  fail: { label: "Fix", cls: "bg-red-100 text-red-900" },
};

const GROUPS: SetupCheck["group"][] = ["Settings", "Database", "Payments", "Email", "Security"];

export default async function SetupPage() {
  await requireAdmin();
  const host = (await headers()).get("host");
  const memoryMode = process.env.DATA_ADAPTER === "memory";
  const checks = await runSetupChecks(host, { memoryMode });
  const all = overall(checks);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-serif text-3xl">Setup and launch checks</h1>
        <p className="mt-1 text-sm text-muted">
          Green is ready, amber needs a look, red must be fixed before taking real orders. Secret values are never shown here, only whether they are set.
        </p>
      </div>
      {memoryMode && (
        <p className="rounded-xl border-2 border-dashed border-gold bg-blush px-4 py-3 text-sm" data-testid="setup-test-mode">
          <strong>Test mode.</strong> This copy runs on in-memory data with a pretend checkout. Nothing here is a real order, and the live site checks below only light up on the real deployment.
        </p>
      )}
      <p className={`rounded-xl px-4 py-3 text-sm font-semibold ${STYLE[all].cls}`} data-testid="setup-overall" data-status={all}>
        {all === "ok" ? "Everything checked is ready." : all === "warn" ? "Nothing is broken, but some things need a look." : `${checks.filter((c) => c.status === "fail").length} things need fixing before launch.`}
      </p>
      {GROUPS.map((group) => {
        const rows = checks.filter((c) => c.group === group);
        if (rows.length === 0) return null;
        return (
          <section key={group} className="card p-4">
            <h2 className="font-serif text-xl">{group}</h2>
            <ul className="mt-2 divide-y divide-line text-sm">
              {rows.map((c) => (
                <li key={c.id} className="grid gap-1 py-2 sm:grid-cols-[7rem_1fr]" data-testid={`check-${c.id}`} data-status={c.status}>
                  <span className={`h-fit w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${STYLE[c.status].cls}`}>{STYLE[c.status].label}</span>
                  <div className="min-w-0">
                    <p className="break-words">
                      <strong>{c.label}</strong>: <span className="text-muted">{c.detail}</span>
                    </p>
                    {c.fix && <p className="mt-0.5 break-words">{c.fix}</p>}
                  </div>
                </li>
              ))}
            </ul>
            {group === "Email" && (
              <div className="mt-3">
                <TestEmailButton />
              </div>
            )}
          </section>
        );
      })}
      <section className="card p-4 text-sm">
        <h2 className="font-serif text-xl">First live test</h2>
        <p className="mt-1">
          With Stripe in test mode, place an order on the site and pay with the card 4242 4242 4242 4242 (any future date, any CVC). The order should show as paid within a minute. The README&apos;s &quot;First live test&quot; section has the full checklist and the declined and authentication test cards.
        </p>
      </section>
    </div>
  );
}
