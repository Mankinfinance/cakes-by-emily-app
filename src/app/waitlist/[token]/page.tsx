import type { Metadata } from "next";
import { connection } from "next/server";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { formatDateLong } from "@/lib/domain/dates";
import { offerFromToken } from "@/lib/services/waitlist";
import { ClaimForm } from "./ClaimForm";

export const metadata: Metadata = { title: "Claim your spot", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ClaimPage({ params }: PageProps<"/waitlist/[token]">) {
  await connection();
  const { token } = await params;
  const repo = await getRepo();
  const entry = await offerFromToken({ repo }, token);
  const catalogue = await repo.listCatalogue();
  const name = (id: string) => catalogue.find((c) => c.id === id)?.name ?? "";
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        {!entry ? (
          <div data-testid="claim-expired">
            <h1 className="font-serif text-3xl">This offer has ended</h1>
            <p className="mt-2 text-muted">Sorry, the 24 hours to claim this spot have passed, or it has already been booked.</p>
          </div>
        ) : (
          <>
            <h1 className="font-serif text-3xl">A spot opened on {formatDateLong(entry.date)}</h1>
            <p className="mt-1 text-muted">It&apos;s held for you until {new Date(entry.offerExpiresAt!).toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" })}.</p>
            <section className="card mt-6 p-5 text-sm">
              <h2 className="font-serif text-xl">Your saved cake</h2>
              <p className="mt-2">
                {[entry.config.size, entry.config.flavour, entry.config.finish, entry.config.colour].map(name).filter(Boolean).join(", ")}
              </p>
              {entry.config.decorations.length > 0 && <p className="text-muted">Decorations: {entry.config.decorations.map(name).join(", ")}</p>}
              {entry.config.extras.length > 0 && <p className="text-muted">Extras: {entry.config.extras.map(name).join(", ")}</p>}
              {entry.config.topperText && <p>Topper: {entry.config.topperText}</p>}
            </section>
            <ClaimForm token={token} entry={{ date: entry.date, config: entry.config, dietary: entry.dietary, customerName: entry.customerName, email: entry.email, phone: entry.phone }} />
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
