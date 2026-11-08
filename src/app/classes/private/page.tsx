import type { Metadata } from "next";
import { connection } from "next/server";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { addDays, todayInBusinessTz } from "@/lib/domain/dates";
import { PrivateForm } from "./PrivateForm";

export const metadata: Metadata = { title: "Private classes and parties" };

export default async function PrivatePage() {
  await connection();
  const settings = await (await getRepo()).getSettings();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="font-serif text-3xl">Private classes and parties</h1>
        <p className="mt-1 text-muted">Choose a package and a date. Emily checks the date and replies with a link to pay the deposit. Nothing is charged now. Prices are samples.</p>
        <PrivateForm packages={settings.privatePackages.filter((p) => p.visible)} minDate={addDays(todayInBusinessTz(), 7)} />
      </main>
      <SiteFooter />
    </>
  );
}
