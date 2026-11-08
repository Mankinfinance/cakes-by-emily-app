import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { formatDateLong, formatTime12 } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { shareDueDate } from "@/lib/domain/split";
import { guestFromTokens } from "@/lib/services/split";
import { PayShareButton } from "./PayShareButton";

export const metadata: Metadata = { title: "Your share", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function GuestPage({ params, searchParams }: PageProps<"/g/[token]/[guestId]/[guestToken]">) {
  await connection();
  const { token, guestId, guestToken } = await params;
  const { paid } = await searchParams;
  const repo = await getRepo();
  const found = await guestFromTokens({ repo }, token, guestId, guestToken);
  if (!found) notFound();
  const { request: r, guest: g } = found;
  const settings = await repo.getSettings();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        {paid === "1" && g.status === "open" && <p className="mb-4 rounded-xl bg-blush px-4 py-3 text-sm" role="status">Thank you! We&apos;re confirming your payment with Stripe. Refresh in a moment.</p>}
        <h1 className="font-serif text-3xl">Hi {g.name.split(" ")[0] || "there"}!</h1>
        <p className="mt-1 text-muted">
          {r.contactName.split(" ")[0]}&apos;s private {r.packageName} class, {formatDateLong(r.preferredDate)} at {formatTime12(r.preferredTime)}, Grasmere.
        </p>
        <section className="card mt-6 p-5 text-sm">
          <p>Your details are saved. Keep this page&apos;s link to come back to it.</p>
          {g.status === "paid" ? (
            <p className="mt-3 text-lg font-semibold" data-testid="share-paid">
              Your share of {formatAud(g.shareCents)} is paid. See you there!
            </p>
          ) : (
            <>
              <p className="mt-3">
                Your share is <strong>{formatAud(g.shareCents)}</strong>, due by {formatDateLong(shareDueDate(r, settings.splitDueDays))}.
              </p>
              <div className="mt-4">
                <PayShareButton shareToken={token} guestId={guestId} guestToken={guestToken} amount={formatAud(g.shareCents)} />
              </div>
            </>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
