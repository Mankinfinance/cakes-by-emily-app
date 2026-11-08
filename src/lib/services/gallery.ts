// Class photo galleries: Emily uploads photos per class; guests get a private
// link (an HMAC of the class id). Photos are served by short-lived signed URLs.

import { randomUUID } from "node:crypto";
import type { ClassSession } from "../domain/types";
import { checkUpload, IMAGE_TYPES, MAX_PHOTO_BYTES } from "../validation";
import { galleryLink, OrderError, type LightDeps } from "./common";
import { galleryEmail, sendSafely } from "./email";
import { hashToken, linkToken, looksLikeToken, safeEqual } from "./tokens";

export async function uploadClassPhoto(deps: LightDeps, sessionId: string, file: { bytes: Uint8Array; contentType: string }, caption: string) {
  const session = await deps.repo.getSession(sessionId);
  if (!session) throw new OrderError("Class not found.", 404);
  const check = checkUpload(file.bytes, file.contentType, IMAGE_TYPES, MAX_PHOTO_BYTES);
  if (!check.ok) throw new OrderError(check.reason);
  const id = randomUUID();
  const path = `classes/${session.id}/photo-${randomUUID()}.${check.ext}`;
  await deps.repo.uploadMedia(path, file);
  return deps.repo.addClassPhoto({ id, sessionId: session.id, path, caption: caption.trim().slice(0, 200) });
}

export async function removeClassPhoto(deps: LightDeps, photoId: string): Promise<void> {
  const photo = await deps.repo.getClassPhoto(photoId);
  if (!photo) throw new OrderError("Photo not found.", 404);
  await deps.repo.deleteMedia(photo.path);
  await deps.repo.deleteClassPhoto(photo.id);
}

/** The class a gallery link belongs to, or null. */
export async function sessionForGallery(deps: Pick<LightDeps, "repo">, sessionId: string, token: string): Promise<ClassSession | null> {
  if (!/^[0-9a-f-]{36}$/.test(sessionId) || !looksLikeToken(token)) return null;
  if (!safeEqual(hashToken(linkToken("gallery", sessionId)), hashToken(token))) return null;
  return deps.repo.getSession(sessionId);
}

/** Email the gallery link to everyone booked into the class, once per booking. */
export async function emailGallery(deps: LightDeps, sessionId: string): Promise<number> {
  const session = await deps.repo.getSession(sessionId);
  const type = session && (await deps.repo.listClassTypes()).find((t) => t.id === session.classTypeId);
  if (!session || !type) throw new OrderError("Class not found.", 404);
  if ((await deps.repo.listClassPhotos(session.id)).length === 0) throw new OrderError("Upload some photos first.");
  const link = galleryLink(deps.baseUrl, session.id);
  let sent = 0;
  for (const b of await deps.repo.listBookings({ sessionId: session.id })) {
    if (b.status !== "paid") continue;
    if (!(await deps.repo.claimBookingMessage(b.id, "gallery"))) continue;
    if (await sendSafely(deps.mailer, galleryEmail(b.email, b.contactName, type.name, session.date, link))) sent++;
    else await deps.repo.releaseBookingMessage(b.id, "gallery");
  }
  return sent;
}
