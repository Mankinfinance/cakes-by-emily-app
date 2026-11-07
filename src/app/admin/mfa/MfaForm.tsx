"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/client/supabase-browser";

type Mode = { kind: "loading" } | { kind: "enrol"; factorId: string; qr: string; secret: string } | { kind: "verify"; factorId: string };

export function MfaForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = supabaseBrowser();
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/admin/login");
        return;
      }
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp?.find((f) => f.status === "verified");
      if (verified) {
        setMode({ kind: "verify", factorId: verified.id });
        return;
      }
      // Remove any half-finished enrolment, then start a fresh one.
      for (const f of data?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: enrol, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
      if (error || !enrol) {
        setError("Could not start two-factor setup. Please refresh and try again.");
        return;
      }
      setMode({ kind: "enrol", factorId: enrol.id, qr: enrol.totp.qr_code, secret: enrol.totp.secret });
    })();
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode.kind === "loading") return;
    setError(null);
    const { error } = await supabaseBrowser().auth.mfa.challengeAndVerify({ factorId: mode.factorId, code: code.trim() });
    if (error) {
      setError("That code didn't work. Check your app and try again.");
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  if (mode.kind === "loading") return <p className="mt-6 text-sm text-muted">{error ?? "Loading..."}</p>;

  return (
    <form onSubmit={submit} className="mt-6 grid gap-4">
      {mode.kind === "enrol" && (
        <div className="card p-4 text-sm">
          <p className="font-semibold">Set up your authenticator app (one time only)</p>
          <p className="mt-1 text-muted">Scan this code with your app, then enter the 6 digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase returns the QR code as an SVG data URL */}
          <img src={mode.qr} alt="QR code for your authenticator app" className="mx-auto my-3 h-48 w-48" />
          <p className="break-all text-xs text-muted">Or enter this key: {mode.secret}</p>
        </div>
      )}
      <div>
        <label className="label" htmlFor="code">
          6 digit code
        </label>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          className="field tracking-[0.4em]"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          required
        />
      </div>
      {error && (
        <p className="text-sm text-rose-dark" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary">Continue</button>
    </form>
  );
}
