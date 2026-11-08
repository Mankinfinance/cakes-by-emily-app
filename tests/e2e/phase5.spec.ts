import { expect, test, type Page } from "@playwright/test";

// Phase 5: guests changing their details, a gift voucher on a guest's own
// share, cancelling some seats of a class booking, and the setup page.
// Memory adapter, test checkout, real clock.

const CODE = /[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/;

function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function openDay(from: string): string {
  let d = from;
  while (new Date(`${d}T00:00:00Z`).getUTCDay() === 1 || d === "2026-12-24" || d === "2026-12-25") d = addDays(d, 1);
  return d;
}
function longDate(date: string): string {
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

const TODAY = sydneyToday();
const CLASS_DATE = openDay(addDays(TODAY, 44));
const PRIVATE_DATE = openDay(addDays(TODAY, 90));

let guestUrl = "";
let ticketUrl = "";

async function adminLogin(page: Page) {
  await page.request.post("/api/test-login");
}
async function emailsTo(page: Page, to: string): Promise<{ subject: string; text: string }[]> {
  return (await page.request.get(`/api/test-outbox?to=${encodeURIComponent(to)}`)).json();
}
async function payAtTestCheckout(page: Page) {
  await expect(page).toHaveURL(/\/checkout\/test/);
  await page.getByTestId("test-pay").click();
}
async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe.serial("phase 5", () => {
  test("a guest changes their details, Emily hears about the allergy, and a voucher pays part of their share", async ({ page }) => {
    // A private class with a paid deposit.
    await page.goto("/classes/private");
    await page.getByTestId("private-deluxe").click();
    await page.getByTestId("private-guests").fill("6");
    await page.getByTestId("private-date").fill(PRIVATE_DATE);
    await page.getByTestId("private-name").fill("Lia Five");
    await page.getByTestId("private-email").fill("lia.five@example.com");
    await page.getByTestId("private-phone").fill("0400 555 888");
    await page.getByTestId("private-submit").click();
    await expect(page.getByTestId("private-sent")).toBeVisible();
    await adminLogin(page);
    await page.goto("/admin/classes/private");
    await page.locator("li", { hasText: "Lia Five" }).first().getByTestId("private-accept").click();
    const accepted = (await emailsTo(page, "lia.five@example.com")).find((m) => m.subject.includes("pay the $150 deposit"))!;
    await page.goto(/http:\/\/localhost:\d+(\/p\/[A-Za-z0-9_-]{43})/.exec(accepted.text)![1]);
    await page.getByTestId("private-pay").click();
    await payAtTestCheckout(page);
    const share = (await page.getByTestId("share-link").textContent())!.trim();

    // A $50 gift voucher to use later.
    await page.goto("/vouchers");
    await page.getByTestId("amount-5000").click();
    await page.getByTestId("buyer-name").fill("Mo Gift");
    await page.getByTestId("buyer-email").fill("mo.gift@example.com");
    await page.getByTestId("recipient-name").fill("Mo");
    await page.getByTestId("voucher-terms").check();
    await page.getByTestId("buy-voucher").click();
    await payAtTestCheckout(page);
    const code = CODE.exec((await emailsTo(page, "mo.gift@example.com")).at(-1)!.text)![0];

    // The guest saves their details, then changes them.
    await page.goto(new URL(share).pathname);
    await page.getByTestId("guest-name").fill("Mo Guest");
    await page.getByTestId("guest-email").fill("mo.guest@example.com");
    await page.getByTestId("guest-allergies").fill("Peanuts");
    await page.getByTestId("guest-save").click();
    await expect(page.getByTestId("pay-share")).toHaveText("Pay my share $95");
    guestUrl = new URL(page.url()).pathname;

    await page.getByTestId("guest-edit-open").click();
    await expect(page.getByTestId("edit-allergies")).toHaveValue("Peanuts");
    await page.getByTestId("edit-allergies").fill("Peanuts and sesame");
    await page.getByRole("button", { name: "Dairy-free" }).click();
    await page.getByTestId("edit-save").click();
    await expect(page.getByTestId("guest-edit-result")).toHaveText("Saved. Emily has been told about the allergy change.");
    const alert = (await emailsTo(page, "emily@example.com")).find((m) => m.subject.startsWith("Allergy change: Mo Guest"))!;
    expect(alert.text).toContain("Before: Peanuts");
    expect(alert.text).toContain("Now: Peanuts and sesame; dairy-free");

    // The voucher takes $50 off; the checkout is for the $45 left.
    await page.getByTestId("share-code-input").fill("not-a-code-at-all");
    await page.getByTestId("share-code-apply").click();
    await expect(page.getByTestId("share-code-error")).toContainText("wasn't recognised");
    await page.getByTestId("share-code-input").fill(code.toLowerCase());
    await page.getByTestId("share-code-apply").click();
    await expect(page.getByTestId("share-code-applied")).toContainText("Voucher or credit applied: $50");
    await expect(page.getByTestId("share-owed")).toHaveText("$45");
    await expect(page.getByTestId("share-code")).toHaveCount(0); // one code per share
    await page.getByTestId("pay-share").click();
    await payAtTestCheckout(page);
    await expect(page.getByTestId("share-paid")).toContainText("Your share of $95 is paid ($50 by voucher or credit)");
  });

  test("a customer cancels one seat, sees the new price first, and the group discount drops away", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/classes");
    await page.getByTestId("series-type").selectOption("class-florals");
    await page.getByTestId("series-date").fill(CLASS_DATE);
    await page.getByTestId("series-count").fill("1");
    await page.getByTestId("series-create").click();
    await expect(page.getByTestId("series-msg")).toHaveText("Added 1 class.");

    await page.goto("/classes");
    const row = page.locator('[data-testid^="session-"]', { hasText: longDate(CLASS_DATE) }).first();
    await row.getByTestId("book-session").click();
    await page.getByTestId("class-seats").selectOption("4");
    for (const [i, name] of ["Ari", "Ben", "Cat", "Dev"].entries()) await page.getByTestId(`guest-name-${i}`).fill(name);
    await page.getByTestId("class-contact").fill("Ari Seats");
    await page.getByTestId("class-email").fill("ari.seats@example.com");
    await page.getByTestId("class-phone").fill("0400 707 808");
    await page.getByTestId("class-adult").check();
    await page.getByTestId("class-terms").check();
    await page.getByTestId("class-pay").click();
    await payAtTestCheckout(page);
    await expect(page.getByTestId("ticket-status")).toHaveText("Booked");
    await expect(page.getByTestId("ticket")).toContainText("Paid $342");
    ticketUrl = new URL(page.url()).pathname;

    await page.getByTestId("seats-cancel-open").click();
    await page.getByTestId("seat-3").check();
    await expect(page.getByTestId("seats-quote")).toContainText("leaves 3 seats at $285");
    await expect(page.getByTestId("seats-quote")).toContainText("group discount no longer applies");
    await expect(page.getByTestId("seats-quote")).toContainText("$57 refunded");
    // Every seat: the whole booking has its own button.
    for (const i of [0, 1, 2]) await page.getByTestId(`seat-${i}`).check();
    await expect(page.getByTestId("seats-quote")).toContainText("cancel the whole booking instead");
    await expect(page.getByTestId("seats-cancel-confirm")).toBeDisabled();
    for (const i of [0, 1, 2]) await page.getByTestId(`seat-${i}`).uncheck();
    await page.getByTestId("seats-cancel-confirm").click();

    await expect(page.getByTestId("ticket-guests").locator("li")).toHaveCount(3);
    await expect(page.getByTestId("ticket-guests")).not.toContainText("Dev");
    await expect(page.getByTestId("ticket")).toContainText("Paid $285");
    await expect(page.getByTestId("partial-history")).toContainText("Cancelling 1 seat (Dev)");
    expect((await emailsTo(page, "ari.seats@example.com")).some((m) => m.subject.startsWith("Seats cancelled"))).toBe(true);
    expect((await emailsTo(page, "emily@example.com")).some((m) => m.subject.includes("(refund $57 in Stripe)"))).toBe(true);
  });

  test("the setup page shows test mode, every check, and sends a test email", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/setup");
    await expect(page.getByTestId("setup-test-mode")).toBeVisible();
    await expect(page.getByTestId("check-db")).toHaveAttribute("data-status", "warn");
    await expect(page.getByTestId("check-env:STRIPE_SECRET_KEY")).toHaveAttribute("data-status", "fail");
    await expect(page.getByTestId("check-env:CRON_SECRET")).toHaveAttribute("data-status", "ok");
    await expect(page.getByTestId("check-mfa")).toHaveAttribute("data-status", "ok");
    // Values are never shown, only whether they're set.
    await expect(page.locator("main")).not.toContainText("e2e-cron-secret");
    await page.getByTestId("send-test-email").click();
    await expect(page.getByTestId("test-email-result")).toHaveText("Sent to emily@example.com. Check that inbox (and spam).");
    expect((await emailsTo(page, "emily@example.com")).some((m) => m.subject.startsWith("Test email from"))).toBe(true);

    // Customers can't open it.
    await page.context().clearCookies();
    await page.goto("/admin/setup");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

test.describe("phase 5 at phone width (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("no sideways scrolling on the new screens", async ({ page }) => {
    for (const path of [guestUrl, ticketUrl].filter(Boolean)) {
      await page.goto(path);
      await noSideScroll(page);
    }
    if (ticketUrl) {
      await page.goto(ticketUrl);
      await page.getByTestId("seats-cancel-open").click();
      await page.getByTestId("seat-0").check();
      await expect(page.getByTestId("seats-quote")).toBeVisible();
      await noSideScroll(page);
    }
    await page.request.post("/api/test-login");
    await page.goto("/admin/setup");
    await noSideScroll(page);
  });
});
