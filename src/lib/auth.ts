import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase-auth";
import { TEST_ADMIN_COOKIE, testAuthBypassEnabled } from "./test-mode";

export interface Admin {
  email: string;
}

function allowedEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function mfaRequired(): boolean {
  return process.env.ADMIN_REQUIRE_MFA !== "false";
}

/**
 * Every admin page and action calls this first. It checks the Supabase
 * session, that the email is on the ADMIN_EMAILS list, and that the session
 * passed two-factor (AAL2). Anything else is sent to the login page.
 */
export async function requireAdmin(): Promise<Admin> {
  if (testAuthBypassEnabled()) {
    const jar = await cookies();
    if (jar.get(TEST_ADMIN_COOKIE)?.value === "1") return { email: "test-admin@localhost" };
    redirect("/admin/login");
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) redirect("/admin/login");
  if (!allowedEmails().includes(user.email.toLowerCase())) {
    await supabase.auth.signOut();
    redirect("/admin/login?error=not-allowed");
  }
  if (mfaRequired()) {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel !== "aal2") redirect("/admin/mfa");
  }
  return { email: user.email };
}
