import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { BUSINESS } from "@/lib/config";

export const metadata: Metadata = { title: "Privacy policy" };

export default function Privacy() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 leading-relaxed">
        <h1 className="font-serif text-3xl">Privacy policy</h1>
        <p className="mt-2 rounded-xl bg-blush px-4 py-3 text-sm">
          [Draft for Emily to review. Have it checked before launch. Replace anything in square brackets.]
        </p>
        <h2 className="mt-8 font-serif text-xl">What we collect</h2>
        <p className="mt-2">
          When you order, {BUSINESS.name} collects your name, email, mobile number, your cake choices, any allergy notes and anything else you
          choose to tell us, plus an inspiration photo if you upload one.
        </p>
        <h2 className="mt-6 font-serif text-xl">Why</h2>
        <p className="mt-2">
          To make and hand over your order, contact you about it, and send reminders about payment and pickup. Allergy notes are used only to
          make your order safely.
        </p>
        <h2 className="mt-6 font-serif text-xl">Payments</h2>
        <p className="mt-2">
          Card payments are handled by Stripe. We never see or store your card number. See{" "}
          <a className="underline" href="https://stripe.com/au/privacy" target="_blank" rel="noopener noreferrer">
            Stripe&apos;s privacy policy
          </a>
          .
        </p>
        <h2 className="mt-6 font-serif text-xl">Marketing</h2>
        <p className="mt-2">We only send offers or news if you tick the box to say yes. You can unsubscribe at any time.</p>
        <h2 className="mt-6 font-serif text-xl">Where it is kept and for how long</h2>
        <p className="mt-2">
          Order details are stored securely with our hosting providers [Supabase, region: Sydney] and kept for [7 years for tax records / Emily
          to confirm]. Photos are kept for [Emily to confirm].
        </p>
        <h2 className="mt-6 font-serif text-xl">Your choices</h2>
        <p className="mt-2">
          You can ask to see, correct or delete your details by emailing [Emily&apos;s email address]. We will respond within [30 days].
        </p>
        <p className="mt-8 text-sm text-muted">Last updated: [date]</p>
      </main>
      <SiteFooter />
    </>
  );
}
