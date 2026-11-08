import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { Tracker } from "@/components/Tracker";
import { getRepo } from "@/lib/data";
import { messageTimeline } from "@/lib/domain/automations";
import { addDays, daysBetween, formatDateLong, formatTime12, todayInBusinessTz } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { balanceOwing } from "@/lib/domain/pricing";
import { stageLabel } from "@/lib/domain/stages";
import { termsCheck } from "@/lib/domain/terms";
import { orderFromToken } from "@/lib/orders-public";
import { referralCodeFor, stampCardFor } from "@/lib/services/referrals";
import { ApprovalPanel } from "./ApprovalPanel";
import { ChangeOrCancel } from "./ChangeOrCancel";
import { PayBalanceButton } from "./PayBalanceButton";

const STATUS_TEXT = { sent: "Sent", scheduled: "Scheduled", off: "Off", not_needed: "Not needed", waiting: "When it happens" } as const;

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
  const [updates, settings, automations, messages] = await Promise.all([
    repo.listUpdates(order.id),
    repo.getSettings(),
    repo.listAutomations(),
    repo.listMessages(order.id),
  ]);
  const media = await Promise.all(updates.map((u) => (u.mediaPath ? repo.mediaUrl(u.mediaPath) : Promise.resolve(null))));
  const owing = balanceOwing(order);
  const today = todayInBusinessTz();
  const check = termsCheck(order, settings, daysBetween(today, order.pickupDate));
  const timeline = messageTimeline(order, automations, messages);
  const sketch = order.stage === "awaiting_approval" ? updates.find((u) => u.kind === "sketch") : undefined;
  const paidUp = order.stage !== "awaiting_payment" && order.stage !== "cancelled";
  const referral = paidUp && settings.referralsEnabled ? await referralCodeFor(repo, order.email, order.customerName) : null;
  const stamps = paidUp && settings.stampsEnabled ? await stampCardFor(repo, settings, order.email) : null;
  const sketchUrl = sketch ? media[updates.indexOf(sketch)] : null;

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

        {sketch && (
          <section className="card mt-6 border-rose p-5" data-testid="approval">
            <h2 className="font-serif text-xl">Your design is ready to approve</h2>
            {sketchUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img src={sketchUrl} alt="Emily's sketch of your cake" className="mt-3 max-h-[420px] rounded-xl" />
            )}
            {sketch.caption && <p className="mt-3 whitespace-pre-line text-sm">{sketch.caption}</p>}
            <ApprovalPanel
              token={token}
              freeRoundsLeft={Math.max(0, settings.freeDesignChangeRounds - order.designChangesUsed)}
              canChange={check.canChangeDesign}
              changeReason={check.designReason}
            />
          </section>
        )}

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
            {order.voucherAppliedCents > 0 && (
              <>
                <dt className="text-muted">Voucher or credit</dt>
                <dd className="text-right" data-testid="voucher-applied">{formatAud(order.voucherAppliedCents)}</dd>
              </>
            )}
            <dt className="font-semibold">Balance</dt>
            <dd className="text-right font-semibold" data-testid="balance">{formatAud(owing)}</dd>
          </dl>
          {owing > 0 && order.stage !== "awaiting_payment" && order.stage !== "cancelled" && (
            <div className="mt-4">
              <PayBalanceButton token={token} amount={formatAud(owing)} />
            </div>
          )}
        </section>

        {order.cancellation && (
          <section className="card mt-6 p-5 text-sm" data-testid="cancellation">
            <h2 className="font-serif text-xl">Cancellation</h2>
            <p className="mt-2">{order.cancellation.summary}</p>
          </section>
        )}

        {order.stage !== "awaiting_payment" && order.stage !== "cancelled" && order.stage !== "collected" && (
          <section className="card mt-6 p-5">
            <h2 className="font-serif text-xl">Change or cancel</h2>
            <p className="mb-3 text-sm text-muted">
              What applies today, under the{" "}
              <a href="/terms" className="underline" target="_blank">
                order terms
              </a>
              .
            </p>
            <ChangeOrCancel token={token} check={check} minDate={addDays(today, 1)} />
          </section>
        )}

        <section className="mt-6">
          <h2 className="font-serif text-xl">Updates from Emily</h2>
          {updates.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Updates and photos will appear here as your cake comes together.</p>
          ) : (
            <ul className="mt-3 grid gap-3" data-testid="updates">
              {updates.map((u, i) => (
                <li key={u.id} className="card overflow-hidden">
                  {(u.kind === "photo" || u.kind === "sketch") && media[i] && (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs from storage
                    <img src={media[i]!} alt={u.caption || "Photo of your cake in progress"} className="max-h-[480px] w-full object-cover" />
                  )}
                  {u.kind === "video" && media[i] && (
                    <video src={media[i]!} controls playsInline preload="metadata" className="max-h-[480px] w-full bg-black" />
                  )}
                  <div className="p-4 text-sm">
                    {u.kind === "stage" && <p className="text-xs font-semibold uppercase tracking-wide text-rose">Update</p>}
                    {u.kind === "sketch" && <p className="text-xs font-semibold uppercase tracking-wide text-rose">Design sketch</p>}
                    {u.kind === "change_request" && <p className="text-xs font-semibold uppercase tracking-wide text-rose">You asked for a change</p>}
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

        {(referral || stamps) && (
          <section className="card mt-6 grid gap-4 p-5 text-sm sm:grid-cols-2">
            {referral && (
              <div data-testid="referral">
                <h2 className="font-serif text-xl">Give {formatAud(settings.referralGiveCents)}, get {formatAud(settings.referralGetCents)}</h2>
                <p className="mt-1 text-muted">Share your code. Friends get {formatAud(settings.referralGiveCents)} off their first cake, and you get {formatAud(settings.referralGetCents)} credit when they order.</p>
                <p className="mt-2 inline-block rounded-lg border-2 border-dashed border-gold px-3 py-1 font-mono text-lg font-bold" data-testid="referral-code">{referral}</p>
              </div>
            )}
            {stamps && (
              <div data-testid="stamp-card">
                <h2 className="font-serif text-xl">Stamp card</h2>
                <p className="mt-1 text-muted">Every {stamps.every}th cake earns {settings.stampRewardName}, free.</p>
                <div className="mt-2 flex gap-1" aria-label={`${stamps.stamps} of ${stamps.every} stamps`}>
                  {Array.from({ length: stamps.every }).map((_, i) => (
                    <span key={i} className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${i < stamps.stamps ? "border-rose bg-rose text-white" : "border-line"}`}>
                      {i < stamps.stamps ? "★" : ""}
                    </span>
                  ))}
                </div>
                {stamps.rewardsAvailable > 0 && <p className="mt-2 font-semibold text-rose" data-testid="reward-ready">A reward is ready: it&apos;s added to your next order automatically.</p>}
              </div>
            )}
          </section>
        )}

        <section className="card mt-6 p-5 text-sm">
          <h2 className="font-serif text-xl">Messages you&apos;ll receive</h2>
          <ol className="mt-3 divide-y divide-line" data-testid="timeline">
            {timeline.map((t) => (
              <li key={t.key} className="flex flex-wrap justify-between gap-2 py-2" data-testid={`msg-${t.key}`} data-status={t.status}>
                <span>{t.label}</span>
                <span className={t.status === "sent" ? "font-semibold text-rose" : "text-muted"}>
                  {STATUS_TEXT[t.status]}
                  {t.date && t.status !== "off" && t.status !== "not_needed" ? `, ${formatDateLong(t.date)}` : ""}
                </span>
              </li>
            ))}
          </ol>
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
