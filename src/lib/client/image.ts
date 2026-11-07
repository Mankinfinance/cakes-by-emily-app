"use client";

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Resize a photo in the browser so uploads are quick and stay under the
 * server's 4 MB limit. Falls back to the original if the browser cannot
 * decode it (for example HEIC in some browsers) and it is already small enough.
 */
export async function compressImage(file: File, maxDim = 2000, quality = 0.85): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_BYTES) return blob;
  } catch {
    // fall through
  }
  if (file.size <= MAX_BYTES) return file;
  throw new Error("That photo is too large. Please choose one under 4 MB.");
}
