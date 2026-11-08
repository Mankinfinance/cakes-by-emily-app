import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { formatDateLong, formatTime12 } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { privateFromPayToken } from "@/lib/services/classes";
import { PrivatePayButton } from "./PrivatePayButton";

export const metadata: Metadata = { title: "Private class deposit", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PrivatePayPage({ params }: PageProps<"/p/[token]">) {
  await connection();
  const { token } = await params;
  const r = await privateFromPayToken(await getRepo(), token);
  if (!r) notFound();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <h1 className="font-serif text-3xl">Private {r.packageName} class</h1>
        <p className="mt-1 text-muted">
          {formatDateLong(r.preferredDate)} at {formatTime12(r.preferredTime)}, {r.guests} {r.packageKey === "kids" ? "children" : "guests"}
        </p>
        <section className="card mt-6 p-5 text-sm">
          <p>Estimate {formatAud(r.estimateCents)}. The deposit locks in the date; the rest is due before the class.</p>
          {r.status === "paid" ? (
            <p className="mt-3 font-semibold" data-testid="private-paid">Deposit received. Thank you!</p>
          ) : (
            <div className="mt-4">
              <PrivatePayButton token={token} amount={formatAud(r.depositCents)} />
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
