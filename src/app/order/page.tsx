import type { Metadata } from "next";
import { connection } from "next/server";
import { Builder } from "@/components/builder/Builder";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { todayInBusinessTz } from "@/lib/domain/dates";
import { visibleItems } from "@/lib/domain/visibility";

export const metadata: Metadata = { title: "Design your cake" };

export default async function OrderPage({ searchParams }: PageProps<"/order">) {
  await connection();
  const repo = await getRepo();
  const [items, settings] = await Promise.all([repo.listCatalogue(), repo.getSettings()]);
  const { cancelled } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Builder
          items={visibleItems(items)}
          settings={settings}
          today={todayInBusinessTz()}
          cancelled={cancelled === "1"}
        />
      </main>
      <SiteFooter />
    </>
  );
}
