// Business details in one place. Change the name here if Emily picks a
// different brand (for example "Layered").

export const BUSINESS = {
  name: "Cakes by Emily",
  shortName: "Cakes by Emily",
  instagram: "_cakes_by_emily_",
  suburb: "Grasmere",
  tagline: "Custom celebration cakes, made in Grasmere",
  /** Shown in pickup emails only. Emily sets the real text in PICKUP_DETAILS. */
  pickupDetailsPlaceholder: "[Emily to add pickup address and parking note]",
} as const;

export function siteUrl(fallbackOrigin?: string): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (fallbackOrigin) return fallbackOrigin.replace(/\/$/, "");
  return "http://localhost:3000";
}
