import type { Metadata } from "next";
import { connection } from "next/server";
import { LegalPage } from "@/components/LegalPage";
import { getRepo } from "@/lib/data";
import { termsDocument } from "@/lib/domain/legal";
import { legalContext } from "@/lib/legal-context";

export const metadata: Metadata = { title: "Terms of sale" };

export default async function Terms() {
  await connection();
  const repo = await getRepo();
  const s = await repo.getSettings();
  const doc = termsDocument(s, await legalContext(repo, s));
  return <LegalPage doc={doc} banner={s.legalDraftBanner} extra={s.cancellationPolicy?.trim() || undefined} />;
}
