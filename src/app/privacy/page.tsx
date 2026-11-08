import type { Metadata } from "next";
import { connection } from "next/server";
import { LegalPage } from "@/components/LegalPage";
import { BUSINESS } from "@/lib/config";
import { getRepo } from "@/lib/data";
import { privacyDocument } from "@/lib/domain/legal";

export const metadata: Metadata = { title: "Privacy policy" };

export default async function Privacy() {
  await connection();
  const s = await (await getRepo()).getSettings();
  return <LegalPage doc={privacyDocument({ businessName: BUSINESS.business, siteName: BUSINESS.name })} banner={s.legalDraftBanner} />;
}
