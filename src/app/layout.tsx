import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, DM_Sans, Great_Vibes } from "next/font/google";
import { BUSINESS, siteUrl } from "@/lib/config";
import "./globals.css";

const bodoni = Bodoni_Moda({ variable: "--font-bodoni", subsets: ["latin"], display: "swap" });
const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"], display: "swap" });
const greatVibes = Great_Vibes({ variable: "--font-great-vibes", subsets: ["latin"], weight: "400", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${BUSINESS.name} | Custom celebration cakes in ${BUSINESS.suburb}`, template: `%s | ${BUSINESS.name}` },
  description: `Design and book a custom celebration cake from ${BUSINESS.name} in ${BUSINESS.suburb}. Live pricing, pickup times and secure deposits.`,
};

export const viewport: Viewport = {
  themeColor: "#2E2027",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className={`${bodoni.variable} ${dmSans.variable} ${greatVibes.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
