import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { BUSINESS } from "@/lib/config";
import { getRepo } from "@/lib/data";
import { sessionLabel } from "@/lib/domain/classes";
import { sessionForGallery } from "@/lib/services/gallery";
import { GalleryViewer } from "./GalleryViewer";

export const metadata: Metadata = { title: "Class photos", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function GalleryPage({ params }: PageProps<"/gallery/[sessionId]/[token]">) {
  await connection();
  const { sessionId, token } = await params;
  const repo = await getRepo();
  const session = await sessionForGallery({ repo }, sessionId, token);
  if (!session) notFound();
  const type = (await repo.listClassTypes()).find((t) => t.id === session.classTypeId);
  const photos = await repo.listClassPhotos(session.id);
  const urls = await Promise.all(photos.map((p) => repo.mediaUrl(p.path)));
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <h1 className="font-serif text-3xl">{type?.name ?? "Class"} photos</h1>
        <p className="mt-1 text-muted">
          {sessionLabel(session)}. Download your favourites and tag @{BUSINESS.instagram} when you share them.
        </p>
        {photos.length === 0 ? (
          <p className="mt-8 text-muted">No photos yet. Check back soon!</p>
        ) : (
          <GalleryViewer
            tag={`@${BUSINESS.instagram}`}
            photos={photos.flatMap((p, i) => (urls[i] ? [{ id: p.id, url: urls[i]!, caption: p.caption, name: `cakes-by-emily-${i + 1}.${p.path.split(".").pop()}` }] : []))}
          />
        )}
      </main>
      <SiteFooter />
    </>
  );
}
