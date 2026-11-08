import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

export const metadata: Metadata = { title: "Thank you", robots: { index: false, follow: false } };

export default function VoucherThanks() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 text-center">
        <h1 className="font-serif text-3xl" data-testid="voucher-thanks">Thank you!</h1>
        <p className="mt-3 text-muted">
          Once Stripe confirms the payment, the voucher code is emailed to you (and to the recipient, if you gave their email). It usually takes a
          minute.
        </p>
        <Link href="/" className="btn btn-ghost mt-6">
          Back to the home page
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
