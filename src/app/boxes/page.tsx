import type { Metadata } from "next";
import { connection } from "next/server";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { boxStatus } from "@/lib/domain/boxes";
import { slotTimes } from "@/lib/domain/availability";
import { todayInBusinessTz } from "@/lib/domain/dates";
import { BoxOrderForm } from "./BoxOrderForm";

export const metadata: Metadata = { title: "Seasonal boxes" };

export default async function BoxesPage({ searchParams }: PageProps<"/boxes">) {
  await connection();
  const repo = await getRepo();
  const [boxes, settings, daysOff] = await Promise.all([repo.listBoxes(), repo.getSettings(), repo.listDaysOff()]);
  const today = todayInBusinessTz();
  const shown = boxes
    .filter((b) => b.visible)
    .map((b) => ({ box: b, status: boxStatus(b, today) }))
    .filter((x) => x.status.state !== "closed");
  const { cancelled } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <h1 className="font-serif text-3xl">Seasonal boxes</h1>
        <p className="mt-1 text-muted">Limited pre-order treat boxes. Once they&apos;re gone, they&apos;re gone.</p>
        {cancelled === "1" && <p className="mt-4 rounded-xl bg-blush px-4 py-3 text-sm">Payment was cancelled, so nothing was ordered.</p>}
        {shown.length === 0 ? (
          <p className="mt-8 text-muted">No boxes are open right now. Follow along on Instagram for the next one.</p>
        ) : (
          <div className="mt-6 grid gap-6 md:grid-cols-2" data-testid="boxes">
            {shown.map(({ box, status }) => (
              <BoxOrderForm
                key={box.id}
                box={box}
                status={status}
                today={today}
                slots={slotTimes(settings)}
                closedWeekdays={settings.closedWeekdays}
                daysOff={daysOff.map((d) => d.date)}
              />
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
