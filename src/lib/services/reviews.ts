// Reviews: an on-site form linked from the thank-you email, one per order,
// moderated by Emily before anything is published.

import { randomUUID } from "node:crypto";
import type { Order, Review } from "../domain/types";
import { checkUpload, IMAGE_TYPES, MAX_PHOTO_BYTES } from "../validation";
import { OrderError, type LightDeps } from "./common";
import { hashToken, linkToken, looksLikeToken, safeEqual } from "./tokens";

/** "Sam Taylor" becomes "Sam T." so full names are never published. */
export function displayNameFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "A customer";
  const last = parts.length > 1 ? ` ${parts[parts.length - 1][0].toUpperCase()}.` : "";
  return `${first}${last}`.slice(0, 40);
}

/** The order a review link belongs to, or null. The token is checked against the order id. */
export async function orderForReview(deps: Pick<LightDeps, "repo">, orderId: string, token: string): Promise<Order | null> {
  if (!looksLikeToken(token) || !/^[0-9a-f-]{36}$/.test(orderId)) return null;
  if (!safeEqual(hashToken(linkToken("review", orderId)), hashToken(token))) return null;
  return deps.repo.getOrderById(orderId);
}

export interface ReviewInput {
  rating: number;
  text: string;
  consentToPublish: boolean;
}

export async function submitReview(deps: LightDeps, order: Order, input: ReviewInput, photo: { bytes: Uint8Array; contentType: string } | null): Promise<Review> {
  if (order.stage !== "collected") throw new OrderError("Reviews open once your cake has been collected.");
  if (await deps.repo.getReviewByOrder(order.id)) throw new OrderError("Thank you, you've already left a review for this order.", 409);
  let photoPath: string | null = null;
  if (photo) {
    const check = checkUpload(photo.bytes, photo.contentType, IMAGE_TYPES, MAX_PHOTO_BYTES);
    if (!check.ok) throw new OrderError(check.reason);
    photoPath = `reviews/${order.id}/photo-${randomUUID()}.${check.ext}`;
    await deps.repo.uploadMedia(photoPath, photo);
  }
  const review = await deps.repo.createReview({
    orderId: order.id,
    rating: input.rating,
    text: input.text.trim().slice(0, 1500),
    photoPath,
    consentToPublish: input.consentToPublish,
    displayName: displayNameFor(order.customerName),
  });
  if (!review) throw new OrderError("Thank you, you've already left a review for this order.", 409);
  return review;
}
