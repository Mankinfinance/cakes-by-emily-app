import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

// End-to-end tests run the real production build on the in-memory adapter
// with the test checkout. No Supabase, Stripe or email accounts are touched.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      DATA_ADAPTER: "memory",
      E2E_AUTH_BYPASS: "1",
      NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
      CRON_SECRET: "e2e-cron-secret-0123456789",
      ADMIN_NOTIFY_EMAIL: "emily@example.com",
      STRIPE_SECRET_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      RESEND_API_KEY: "",
    },
  },
});
