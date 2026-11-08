import type { Metadata } from "next";
import { connection } from "next/server";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { formatAud } from "@/lib/domain/money";
import { PassForm } from "./PassForm";

export const metadata: Metadata = { title: "Class pass" };

export default async function PassPage({ searchParams }: PageProps<"/classes/pass">) {
  await connection();
  const s = await (await getRepo()).getSettings();
  const { cancelled } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <h1 className="font-serif text-3xl">{s.passCredits}-class pass</h1>
        <p className="mt-1 text-muted">
          {s.passCredits} class seats for {formatAud(s.passPriceCents)}, valid for {s.passValidMonths} months. Use it on any public class: each seat uses one credit. Price is a sample.
        </p>
        {cancelled === "1" && <p className="mt-4 rounded-xl bg-blush px-4 py-3 text-sm">Payment was cancelled, so no pass was bought.</p>}
        {s.passEnabled ? <PassForm price={formatAud(s.passPriceCents)} /> : <p className="card mt-6 p-5">Class passes aren&apos;t on sale right now.</p>}
      </main>
      <SiteFooter />
    </>
  );
}
