import { BUSINESS } from "./config";
import type { Repository } from "./data/repository";
import { privateDeposits, type LegalContext } from "./domain/legal";
import type { Settings } from "./domain/types";

/** Business details plus the class numbers the terms quote (from class types and package settings). */
export async function legalContext(repo: Repository, settings: Settings): Promise<LegalContext> {
  const types = (await repo.listClassTypes()).filter((t) => t.visible);
  const mins = types.map((t) => t.minGuests).filter((n) => n > 0);
  const deposits = privateDeposits(settings.privatePackages);
  return {
    businessName: BUSINESS.business,
    siteName: BUSINESS.name,
    suburb: BUSINESS.suburb,
    instagram: BUSINESS.instagram,
    classMinGuests: mins.length ? Math.min(...mins) : 4,
    privateDepositCents: deposits.adult,
    kidsDepositCents: deposits.kids,
  };
}
