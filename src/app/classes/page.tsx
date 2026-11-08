import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { sessionLabel } from "@/lib/domain/classes";
import { todayInBusinessTz, addDays } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { sessionsWithTypes } from "@/lib/services/classes";
import { ClassWaitlistForm } from "./ClassWaitlistForm";

export const metadata: Metadata = { title: "Cake and Sip classes" };

export default async function ClassesPage({ searchParams }: PageProps<"/classes">) {
  await connection();
  const repo = await getRepo();
  const today = todayInBusinessTz();
  const [rows, types, settings] = await Promise.all([sessionsWithTypes(repo, addDays(today, 1)), repo.listClassTypes(), repo.getSettings()]);
  const { cancelled } = await searchParams;
  const visibleTypes = types.filter((t) => t.visible);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <h1 className="font-serif text-3xl">Cake and Sip classes</h1>
        <p className="mt-1 text-muted">
          Small, relaxed classes in Emily&apos;s {"Grasmere"} studio. Everything is supplied. Book {settings.groupDiscountMinSeats} or more seats and save {settings.groupDiscountPercent}%. Prices are samples.
        </p>
        {cancelled === "1" && <p className="mt-4 rounded-xl bg-blush px-4 py-3 text-sm">Payment was cancelled, so nothing was booked.</p>}
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {visibleTypes.map((t) => (
            <article key={t.id} className="card p-5" data-testid={`type-${t.id}`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-rose">
                {t.level} &middot; {t.ageNote}
              </p>
              <h2 className="mt-1 font-serif text-xl">{t.name}</h2>
              <p className="mt-1 text-sm text-muted">{t.description}</p>
              <p className="mt-2 font-semibold">
                {formatAud(t.priceCents)} per person &middot; {Math.round(t.durationMinutes / 30) / 2} hours
              </p>
            </article>
          ))}
        </div>

        <h2 className="mt-10 font-serif text-2xl">Upcoming classes</h2>
        {rows.filter((r) => r.type.visible).length === 0 ? (
          <p className="mt-2 text-muted">No classes are scheduled right now. Follow along on Instagram for new dates.</p>
        ) : (
          <ul className="mt-3 grid gap-3" data-testid="sessions">
            {rows
              .filter((r) => r.type.visible)
              .map(({ session, type, left }) => (
                <li key={session.id} className="card flex flex-wrap items-center justify-between gap-3 p-4" data-testid={`session-${session.id}`}>
                  <div>
                    <p className="font-semibold">{type.name}</p>
                    <p className="text-sm text-muted">{sessionLabel(session)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`text-sm ${left === 0 ? "font-semibold text-rose" : left <= 2 ? "font-semibold text-rose" : "text-muted"}`} data-testid="seats-left">
                      {left === 0 ? "Sold out" : left <= 2 ? `Only ${left} left` : `${left} seats left`}
                    </span>
                    {left > 0 ? (
                      <Link href={`/classes/${session.id}`} className="btn btn-primary !py-2" data-testid="book-session">
                        Book
                      </Link>
                    ) : (
                      <ClassWaitlistForm sessionId={session.id} />
                    )}
                  </div>
                </li>
              ))}
          </ul>
        )}

        <section className="card mt-10 flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-serif text-2xl">Private classes and parties</h2>
            <p className="mt-1 text-muted">Hens, birthdays, team days and kids&apos; parties. Choose a package and a date, and Emily will confirm.</p>
          </div>
          <Link href="/classes/private" className="btn btn-primary shrink-0" data-testid="private-link">
            Request a private class
          </Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
