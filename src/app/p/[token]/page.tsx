import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { siteUrl } from "@/lib/config";
import { getRepo } from "@/lib/data";
import { formatDateLong, formatTime12, todayInBusinessTz } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { canNudge, organiserCanPayRest, shareDueDate, splitProgress } from "@/lib/domain/split";
import { privateFromPayToken } from "@/lib/services/classes";
import { shareLink } from "@/lib/services/common";
import { OrganiserActions } from "./OrganiserActions";
import { PrivatePayButton } from "./PrivatePayButton";

export const metadata: Metadata = { title: "Your private class", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PrivatePayPage({ params, searchParams }: PageProps<"/p/[token]">) {
  await connection();
  const { token } = await params;
  const { paid } = await searchParams;
  const repo = await getRepo();
  const r = await privateFromPayToken(repo, token);
  if (!r) notFound();
  const [settings, guests] = await Promise.all([repo.getSettings(), repo.listGuests(r.id)]);
  const progress = splitProgress(guests);
  const due = shareDueDate(r, settings.splitDueDays);
  const today = todayInBusinessTz();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        {paid === "1" && <p className="mb-4 rounded-xl bg-blush px-4 py-3 text-sm" role="status">Thank you! If the payment doesn&apos;t show yet, refresh in a moment.</p>}
        <h1 className="font-serif text-3xl">Private {r.packageName} class</h1>
        <p className="mt-1 text-muted">
          {formatDateLong(r.preferredDate)} at {formatTime12(r.preferredTime)}, {r.guests} {r.packageKey === "kids" ? "children" : "guests"}
        </p>
        <section className="card mt-6 p-5 text-sm">
          <p>Estimate {formatAud(r.estimateCents)}. The deposit locks in the date; guests pay their share of the rest.</p>
          {r.status === "cancelled" ? (
            <p className="mt-3 font-semibold">{r.cancellation?.summary ?? "This class was cancelled."}</p>
          ) : r.status === "paid" ? (
            <p className="mt-3 font-semibold" data-testid="private-paid">Deposit received. Thank you!</p>
          ) : (
            <div className="mt-4">
              <PrivatePayButton token={token} amount={formatAud(r.depositCents)} />
            </div>
          )}
        </section>
        {r.status === "paid" && guests.length > 0 && (
          <section className="card mt-6 p-5 text-sm" data-testid="organiser-tracker">
            <h2 className="font-serif text-xl">Your guests</h2>
            <p className="mt-1 text-muted">Share this link with your guests. Each adds their details and pays their share. Shares are due by {formatDateLong(due)}.</p>
            <p className="mt-2 break-all rounded-lg border-2 border-dashed border-gold px-3 py-2 font-mono text-xs" data-testid="share-link">
              {shareLink(siteUrl(), r.id)}
            </p>
            <p className="mt-4 text-lg font-semibold" data-testid="tracker-count">
              {progress.paid} of {progress.guests} paid
            </p>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-blush" aria-hidden>
              <div className="h-full bg-rose" style={{ width: `${(progress.paid / Math.max(1, progress.guests)) * 100}%` }} />
            </div>
            <ul className="mt-3 divide-y divide-line" data-testid="tracker-names">
              {guests.map((g) => (
                <li key={g.id} className="flex justify-between py-1.5">
                  {/* Names only: guests' allergy details are only shared with Emily. */}
                  <span>{g.name || <span className="text-muted">Waiting for a guest</span>}</span>
                  <span className={g.status === "paid" ? "font-semibold text-rose" : "text-muted"}>{g.status === "paid" ? "Paid" : formatAud(g.shareCents)}</span>
                </li>
              ))}
            </ul>
            {(r.guestReductions ?? []).map((g) => (
              <p key={g.at} className="mt-3 rounded-lg bg-blush px-3 py-2" data-testid="organiser-reduction">
                {g.summary}
              </p>
            ))}
            <OrganiserActions
              token={token}
              canNudge={canNudge(r.lastNudgeAt, new Date()) && guests.some((g) => g.status === "open" && g.email)}
              canPayRest={organiserCanPayRest(today, due, progress)}
              restLabel={formatAud(progress.owingCents)}
              dueLabel={formatDateLong(due)}
              guests={r.guests}
              minGuests={settings.privatePackages.find((p) => p.key === r.packageKey)?.minGuests ?? 1}
              canReduce={today < due && guests.some((g) => g.status === "open")}
            />
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
