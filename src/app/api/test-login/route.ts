import { NextResponse } from "next/server";
import { TEST_ADMIN_COOKIE, testAuthBypassEnabled } from "@/lib/test-mode";

// Test sign-in for Playwright. Only exists on the memory adapter with E2E_AUTH_BYPASS=1.
export async function POST(request: Request) {
  if (!testAuthBypassEnabled()) return new Response("Not found", { status: 404 });
  const res = NextResponse.redirect(new URL("/admin", request.url), 303);
  res.cookies.set(TEST_ADMIN_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
