import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { formatDateLong, formatTime12 } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { corporateFromToken } from "@/lib/orders-public";
import { CorporateBalanceButton } from "./CorporateBalanceButton";

export const metadata: Metadata = { title: "Your corporate order", robots: { index: false, follow: false }, referrer: "no-referrer" };

const STATUS = { awaiting_payment: "Waiting for the deposit", confirmed: "Confirmed", ready: "Ready for pickup", collected: "Collected", cancelled: "Cancelled" } as const;

export default async function CorporateOrderPage({ params, searchParams }: PageProps<"/c/[token]">) {
  await connection();
  const { token } = await params;
  const { paid } = await searchParams;
  const order = await corporateFromToken(token);
  if (!order) notFound();
  const owing = Math.max(0, order.totalCents - order.amountPaidCents);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        {paid === "1" && order.status === "awaiting_payment" && <p className="mb-4 rounded-xl bg-blush px-4 py-3 text-sm">Thank you! We&apos;re confirming your payment with Stripe. Refresh in a moment.</p>}
        <p className="text-sm text-muted">Order {order.reference}</p>
        <h1 className="font-serif text-3xl">{order.packageName}</h1>
        <p className="text-muted">For {order.companyName}</p>
        <section className="card mt-6 p-5 text-sm">
          <p className="text-lg font-semibold" data-testid="corp-status">{STATUS[order.status]}</p>
          <dl className="mt-3 grid grid-cols-2 gap-y-1">
            <dt className="text-muted">Pickup</dt>
            <dd className="text-right">{formatDateLong(order.pickupDate)} at {formatTime12(order.pickupSlot)}</dd>
            <dt className="text-muted">Total</dt>
            <dd className="text-right">{formatAud(order.totalCents)}</dd>
            <dt className="text-muted">Paid</dt>
            <dd className="text-right" data-testid="corp-paid">{formatAud(order.amountPaidCents)}</dd>
            <dt className="font-semibold">Balance</dt>
            <dd className="text-right font-semibold" data-testid="corp-balance">{formatAud(owing)}</dd>
          </dl>
          {owing > 0 && order.status !== "awaiting_payment" && order.status !== "cancelled" && (
            <div className="mt-4">
              <CorporateBalanceButton token={token} amount={formatAud(owing)} />
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
