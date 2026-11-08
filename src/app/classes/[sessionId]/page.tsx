import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { seatsLeft, sessionLabel } from "@/lib/domain/classes";
import { todayInBusinessTz } from "@/lib/domain/dates";
import { BookingForm } from "../BookingForm";

export const metadata: Metadata = { title: "Book a class" };

export default async function BookClassPage({ params }: PageProps<"/classes/[sessionId]">) {
  await connection();
  const { sessionId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) notFound();
  const repo = await getRepo();
  const session = await repo.getSession(sessionId);
  const type = session && (await repo.listClassTypes()).find((t) => t.id === session.classTypeId);
  if (!session || !type || !type.visible || session.status !== "scheduled" || session.date <= todayInBusinessTz()) notFound();
  const settings = await repo.getSettings();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <h1 className="font-serif text-3xl">{type.name}</h1>
        <p className="mt-1 text-muted">
          {sessionLabel(session)}, Grasmere &middot; {type.level} &middot; {type.ageNote}
        </p>
        <BookingForm
          sessionId={session.id}
          unitCents={type.priceCents}
          maxSeats={Math.min(6, seatsLeft(session))}
          isSip={type.isSip}
          discount={{ groupDiscountMinSeats: settings.groupDiscountMinSeats, groupDiscountPercent: settings.groupDiscountPercent }}
        />
      </main>
      <SiteFooter />
    </>
  );
}
