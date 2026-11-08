import type { Metadata } from "next";
import { connection } from "next/server";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { addDays, todayInBusinessTz } from "@/lib/domain/dates";
import { CorporateForm } from "./CorporateForm";

export const metadata: Metadata = { title: "Corporate orders" };

export default async function CorporatePage({ searchParams }: PageProps<"/corporate">) {
  await connection();
  const repo = await getRepo();
  const [packages, settings] = await Promise.all([repo.listCorporatePackages(), repo.getSettings()]);
  const { cancelled } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <h1 className="font-serif text-3xl">Corporate orders</h1>
        <p className="mt-1 text-muted">Iced cookies and cupcakes with your logo, for launches, thank-yous and team celebrations. Prices are samples.</p>
        {cancelled === "1" && <p className="mt-4 rounded-xl bg-blush px-4 py-3 text-sm">Payment was cancelled, so nothing was ordered.</p>}
        <CorporateForm
          packages={packages.filter((p) => p.visible)}
          depositPercent={settings.depositPercent}
          minDate={addDays(todayInBusinessTz(), settings.minNoticeDays)}
        />
      </main>
      <SiteFooter />
    </>
  );
}
