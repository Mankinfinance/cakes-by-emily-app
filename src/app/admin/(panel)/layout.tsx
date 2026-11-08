import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { BUSINESS } from "@/lib/config";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await connection();
  const admin = await requireAdmin();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link href="/admin" className="font-serif text-lg">
            {BUSINESS.name} <span className="text-sm text-muted">admin</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            <Link className="rounded-full px-3 py-1.5 hover:bg-blush" href="/admin">
              Orders
            </Link>
            <Link className="rounded-full px-3 py-1.5 hover:bg-blush" href="/admin/kitchen">
              Kitchen
            </Link>
            <Link className="rounded-full px-3 py-1.5 hover:bg-blush" href="/admin/waitlist">
              Waitlist
            </Link>
            <Link className="rounded-full px-3 py-1.5 hover:bg-blush" href="/admin/boxes">
              Boxes
            </Link>
            <Link className="rounded-full px-3 py-1.5 hover:bg-blush" href="/admin/vouchers">
              Vouchers
            </Link>
            <Link className="rounded-full px-3 py-1.5 hover:bg-blush" href="/admin/automations">
              Messages
            </Link>
            <Link className="rounded-full px-3 py-1.5 hover:bg-blush" href="/admin/catalogue">
              Prices and menu
            </Link>
            <Link className="rounded-full px-3 py-1.5 hover:bg-blush" href="/admin/settings">
              Settings
            </Link>
            <form action="/admin/signout" method="post">
              <button className="rounded-full px-3 py-1.5 text-muted hover:bg-blush" title={admin.email}>
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
