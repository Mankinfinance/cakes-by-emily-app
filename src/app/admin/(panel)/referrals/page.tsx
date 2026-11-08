import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { RewardsSettings } from "./RewardsSettings";

export default async function ReferralsAdmin() {
  await requireAdmin();
  const repo = await getRepo();
  const [settings, referrals] = await Promise.all([repo.getSettings(), repo.listReferrals()]);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-serif text-3xl">Referrals and stamp card</h1>
        <p className="mt-1 text-sm text-muted">
          Each customer gets a referral code on their order page. A new customer using it gets money off their first order; the referrer gets a credit
          code when that order&apos;s deposit is paid. Every Nth collected order earns a free reward, added to the next order automatically.
        </p>
      </div>
      <RewardsSettings settings={settings} />
      <section className="card p-5">
        <h2 className="font-serif text-xl">Referrals</h2>
        {referrals.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm" data-testid="referrals">
            {referrals.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <span className="font-mono">{r.code}</span> ({r.referrerEmail}) referred {r.referredEmail}
                </span>
                <span className="capitalize text-muted">{r.status === "rewarded" ? "Credit sent" : r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
