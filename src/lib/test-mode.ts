// Switches for automated tests. They only work on the in-memory adapter,
// which never holds real data, and are refused on a Vercel production deploy.

export function testRoutesEnabled(): boolean {
  return process.env.DATA_ADAPTER === "memory" && process.env.VERCEL_ENV !== "production";
}

/** Lets Playwright sign in to /admin without Supabase. */
export function testAuthBypassEnabled(): boolean {
  return testRoutesEnabled() && process.env.E2E_AUTH_BYPASS === "1" && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export const TEST_ADMIN_COOKIE = "cbe_test_admin";
