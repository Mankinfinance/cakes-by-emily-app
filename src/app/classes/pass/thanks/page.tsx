import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

export const metadata: Metadata = { title: "Thank you", robots: { index: false, follow: false } };

export default function PassThanks() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 text-center">
        <h1 className="font-serif text-3xl" data-testid="pass-thanks">Thank you!</h1>
        <p className="mt-3 text-muted">Once Stripe confirms the payment, your pass code is emailed to you. Enter it when you book a class.</p>
        <Link href="/classes" className="btn btn-ghost mt-6">
          See upcoming classes
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
