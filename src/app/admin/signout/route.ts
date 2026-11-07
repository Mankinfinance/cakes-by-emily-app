import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-auth";
import { TEST_ADMIN_COOKIE, testAuthBypassEnabled } from "@/lib/test-mode";

export async function POST(request: Request) {
  const res = NextResponse.redirect(new URL("/admin/login", request.url), 303);
  if (testAuthBypassEnabled()) {
    res.cookies.delete(TEST_ADMIN_COOKIE);
    return res;
  }
  try {
    await (await supabaseServer()).auth.signOut();
  } catch {
    // Not configured: nothing to sign out of.
  }
  return res;
}
