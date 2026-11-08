"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { compressImage } from "@/lib/client/image";
import { deleteClassPhotoAction, emailGalleryAction, uploadClassPhotoAction } from "../../actions";

export function Gallery({ sessionId, photos, viewUrl }: { sessionId: string; photos: { id: string; url: string | null; caption: string }[]; viewUrl: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section className="no-print card p-5" data-testid="admin-gallery">
      <h2 className="font-serif text-xl">Photo gallery</h2>
      <p className="text-sm text-muted">Photos are private. Guests see them through a link only they get by email.</p>
      <form
        className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          const file = fileRef.current?.files?.[0];
          if (!file) return setMsg({ ok: false, text: "Choose a photo." });
          start(async () => {
            const form = new FormData();
            form.set("sessionId", sessionId);
            form.set("caption", caption);
            try {
              form.set("photo", await compressImage(file), file.name);
            } catch (err) {
              return setMsg({ ok: false, text: err instanceof Error ? err.message : "That photo could not be used." });
            }
            const r = await uploadClassPhotoAction(form);
            setMsg(r.ok ? { ok: true, text: "Photo added." } : { ok: false, text: r.error });
            if (r.ok) {
              setCaption("");
              if (fileRef.current) fileRef.current.value = "";
            }
            router.refresh();
          });
        }}
      >
        <input ref={fileRef} type="file" accept="image/*" className="text-sm" aria-label="Class photo" data-testid="gallery-file" />
        <input className="field" placeholder="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} aria-label="Caption" />
        <button className="btn btn-primary" disabled={pending} data-testid="gallery-upload">
          Upload
        </button>
      </form>
      {photos.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="gallery-photos">
          {photos.map((p) => (
            <li key={p.id} className="rounded-xl border border-line p-2 text-xs">
              {p.url && (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img src={p.url} alt={p.caption || "Class photo"} className="aspect-square w-full rounded-lg object-cover" />
              )}
              <p className="mt-1 truncate">{p.caption}</p>
              <button
                type="button"
                className="text-rose underline"
                data-testid="gallery-delete"
                onClick={() => {
                  if (!confirm("Delete this photo?")) return;
                  start(async () => {
                    const r = await deleteClassPhotoAction(p.id);
                    setMsg(r.ok ? { ok: true, text: "Photo deleted." } : { ok: false, text: r.error });
                    router.refresh();
                  });
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pending || photos.length === 0}
          data-testid="gallery-email"
          onClick={() =>
            start(async () => {
              const r = await emailGalleryAction(sessionId);
              setMsg(r.ok ? { ok: true, text: `Gallery link emailed to ${r.data?.sent ?? 0} booking${r.data?.sent === 1 ? "" : "s"}.` } : { ok: false, text: r.error });
            })
          }
        >
          Email the gallery link to guests
        </button>
        <a href={viewUrl} className="text-sm underline" target="_blank" rel="noopener noreferrer" data-testid="gallery-view">
          View as a guest
        </a>
      </div>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "" : "text-rose-dark"}`} data-testid="gallery-msg">
          {msg.text}
        </p>
      )}
    </section>
  );
}
