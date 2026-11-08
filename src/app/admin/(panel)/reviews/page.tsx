import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { reviewStatusAction } from "../actions";
import { ActionButton } from "../ActionButton";

export default async function ReviewsAdmin() {
  await requireAdmin();
  const repo = await getRepo();
  const reviews = await repo.listReviews();
  const photos = await Promise.all(reviews.map((r) => (r.photoPath ? repo.mediaUrl(r.photoPath) : Promise.resolve(null))));
  return (
    <div>
      <h1 className="font-serif text-3xl">Reviews</h1>
      <p className="mt-1 text-sm text-muted">Nothing is shown on the website until you approve it, and only reviews where the customer agreed to publish can be approved.</p>
      {reviews.length === 0 && <p className="mt-8 text-muted">No reviews yet. They arrive after the thank-you email goes out.</p>}
      <ul className="mt-6 grid gap-3" data-testid="admin-reviews">
        {reviews.map((r, i) => (
          <li key={r.id} className="card flex flex-wrap gap-4 p-4 text-sm" data-testid={`review-${r.displayName}`}>
            {photos[i] && (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img src={photos[i]!} alt="Review photo" className="h-24 w-24 rounded-lg object-cover" />
            )}
            <div className="flex-1">
              <p className="text-gold">{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></p>
              <p className="mt-1">{r.text || <span className="text-muted">(no text)</span>}</p>
              <p className="mt-1 text-muted">
                {r.displayName} &middot; {r.consentToPublish ? "Agreed to publish" : "Private feedback only"}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="font-semibold capitalize" data-testid="review-status">{r.status}</span>
              {r.status !== "approved" && r.consentToPublish && <ActionButton action={reviewStatusAction.bind(null, r.id, "approved")} label="Approve" testId="review-approve" />}
              {r.status !== "hidden" && <ActionButton action={reviewStatusAction.bind(null, r.id, "hidden")} label="Hide" testId="review-hide" />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
