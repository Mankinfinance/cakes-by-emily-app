import type { Metadata } from "next";
import { MfaForm } from "./MfaForm";

export const metadata: Metadata = { title: "Two-factor sign in", robots: { index: false } };

export default function MfaPage() {
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-16">
      <h1 className="font-serif text-3xl">Two-factor sign in</h1>
      <p className="mt-2 text-sm text-muted">
        For your customers&apos; safety, the admin needs a 6 digit code from an authenticator app (such as Google Authenticator, Microsoft
        Authenticator or 1Password) as well as your password.
      </p>
      <MfaForm />
    </main>
  );
}
