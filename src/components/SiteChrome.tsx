import Link from "next/link";
import { BUSINESS } from "@/lib/config";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-paper/90 backdrop-blur sticky top-0 z-20">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-serif text-xl tracking-tight">
          {BUSINESS.name}
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/boxes" className="hidden lg:inline hover:text-rose">
            Seasonal boxes
          </Link>
          <Link href="/classes" className="hidden md:inline hover:text-rose">
            Classes
          </Link>
          <Link href="/vouchers" className="hidden lg:inline hover:text-rose">
            Gift vouchers
          </Link>
          <Link href="/order" className="btn btn-primary !py-2 !px-4 text-sm">
            Design your cake
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:justify-between">
        <p>
          {BUSINESS.name}, {BUSINESS.suburb} NSW.{" "}
          <a className="underline hover:text-rose" href={`https://instagram.com/${BUSINESS.instagram}`} rel="noopener noreferrer" target="_blank">
            @{BUSINESS.instagram}
          </a>
        </p>
        <nav className="flex flex-wrap gap-4">
          <Link href="/boxes" className="hover:text-rose">
            Seasonal boxes
          </Link>
          <Link href="/vouchers" className="hover:text-rose">
            Gift vouchers
          </Link>
          <Link href="/classes" className="hover:text-rose">
            Classes
          </Link>
          <Link href="/corporate" className="hover:text-rose">
            Corporate
          </Link>
          <Link href="/terms" className="hover:text-rose">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-rose">
            Privacy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
