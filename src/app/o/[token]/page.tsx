import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { Tracker } from "@/components/Tracker";
import { getRepo } from "@/lib/data";
import { formatDateLong, formatTime12 } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { balanceOwing } from "@/lib/domain/pricing";
import { stageLabel } from "@/lib/domain/stages";
import { orderFromToken } from "@/lib/orders-public";
import { PayBalanceButton } from "./PayBalanceButton";

export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function OrderStatusPage({ params, searchParams }: PageProps<"/o/[token]">) {
  await connection();
  const { token } = await params;
  const { paid } = await searchParams;
  const order = await orderFromToken(token);
  if (!order) notFound();
  const repo = await getRepo();
  const updates = await repo.listUpdates(order.id);
  const media = await Promise.all(updates.map((u) => (u.mediaPath ? repo.mediaUrl(u.mediaPath) : Promise.resolve(null))));
  const owing = balanceOwing(order);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {paid === "1" && order.stage === "awaiting_payment" && (
          <p className="mb-4 rounded-xl bg-blush px-4 py-3 text-sm" role="status">
            Thank you! We&apos;re confirming your payment with Stripe. This page will show it in a moment, so refresh if it hasn&apos;t updated.
          </p>
        )}
        {paid === "1" && order.stage !== "awaiting_payment" && (
          <p className="mb-4 rounded-xl bg-blush px-4 py-3 text-sm" role="status" data-testid="paid-banner">
            Payment received. Thank you! A confirmation email is on its way.
          </p>
        )}
        <p className="text-sm text-muted">Order {order.reference}</p>
        <h1 className="font-serif text-3xl">Your cake&apos;s journey</h1>
        <p className="mt-1 text-muted">
          Pickup {formatDateLong(order.pickupDate)} at {formatTime12(order.pickupSlot)}, Grasmere
        </p>

        <section className="card mt-6 p-5">
          {order.stage === "awaiting_payment" ? (
            <p data-testid="awaiting">Waiting for your {order.isRush ? "payment" : "deposit"} to come through.</p>
          ) : (
            <Tracker stage={order.stage} />
          )}
        </section>

        <section className="card mt-6 p-5">
          <h2 className="font-serif text-xl">Payment</h2>
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Total</dt>
            <dd className="text-right">{formatAud(order.totalCents)}</dd>
            <dt className="text-muted">Paid</dt>
            <dd className="text-right" data-testid="amount-paid">{formatAud(order.amountPaidCents)}</dd>
            <dt className="font-semibold">Balance</dt>
            <dd className="text-right font-semibold" data-testid="balance">{formatAud(owing)}</dd>
          </dl>
          {owing > 0 && order.stage !== "awaiting_payment" && order.stage !== "cancelled" && (
            <div className="mt-4">
              <PayBalanceButton token={token} amount={formatAud(owing)} />
            </div>
          )}
        </section>

        <section className="mt-6">
          <h2 className="font-serif text-xl">Updates from Emily</h2>
          {updates.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Updates and photos will appear here as your cake comes together.</p>
          ) : (
            <ul className="mt-3 grid gap-3" data-testid="updates">
              {updates.map((u, i) => (
                <li key={u.id} className="card overflow-hidden">
                  {u.kind === "photo" && media[i] && (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs from storage
                    <img src={media[i]!} alt={u.caption || "Photo of your cake in progress"} className="max-h-[480px] w-full object-cover" />
                  )}
                  {u.kind === "video" && media[i] && (
                    <video src={media[i]!} controls playsInline preload="metadata" className="max-h-[480px] w-full bg-black" />
                  )}
                  <div className="p-4 text-sm">
                    {u.kind === "stage" && <p className="text-xs font-semibold uppercase tracking-wide text-rose">Update</p>}
                    <p>{u.caption}</p>
                    <p className="mt-1 text-xs text-muted">
                      {new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }).format(new Date(u.createdAt))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card mt-6 p-5 text-sm">
          <h2 className="font-serif text-xl">Your cake</h2>
          <ul className="mt-3 divide-y divide-line">
            {order.items.map((i, k) => (
              <li key={k} className="flex justify-between py-2">
                <span>{i.name}</span>
                <span>{i.amountCents ? formatAud(i.amountCents) : "Included"}</span>
              </li>
            ))}
          </ul>
          {order.config.topperText && <p className="mt-2">Topper: {order.config.topperText}</p>}
          <p className="mt-3 text-muted">Status: {stageLabel(order.stage)}</p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
