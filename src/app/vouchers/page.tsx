import type { Metadata } from "next";
import { connection } from "next/server";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { VoucherForm } from "./VoucherForm";

export const metadata: Metadata = { title: "Gift vouchers" };

export default async function VouchersPage({ searchParams }: PageProps<"/vouchers">) {
  await connection();
  const s = await (await getRepo()).getSettings();
  const { cancelled } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <h1 className="font-serif text-3xl">Gift vouchers</h1>
        <p className="mt-1 text-muted">The sweetest gift. Vouchers are emailed straight away and are valid for {s.voucherValidMonths} months.</p>
        {cancelled === "1" && <p className="mt-4 rounded-xl bg-blush px-4 py-3 text-sm">Payment was cancelled, so no voucher was bought.</p>}
        <VoucherForm
          amounts={s.voucherOptions.filter((o) => o.visible).map((o) => o.cents)}
          custom={s.voucherCustomEnabled ? { min: s.voucherCustomMinCents, max: s.voucherCustomMaxCents } : null}
        />
      </main>
      <SiteFooter />
    </>
  );
}
