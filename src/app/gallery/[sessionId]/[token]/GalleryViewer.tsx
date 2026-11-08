"use client";

import { useState } from "react";

interface Photo {
  id: string;
  url: string;
  caption: string;
  name: string;
}

/** Download a photo: share it on phones that support sharing files, otherwise save it. */
async function shareOrDownload(p: Photo, tag: string, share: boolean): Promise<string | null> {
  const blob = await (await fetch(p.url)).blob();
  const file = new File([blob], p.name, { type: blob.type || "image/jpeg" });
  const text = `${p.caption ? `${p.caption} ` : ""}${tag}`;
  if (share && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], text });
    return null;
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = p.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return share ? "Sharing isn't available on this device, so the photo was saved instead." : null;
}

export function GalleryViewer({ photos, tag }: { photos: Photo[]; tag: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const current = open === null ? null : photos[open];
  const act = (p: Photo, share: boolean) => {
    setNote(null);
    shareOrDownload(p, tag, share)
      .then(setNote)
      .catch((e) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setNote("Sorry, that didn't work. Try again, or press and hold the photo to save it.");
      });
  };
  return (
    <>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="gallery-grid">
        {photos.map((p, i) => (
          <li key={p.id}>
            <button type="button" className="block w-full overflow-hidden rounded-xl" onClick={() => setOpen(i)} aria-label={`Open photo ${i + 1}`} data-testid={`photo-${i}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
              <img src={p.url} alt={p.caption || `Class photo ${i + 1}`} className="aspect-square w-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      {current && (
        <div role="dialog" aria-modal="true" aria-label="Photo viewer" className="fixed inset-0 z-50 flex flex-col bg-plum/95 p-4 text-white" data-testid="viewer">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">
              {open! + 1} of {photos.length}
            </p>
            <button type="button" className="btn btn-ghost !py-1.5 !text-plum" onClick={() => setOpen(null)} data-testid="viewer-close">
              Close
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center gap-2 py-3">
            <button type="button" className="px-2 text-3xl" aria-label="Previous photo" onClick={() => setOpen((open! - 1 + photos.length) % photos.length)}>
              &lsaquo;
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
            <img src={current.url} alt={current.caption || "Class photo"} className="max-h-full min-w-0 max-w-full rounded-lg object-contain" />
            <button type="button" className="px-2 text-3xl" aria-label="Next photo" onClick={() => setOpen((open! + 1) % photos.length)}>
              &rsaquo;
            </button>
          </div>
          <p className="text-center text-sm" data-testid="viewer-caption">
            {current.caption && `${current.caption} `}
            <span className="font-semibold">{tag}</span>
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-3">
            <button type="button" className="btn btn-primary" onClick={() => act(current, false)} data-testid="photo-download">
              Download
            </button>
            <button type="button" className="btn btn-ghost !text-plum" onClick={() => act(current, true)} data-testid="photo-share">
              Share
            </button>
          </div>
          {note && <p className="mt-2 text-center text-sm" role="status">{note}</p>}
        </div>
      )}
    </>
  );
}
