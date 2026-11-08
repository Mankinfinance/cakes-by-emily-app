import { expect, test, type Page } from "@playwright/test";

// After phase 5: draft terms and privacy written from the settings, the photo
// opt-out at checkout, and private classes lowering their guest numbers.
// Memory adapter, test checkout, real clock.

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
  while (new Date(`${d}T00:00:00Z`).getUTCDay() === 1 || d === "2026-12-24") d = addDays(d, 1);
  return d;
}

const TODAY = sydneyToday();
const CAKE_DATE = openDay(addDays(TODAY, 85));
const PRIVATE_DATE = openDay(addDays(TODAY, 90));
const CLASS_DATE = openDay(addDays(TODAY, 95));

/** Same format as the site's formatDateLong, to find a class row by its date. */
function longDate(date: string): string {
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

async function next(page: Page) {
  await page.getByTestId("next").click();
}
async function adminLogin(page: Page) {
  await page.request.post("/api/test-login");
}
async function emailsTo(page: Page, to: string): Promise<{ subject: string; text: string }[]> {
  return (await page.request.get(`/api/test-outbox?to=${encodeURIComponent(to)}`)).json();
}
async function showDay(page: Page, date: string) {
  for (let i = 0; i < 5; i++) {
    await expect(page.locator('[data-testid^="day-"]').first()).toBeVisible();
    if (await page.getByTestId(`day-${date}`).count()) return page.getByTestId(`day-${date}`);
    await page.getByTestId("next-month").click();
  }
  throw new Error(`Day ${date} not found`);
}
async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
async function setCancelFee(page: Page, dollars: string) {
  await page.goto("/admin/settings");
  await page.getByTestId("cancel-fee").fill(dollars);
  await page.getByTestId("save-settings").click();
  await expect(page.getByTestId("settings-msg")).toHaveText("Settings saved.");
}

let organiserUrl = "";

test.describe.serial("after phase 5", () => {
  test("the terms are written from Emily's settings and change when she changes them", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.getByTestId("legal-draft-banner")).toHaveText("Draft for review. Not legal advice.");
    await expect(page.getByTestId("legal-section-2")).toContainText("Custom cakes need a deposit of 50% of the order total.");
    await expect(page.getByTestId("legal-section-5")).toContainText("less an admin fee of $20");
    await expect(page.getByTestId("legal-section-7")).toContainText("A class needs at least 4 guests to run.");
    await expect(page.getByTestId("legal-placeholder").first()).toBeVisible();
    await expect(page.getByTestId("legal-doc")).toContainText("[Emily's ABN]");
    expect(await page.getByTestId("legal-doc").textContent()).not.toMatch(/\u2014/);

    await adminLogin(page);
    await setCancelFee(page, "25");
    await page.goto("/terms");
    await expect(page.getByTestId("legal-section-5")).toContainText("less an admin fee of $25");
    await setCancelFee(page, "20");
  });

  test("Emily can turn the draft banner off and on for both pages", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByTestId("legal-draft-banner")).toBeVisible();
    await expect(page.getByTestId("legal-doc")).toContainText("We never see or store your card details.");
    expect(await page.getByTestId("legal-doc").textContent()).not.toMatch(/\u2014/);

    await adminLogin(page);
    await page.goto("/admin/settings");
    await page.getByTestId("legal-draft-banner-toggle").uncheck();
    await page.getByTestId("save-settings").click();
    await expect(page.getByTestId("settings-msg")).toHaveText("Settings saved.");
    for (const path of ["/terms", "/privacy"]) {
      await page.goto(path);
      await expect(page.getByTestId("legal-doc")).toBeVisible();
      await expect(page.getByTestId("legal-draft-banner")).toHaveCount(0);
    }
    await page.goto("/admin/settings");
    await page.getByTestId("legal-draft-banner-toggle").check();
    await page.getByTestId("save-settings").click();
    await expect(page.getByTestId("settings-msg")).toHaveText("Settings saved.");
    await page.goto("/terms");
    await expect(page.getByTestId("legal-draft-banner")).toBeVisible();
  });

  test("a customer asks for no photos at checkout, and the kitchen sheet says so", async ({ page }) => {
    await page.goto("/order");
    for (let i = 0; i < 6; i++) await next(page);
    await (await showDay(page, CAKE_DATE)).click();
    await page.locator('[data-testid^="slot-"]:not([disabled])').first().click();
    await next(page);
    await page.getByLabel("Your name").fill("Nia Private");
    await page.getByLabel("Email", { exact: true }).fill("nia.private@example.com");
    await page.getByLabel("Mobile").fill("0412 333 444");
    await next(page);
    await page.getByTestId("photo-opt-out").check();
    await page.getByTestId("accept-terms").check();
    await page.getByTestId("pay").click();
    await expect(page).toHaveURL(/\/checkout\/test/);
    await page.getByTestId("test-pay").click();
    await expect(page).toHaveURL(/\/o\//);

    await adminLogin(page);
    await page.goto(`/admin/kitchen?view=day&date=${CAKE_DATE}`);
    const line = page.locator('[data-testid^="kitchen-"]', { hasText: "Nia" }).first();
    await expect(line.getByTestId("no-photos")).toContainText("NO PHOTOS");
  });

  test("the organiser removes unpaid places, and the places still to pay are worked out again", async ({ page }) => {
    await page.goto("/classes/private");
    await page.getByTestId("private-deluxe").click();
    await page.getByTestId("private-guests").fill("8");
    await page.getByTestId("private-date").fill(PRIVATE_DATE);
    await page.getByTestId("private-name").fill("Jo Fewer");
    await page.getByTestId("private-email").fill("jo.fewer@example.com");
    await page.getByTestId("private-phone").fill("0400 555 888");
    await page.getByTestId("private-submit").click();
    await expect(page.getByTestId("private-sent")).toBeVisible();

    await adminLogin(page);
    await page.goto("/admin/classes/private");
    const card = page.locator("li", { hasText: "Jo Fewer" }).first();
    await card.getByTestId("private-accept").click();
    await expect(card.getByTestId("private-status")).toHaveText("Accepted (deposit link sent)");
    const accepted = (await emailsTo(page, "jo.fewer@example.com")).find((m) => m.subject.includes("pay the $150 deposit"))!;
    organiserUrl = /http:\/\/localhost:\d+\/p\/[A-Za-z0-9_-]{43}/.exec(accepted.text)![0];

    await page.goto(organiserUrl);
    await page.getByTestId("private-pay").click();
    await expect(page).toHaveURL(/\/checkout\/test/);
    await page.getByTestId("test-pay").click();
    await expect(page.getByTestId("tracker-count")).toHaveText("0 of 8 paid");

    await page.getByTestId("organiser-reduce-guests").fill("5");
    await page.getByTestId("organiser-reduce-preview").click();
    await expect(page.getByTestId("organiser-reduce-summary")).toContainText("at least 6 guests");
    await expect(page.getByTestId("organiser-reduce-confirm")).toHaveCount(0);

    await page.getByTestId("organiser-reduce-guests").fill("7");
    await page.getByTestId("organiser-reduce-preview").click();
    // $840 - $150 deposit = $690 across 7 places, $98.57 each (one gets the odd cents).
    await expect(page.getByTestId("organiser-reduce-summary")).toContainText("Going from 8 to 7 guests");
    await page.getByTestId("organiser-reduce-confirm").click();
    await expect(page.getByTestId("organiser-msg")).toHaveText("Guest numbers updated.");
    await expect(page.getByTestId("tracker-count")).toHaveText("0 of 7 paid");
    await expect(page.getByTestId("organiser-reduction")).toContainText("Going from 8 to 7 guests");
    expect((await emailsTo(page, "jo.fewer@example.com")).some((m) => m.subject.startsWith("Guest numbers updated: 7 guests"))).toBe(true);
    expect((await emailsTo(page, "emily@example.com")).some((m) => m.subject.startsWith("Guest numbers lowered"))).toBe(true);
  });

  test("Emily lowers the guest numbers from the admin with a preview first", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/classes/private");
    const card = page.locator("li", { hasText: "Jo Fewer" }).first();
    await card.getByTestId("reduce-open").click();
    await card.getByTestId("reduce-guests").fill("6");
    await card.getByTestId("reduce-preview").click();
    await expect(card.getByTestId("reduce-summary")).toContainText("Going from 7 to 6 guests");
    await expect(card.getByTestId("reduce-summary")).toContainText("$720");
    await card.getByTestId("reduce-confirm").click();
    await expect(card.getByTestId("reduce-msg")).toContainText("Guest numbers updated");
    await expect(card.getByTestId("private-guests").locator("li")).toHaveCount(6);
    await expect(card.getByTestId("reduction-record")).toHaveCount(2);
    // At the package minimum there's nothing left to lower.
    await expect(card.getByTestId("reduce-open")).toHaveCount(0);
  });

  test("an automatic refund for cancelled seats is saved on the booking and shown to Emily", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/settings");
    await page.getByTestId("auto-refunds").check();
    await page.getByTestId("save-settings").click();
    await expect(page.getByTestId("settings-msg")).toHaveText("Settings saved.");
    await page.goto("/admin/classes");
    await page.getByTestId("series-type").selectOption("class-florals");
    await page.getByTestId("series-date").fill(CLASS_DATE);
    await page.getByTestId("series-count").fill("1");
    await page.getByTestId("series-create").click();
    await expect(page.getByTestId("series-msg")).toHaveText("Added 1 class.");

    await page.goto("/classes");
    const row = page.locator('[data-testid^="session-"]', { hasText: longDate(CLASS_DATE) }).first();
    await row.getByTestId("book-session").click();
    await page.getByTestId("class-seats").selectOption("2");
    for (const [i, name] of ["Ivy", "Jac"].entries()) await page.getByTestId(`guest-name-${i}`).fill(name);
    await page.getByTestId("class-contact").fill("Ivy Refund");
    await page.getByTestId("class-email").fill("ivy.refund@example.com");
    await page.getByTestId("class-phone").fill("0400 717 818");
    await page.getByTestId("class-adult").check();
    await page.getByTestId("class-terms").check();
    await page.getByTestId("class-pay").click();
    await expect(page).toHaveURL(/\/checkout\/test/);
    await page.getByTestId("test-pay").click();
    await expect(page.getByTestId("ticket-status")).toHaveText("Booked");
    await page.getByTestId("seats-cancel-open").click();
    await page.getByTestId("seat-1").check();
    await page.getByTestId("seats-cancel-confirm").click();
    await expect(page.getByTestId("ticket-guests").locator("li")).toHaveCount(1);

    await page.goto("/admin/classes");
    await page.getByTestId(`admin-session-${CLASS_DATE}`).click();
    await expect(page.getByTestId("partial-record")).toContainText("Refunded through Stripe: $95 (re_");

    await page.goto("/admin/settings");
    await page.getByTestId("auto-refunds").uncheck();
    await page.getByTestId("save-settings").click();
    await expect(page.getByTestId("settings-msg")).toHaveText("Settings saved.");
  });

  test("the new and changed screens fit a phone (390px)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/terms", "/privacy", organiserUrl]) {
      await page.goto(path);
      await noSideScroll(page);
    }
    await adminLogin(page);
    await page.goto("/admin/classes/private");
    await noSideScroll(page);
    await page.goto(`/admin/kitchen?view=day&date=${CAKE_DATE}`);
    await noSideScroll(page);
  });
});
