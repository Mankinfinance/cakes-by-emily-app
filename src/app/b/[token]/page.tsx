import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { BUSINESS } from "@/lib/config";
import { formatDateLong, formatTime12 } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { boxOrderFromToken } from "@/lib/orders-public";

export const metadata: Metadata = { title: "Your pre-order", robots: { index: false, follow: false }, referrer: "no-referrer" };

const STATUS = { awaiting_payment: "Waiting for payment", paid: "Confirmed", collected: "Collected", cancelled: "Cancelled" } as const;

export default async function BoxOrderPage({ params, searchParams }: PageProps<"/b/[token]">) {
  await connection();
  const { token } = await params;
  const { paid } = await searchParams;
  const order = await boxOrderFromToken(token);
  if (!order) notFound();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        {paid === "1" && order.status === "awaiting_payment" && (
          <p className="mb-4 rounded-xl bg-blush px-4 py-3 text-sm" role="status">
            Thank you! We&apos;re confirming your payment with Stripe. Refresh in a moment.
          </p>
        )}
        <p className="text-sm text-muted">Pre-order {order.reference}</p>
        <h1 className="font-serif text-3xl">{order.boxName}</h1>
        <section className="card mt-6 p-5 text-sm">
          <p className="text-lg font-semibold" data-testid="box-status">{STATUS[order.status]}</p>
          <dl className="mt-3 grid grid-cols-2 gap-y-1">
            <dt className="text-muted">Quantity</dt>
            <dd className="text-right">{order.quantity}</dd>
            <dt className="text-muted">Paid</dt>
            <dd className="text-right" data-testid="box-paid">{formatAud(order.amountPaidCents)}</dd>
            {(order.voucherAppliedCents ?? 0) > 0 && (
              <>
                <dt className="text-muted">Voucher or credit</dt>
                <dd className="text-right" data-testid="box-voucher-applied">{formatAud(order.voucherAppliedCents!)}</dd>
              </>
            )}
            <dt className="text-muted">Pickup</dt>
            <dd className="text-right">
              {formatDateLong(order.pickupDate)} at {formatTime12(order.pickupSlot)}, {BUSINESS.suburb}
            </dd>
          </dl>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
