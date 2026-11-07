"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { compressImage } from "@/lib/client/image";
import { supabaseBrowser } from "@/lib/client/supabase-browser";
import { finishVideoUploadAction, postPhotoUpdateAction, startVideoUploadAction } from "../../actions";

export function PostUpdate({ orderId }: { orderId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (file && file.type.startsWith("video/")) {
        if (file.size > 50 * 1024 * 1024) throw new Error("Videos must be under 50 MB. Try trimming it on your phone first.");
        setStatus("Uploading video...");
        const start = await startVideoUploadAction(orderId, file.type, file.size);
        if (!start.ok || !start.data) throw new Error(start.ok ? "Could not start the upload." : start.error);
        const { path, target } = start.data;
        if (target.kind === "supabase") {
          const { error } = await supabaseBrowser().storage.from(target.bucket).uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
          if (error) throw new Error("The video upload failed. Please try again.");
        } else {
          const res = await fetch(target.url, { method: "PUT", body: file });
          if (!res.ok) throw new Error("The video upload failed. Please try again.");
        }
        const done = await finishVideoUploadAction(orderId, path, caption);
        if (!done.ok) throw new Error(done.error);
      } else {
        setStatus(file ? "Uploading photo..." : "Posting...");
        const form = new FormData();
        form.set("orderId", orderId);
        form.set("caption", caption);
        if (file) form.set("photo", await compressImage(file), "photo.jpg");
        const r = await postPhotoUpdateAction(form);
        if (!r.ok) throw new Error(r.error);
      }
      setCaption("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setStatus("Posted. The customer has been emailed.");
      router.refresh();
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/mp4,video/quicktime,video/webm"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm"
        data-testid="update-file"
      />
      <input
        className="field"
        placeholder="Caption, e.g. Layers are baked!"
        maxLength={300}
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        data-testid="update-caption"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={busy || (!file && !caption.trim())} data-testid="post-update">
          {busy ? "Posting..." : "Post update"}
        </button>
        {status && (
          <span className="text-sm text-muted" role="status">
            {status}
          </span>
        )}
        {error && (
          <span className="text-sm text-rose-dark" role="alert">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
