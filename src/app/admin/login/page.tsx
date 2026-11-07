import type { Metadata } from "next";
import { connection } from "next/server";
import { BUSINESS } from "@/lib/config";
import { testAuthBypassEnabled } from "@/lib/test-mode";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false } };

export default async function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  await connection();
  const { error } = await searchParams;
  const testMode = testAuthBypassEnabled();
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-16">
      <h1 className="font-serif text-3xl">{BUSINESS.name}</h1>
      <p className="mt-1 text-muted">Emily&apos;s admin</p>
      {error === "not-allowed" && (
        <p className="mt-4 rounded-xl bg-blush px-4 py-3 text-sm" role="alert">
          That account does not have admin access.
        </p>
      )}
      {testMode ? (
        <form action="/api/test-login" method="post" className="mt-6">
          <p className="mb-3 text-sm text-muted">Test mode: no real accounts or data.</p>
          <button className="btn btn-primary w-full" data-testid="test-login">
            Sign in (test mode)
          </button>
        </form>
      ) : (
        <LoginForm />
      )}
    </main>
  );
}
