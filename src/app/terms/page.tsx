import type { Metadata } from "next";
import { connection } from "next/server";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { formatAud } from "@/lib/domain/money";
import { termsLines } from "@/lib/domain/terms";

export const metadata: Metadata = { title: "Terms" };

export default async function Terms() {
  await connection();
  const s = await (await getRepo()).getSettings();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 leading-relaxed">
        <h1 className="font-serif text-3xl">Order terms</h1>
        <p className="mt-2 rounded-xl bg-blush px-4 py-3 text-sm">
          [Draft for Emily to review. Have it checked before launch. Replace anything in square brackets.]
        </p>
        <h2 className="mt-8 font-serif text-xl">Deposits and payment</h2>
        <p className="mt-2">
          A {s.depositPercent}% deposit secures your date. The balance is due {s.balanceDueDays} days before pickup. Rush orders (inside{" "}
          {s.minNoticeDays} days) include a {formatAud(s.rushFeeCents)} rush fee and are paid in full when you order.
        </p>
        <h2 className="mt-6 font-serif text-xl">Cancellations, changes and credit</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5" data-testid="terms-rules">
          {termsLines(s).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {s.cancellationPolicy && <p className="mt-2 whitespace-pre-line">{s.cancellationPolicy}</p>}
        <h2 className="mt-6 font-serif text-xl">Seasonal boxes and gift vouchers</h2>
        <p className="mt-2">Seasonal boxes and gift vouchers are paid in full when you order and aren&apos;t refundable. [Emily to confirm.]</p>
        <h2 className="mt-6 font-serif text-xl">Allergies</h2>
        <p className="mt-2">
          Our kitchen handles nuts, gluten, egg, dairy, soy and sesame. We take care, but cannot guarantee any cake is free from traces. Please
          tell us about allergies when you order. [Emily to confirm wording.]
        </p>
        <h2 className="mt-6 font-serif text-xl">Pickup and cake care</h2>
        <p className="mt-2">
          Please arrive within your pickup window. Carry cakes flat on the floor or boot of the car, keep them cool and out of the sun, and
          refrigerate on hot days. Once collected, the cake is your responsibility. Tiered cakes contain internal supports that must be removed
          before serving. [Emily to confirm.]
        </p>
        <h2 className="mt-6 font-serif text-xl">The design</h2>
        <p className="mt-2">
          The preview in the builder is an illustration. Every cake is handmade, so the finished cake may differ slightly from photos or the
          preview.
        </p>
        <p className="mt-8 text-sm text-muted">ABN: [Emily&apos;s ABN]. Last updated: [date]</p>
      </main>
      <SiteFooter />
    </>
  );
}
