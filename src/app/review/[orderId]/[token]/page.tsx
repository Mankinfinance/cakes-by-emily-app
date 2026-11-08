import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getRepo } from "@/lib/data";
import { orderForReview } from "@/lib/services/reviews";
import { ReviewForm } from "./ReviewForm";

export const metadata: Metadata = { title: "Leave a review", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ReviewPage({ params }: PageProps<"/review/[orderId]/[token]">) {
  await connection();
  const { orderId, token } = await params;
  const repo = await getRepo();
  const order = await orderForReview({ repo }, orderId, token);
  if (!order) notFound();
  const [existing, settings] = await Promise.all([repo.getReviewByOrder(order.id), repo.getSettings()]);
  const google = settings.reviewUrl || process.env.REVIEW_URL || "";
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <h1 className="font-serif text-3xl">How was your cake?</h1>
        {existing ? (
          <p className="mt-4 rounded-xl bg-blush px-4 py-3" data-testid="review-done">Thank you, you&apos;ve already left a review for this order.</p>
        ) : order.stage !== "collected" ? (
          <p className="mt-4 text-muted">Reviews open once your cake has been collected.</p>
        ) : (
          <ReviewForm orderId={order.id} token={token} />
        )}
        {google && (
          <p className="mt-6 text-sm">
            You can also{" "}
            <a href={google} className="underline" target="_blank" rel="noopener noreferrer">
              leave a Google review
            </a>
            .
          </p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
