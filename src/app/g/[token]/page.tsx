import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { formatDateLong, formatTime12 } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { requestFromShareToken } from "@/lib/services/split";
import { GuestForm } from "./GuestForm";

export const metadata: Metadata = { title: "Join the class", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function GuestJoinPage({ params }: PageProps<"/g/[token]">) {
  await connection();
  const { token } = await params;
  const repo = await getRepo();
  const r = await requestFromShareToken({ repo }, token);
  if (!r) notFound();
  const guests = await repo.listGuests(r.id);
  const open = guests.filter((g) => !g.name).length;
  const share = guests.find((g) => !g.name)?.shareCents ?? guests[guests.length - 1]?.shareCents ?? 0;
  const organiser = r.contactName.split(" ")[0];
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <h1 className="font-serif text-3xl" data-testid="guest-heading">
          Join {organiser}&apos;s class: add your details and pay your share
        </h1>
        <p className="mt-1 text-muted">
          Private {r.packageName} class, {formatDateLong(r.preferredDate)} at {formatTime12(r.preferredTime)}, Grasmere.
        </p>
        {open === 0 ? (
          <p className="card mt-6 p-5">All {r.guests} places already have a guest. Please check with {organiser}.</p>
        ) : (
          <GuestForm shareToken={token} shareLabel={formatAud(share)} />
        )}
      </main>
      <SiteFooter />
    </>
  );
}
