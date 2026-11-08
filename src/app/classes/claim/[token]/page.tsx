import type { Metadata } from "next";
import { connection } from "next/server";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { sessionLabel } from "@/lib/domain/classes";
import { classOfferFromToken } from "@/lib/services/classes";
import { BookingForm } from "../../BookingForm";

export const metadata: Metadata = { title: "Claim your seats", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ClassClaimPage({ params }: PageProps<"/classes/claim/[token]">) {
  await connection();
  const { token } = await params;
  const repo = await getRepo();
  const entry = await classOfferFromToken({ repo }, token);
  const session = entry?.sessionId ? await repo.getSession(entry.sessionId) : null;
  const type = session && (await repo.listClassTypes()).find((t) => t.id === session.classTypeId);
  const settings = await repo.getSettings();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        {!entry || !session || !type ? (
          <div data-testid="class-claim-expired">
            <h1 className="font-serif text-3xl">This offer has ended</h1>
            <p className="mt-2 text-muted">Sorry, the 24 hours to claim these seats have passed, or they&apos;ve already been booked.</p>
          </div>
        ) : (
          <>
            <h1 className="font-serif text-3xl">Your seats for {type.name}</h1>
            <p className="mt-1 text-muted">{sessionLabel(session)}. Held for you for 24 hours from the email.</p>
            <BookingForm
              sessionId={session.id}
              unitCents={type.priceCents}
              maxSeats={entry.seats ?? 1}
              isSip={type.isSip}
              discount={{ groupDiscountMinSeats: settings.groupDiscountMinSeats, groupDiscountPercent: settings.groupDiscountPercent }}
              claim={{ token, seats: entry.seats ?? 1, name: entry.customerName, email: entry.email, phone: entry.phone }}
            />
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
