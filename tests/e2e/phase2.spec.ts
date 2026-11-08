import { expect, test, type Page } from "@playwright/test";

// Phase 2: seasonal boxes, gift vouchers, design approval, change or cancel,
// the waitlist, automatic messages and the kitchen sheet. Runs on the memory
// adapter with the test checkout, against the real clock, so dates are worked
// out from today rather than fixed.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const CRON = { authorization: "Bearer e2e-cron-secret-0123456789" };

function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The first date on or after `from` that isn't a Monday (closed) or a sample peak date. */
function openDay(from: string): string {
  let d = from;
  while (new Date(`${d}T00:00:00Z`).getUTCDay() === 1 || d === "2026-12-24") d = addDays(d, 1);
  return d;
}

const TODAY = sydneyToday();
let orderUrl = "";

async function next(page: Page) {
  await page.getByTestId("next").click();
}

async function adminLogin(page: Page) {
  await page.request.post("/api/test-login");
}

async function emailsTo(page: Page, to: string): Promise<{ subject: string; text: string }[]> {
  const res = await page.request.get(`/api/test-outbox?to=${encodeURIComponent(to)}`);
  return res.json();
}

/** Show a specific day in the builder calendar, moving forward a month if needed. */
async function showDay(page: Page, date: string) {
  for (let i = 0; i < 4; i++) {
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

test.describe.serial("phase 2", () => {
  test("Emily adds a seasonal box, a customer pre-orders it, and it shows on the kitchen sheet", async ({ page }) => {
    const pickup = openDay(addDays(TODAY, 4));
    await adminLogin(page);
    await page.goto("/admin/boxes");
    await page.getByTestId("box-new-edit").click();
    await page.getByTestId("box-new-name").fill("E2E brownie box");
    await page.getByTestId("box-new-description").fill("Six fudgy brownies [Sample]");
    await page.getByTestId("box-new-price").fill("30");
    await page.getByTestId("box-new-cap").fill("5");
    await page.getByTestId("box-new-opensOn").fill(TODAY);
    await page.getByTestId("box-new-closesOn").fill(addDays(TODAY, 20));
    await page.getByTestId("box-new-pickupFrom").fill(addDays(TODAY, 2));
    await page.getByTestId("box-new-pickupTo").fill(addDays(TODAY, 25));
    await page.getByTestId("box-new-save").click();
    await expect(page.getByTestId("box-new-msg")).toHaveText("Saved.");
    await expect(page.getByTestId("admin-boxes")).toContainText("E2E brownie box");

    await page.goto("/boxes");
    const card = page.getByTestId("box-E2E brownie box");
    await expect(card.getByTestId("box-remaining")).toHaveText("5 left");
    await expect(card.getByTestId("box-countdown")).toHaveText("Closes in 20 days");
    await card.getByTestId("box-preorder").click();
    await card.getByTestId("box-qty").fill("2");
    await card.getByTestId("box-date").fill(pickup);
    await card.getByTestId("box-slot").selectOption("10:00");
    await card.getByTestId("box-name").fill("Kim Lee");
    await card.getByTestId("box-email").fill("kim@example.com");
    await card.getByTestId("box-phone").fill("0400 111 222");
    await card.getByTestId("box-terms").check();
    await expect(card.getByTestId("box-pay")).toHaveText("Pay $60");
    await card.getByTestId("box-pay").click();
    await expect(page).toHaveURL(/\/checkout\/test/);
    await page.getByTestId("test-pay").click();
    await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{43}\?paid=1$/);
    await expect(page.getByTestId("box-status")).toHaveText("Confirmed");
    await expect(page.getByTestId("box-paid")).toHaveText("$60");

    await page.goto("/boxes");
    await expect(page.getByTestId("box-E2E brownie box").getByTestId("box-remaining")).toHaveText("3 left");

    // Kitchen sheet: the box is listed, a tick survives a reload, and printing hides the app chrome.
    await page.goto(`/admin/kitchen?view=day&date=${pickup}`);
    const line = page.locator('[data-testid^="kitchen-BOX-"]').first();
    await expect(line).toContainText("2 x E2E brownie box");
    const tick = line.locator('input[type="checkbox"]');
    await tick.check();
    await expect(tick).toBeChecked();
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page.locator('[data-testid^="kitchen-BOX-"]').first().locator('input[type="checkbox"]')).toBeChecked();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("header").first()).toBeHidden();
    await expect(page.getByTestId("print")).toBeHidden();
    await expect(page.locator('[data-testid^="kitchen-BOX-"]').first()).toBeVisible();
    await page.emulateMedia({ media: "screen" });

    // Hiding the box removes it from the shop.
    await page.goto("/admin/boxes");
    const editor = page.locator('[data-testid^="box-"]', { hasText: "E2E brownie box" }).first();
    await editor.locator('input[type="checkbox"]').uncheck();
    await expect(editor).toContainText("Hidden");
    await page.goto("/boxes");
    await expect(page.getByTestId("box-E2E brownie box")).toHaveCount(0);
  });

  test("a customer buys a gift voucher and it pays for a cake deposit", async ({ page }) => {
    await page.goto("/vouchers");
    await page.getByTestId("amount-10000").click();
    await page.getByTestId("buyer-name").fill("Kim Lee");
    await page.getByTestId("buyer-email").fill("kim.voucher@example.com");
    await page.getByTestId("recipient-name").fill("Jordan");
    await page.getByTestId("recipient-email").fill("jordan@example.com");
    await page.getByTestId("voucher-terms").check();
    await page.getByTestId("buy-voucher").click();
    await expect(page).toHaveURL(/\/checkout\/test/);
    await page.getByTestId("test-pay").click();
    await expect(page.getByTestId("voucher-thanks")).toBeVisible();

    const mail = await emailsTo(page, "jordan@example.com");
    const code = /[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/.exec(mail.at(-1)!.text)![0];
    expect((await emailsTo(page, "kim.voucher@example.com")).at(-1)!.text).toContain(code);

    // Spend it: a 6" round with smooth buttercream is $130, deposit $65, so the voucher covers it.
    await page.goto("/order");
    for (let i = 0; i < 6; i++) await next(page);
    const day = await showDay(page, openDay(addDays(TODAY, 21)));
    await day.click();
    await page.locator('[data-testid^="slot-"]:not([disabled])').first().click();
    await next(page);
    await page.getByLabel("Your name").fill("Jordan Smith");
    await page.getByLabel("Email", { exact: true }).fill("jordan@example.com");
    await page.getByLabel("Mobile").fill("0412 000 111");
    await expect(page.getByTestId("remind-next-year")).toBeVisible();
    await page.getByTestId("remind-next-year").check();
    await next(page);
    await expect(page.getByTestId("terms-lines")).toContainText("$20 admin fee");
    await page.getByTestId("voucher-code").fill("AAAA-BBBB-CCCC-DDDD");
    await page.getByTestId("apply-code").click();
    await expect(page.getByTestId("code-error")).toContainText("wasn't recognised");
    await page.getByTestId("voucher-code").fill(code.toLowerCase());
    await page.getByTestId("apply-code").click();
    await expect(page.getByTestId("code-applied")).toContainText("$100 will come off your order. Nothing more to pay today.");
    await page.getByTestId("accept-terms").check();
    await expect(page.getByTestId("pay")).toHaveText("Place order");
    await page.getByTestId("pay").click();
    await expect(page).toHaveURL(/\/o\/[A-Za-z0-9_-]{43}\?paid=1$/);
    await expect(page.getByTestId("tracker")).toHaveAttribute("data-stage", "received");
    await expect(page.getByTestId("voucher-applied")).toHaveText("$100");
    await expect(page.getByTestId("balance")).toHaveText("$30");
    await expect(page.getByTestId("msg-order_received")).toHaveAttribute("data-status", "sent");
    await expect(page.getByTestId("msg-rebook_reminder")).toHaveAttribute("data-status", "scheduled");
    orderUrl = page.url().split("?")[0];
  });

  test("Emily sends a design, the customer asks for a change, then approves it", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin");
    await page.getByText("Jordan Smith").click();
    await expect(page).toHaveURL(/\/admin\/orders\/[0-9a-f-]{36}$/);
    const adminOrder = page.url();
    await page.getByTestId("sketch-file").setInputFiles({ name: "sketch.png", mimeType: "image/png", buffer: PNG });
    await page.getByTestId("sketch-note").fill("Pink buttercream with a gold drip");
    await page.getByTestId("send-sketch").click();
    await expect(page.getByTestId("sketch-msg")).toHaveText("Sent. The customer has been emailed.");

    await page.goto(orderUrl);
    await expect(page.getByTestId("approval")).toContainText("Pink buttercream with a gold drip");
    await expect(page.getByAltText("Emily's sketch of your cake")).toBeVisible();
    await page.getByTestId("request-change").click();
    await expect(page.getByTestId("change-rounds")).toHaveText("1 free change round left.");
    await page.getByTestId("change-text").fill("Could the drip be rose gold?");
    await page.getByTestId("send-change").click();
    await expect(page.getByTestId("approval")).toHaveCount(0);
    await expect(page.getByTestId("updates")).toContainText("Could the drip be rose gold?");

    await page.goto(adminOrder);
    await page.getByTestId("sketch-note").fill("Now with a rose gold drip");
    await page.getByTestId("send-sketch").click();
    await expect(page.getByTestId("sketch-msg")).toHaveText("Sent. The customer has been emailed.");

    await page.goto(orderUrl);
    await page.getByTestId("request-change").click();
    await expect(page.getByTestId("change-rounds")).toContainText("Further changes may incur a fee");
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByTestId("approve-design").click();
    await expect(page.getByTestId("tracker")).toHaveAttribute("data-stage", "design_confirmed");
    await expect(page.getByTestId("msg-design_confirmed")).toHaveAttribute("data-status", "sent");

    await page.goto(adminOrder);
    await expect(page.getByTestId("approved-at")).toContainText("Design approved by the customer");
  });

  test("the customer moves their date once, then cancels and gets the voucher back", async ({ page }) => {
    const newDate = openDay(addDays(TODAY, 24));
    await page.goto(orderUrl);
    await expect(page.getByTestId("date-rule")).toHaveText("You can move your pickup date once for free.");
    await page.getByTestId("open-change-date").click();
    await page.getByTestId("new-date").fill(newDate);
    await page.locator('[data-testid^="new-slot-"]:not([disabled])').first().click();
    await page.getByTestId("confirm-date").click();
    await expect(page.getByTestId("change-msg")).toHaveText("Done! Your pickup has moved.");
    await expect(page.getByTestId("date-rule")).toContainText("used your free date change");
    await expect(page.getByTestId("updates")).toContainText("Pickup moved from");

    await expect(page.getByTestId("cancel-rule")).toContainText("comes back as credit");
    await page.getByTestId("open-cancel").click();
    await page.getByTestId("confirm-cancel").click();
    await expect(page.getByTestId("cancellation")).toContainText("voucher or credit you used comes back as credit");
    await expect(page.getByTestId("tracker-cancelled")).toBeVisible();
    await expect(page.getByTestId("change-cancel")).toHaveCount(0);

    await adminLogin(page);
    await page.goto("/admin?view=cancelled");
    await page.getByText("Jordan Smith").click();
    await expect(page.getByTestId("admin-cancellation")).toContainText("Cancelled by the customer");
    await page.goto("/admin/vouchers");
    await expect(page.getByTestId("voucher-table")).toContainText("$100 of $100");
  });

  test("a full date takes a waitlist, and the first person can claim a freed place", async ({ page }) => {
    const target = openDay(addDays(TODAY, 10));
    await adminLogin(page);
    await page.goto("/admin/settings");
    await page.getByTestId("daily-cap").fill("0");
    await page.getByTestId("save-settings").click();
    await expect(page.getByTestId("settings-msg")).toHaveText("Settings saved.");

    await page.goto("/order");
    for (let i = 0; i < 6; i++) await next(page);
    const day = await showDay(page, target);
    await expect(day).toHaveAttribute("data-state", "full");
    await day.click();
    await expect(page.getByTestId("waitlist-panel")).toBeVisible();
    await page.getByLabel("Waitlist name").fill("Ann Lee");
    await page.getByLabel("Waitlist email").fill("ann.waitlist@example.com");
    await page.getByLabel("Waitlist mobile").fill("0400 333 444");
    await page.getByTestId("join-waitlist").click();
    await expect(page.getByTestId("waitlist-msg")).toContainText("You're number 1 on the waitlist");

    await page.goto("/admin/waitlist");
    await expect(page.getByTestId("wl-ann.waitlist@example.com").getByTestId("wl-status")).toHaveText("Waiting");

    // Room opens up: the daily job offers it to Ann.
    await page.goto("/admin/settings");
    await page.getByTestId("daily-cap").fill("3");
    await page.getByTestId("save-settings").click();
    await expect(page.getByTestId("settings-msg")).toHaveText("Settings saved.");
    const cron = await page.request.get("/api/cron/reminders", { headers: CRON });
    expect((await cron.json()).waitlist.offered).toBeGreaterThanOrEqual(1);
    await page.goto("/admin/waitlist");
    await expect(page.getByTestId("wl-ann.waitlist@example.com").getByTestId("wl-status")).toHaveText("Offered (24h)");

    const offer = (await emailsTo(page, "ann.waitlist@example.com")).find((m) => m.subject.startsWith("A spot opened"))!;
    const link = /\/waitlist\/[A-Za-z0-9_-]{43}/.exec(offer.text)![0];
    await page.goto(link);
    await page.locator('[data-testid^="claim-slot-"]:not([disabled])').first().click();
    await page.getByTestId("claim-terms").check();
    await page.getByTestId("claim-pay").click();
    await expect(page).toHaveURL(/\/checkout\/test/);
    await page.getByTestId("test-pay").click();
    await expect(page.getByTestId("tracker")).toHaveAttribute("data-stage", "received");

    await page.goto(link);
    await expect(page.getByTestId("claim-expired")).toBeVisible();
    await page.goto("/admin/waitlist");
    await expect(page.getByTestId("wl-ann.waitlist@example.com").getByTestId("wl-status")).toHaveText("Booked");
  });

  test("Emily switches automatic messages on and off", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/automations");
    await page.getByTestId("toggle-thank_you").uncheck();
    await expect(page.getByTestId("automation-msg")).toHaveText("Thank you and review request: saved.");
    await page.reload();
    await expect(page.getByTestId("toggle-thank_you")).not.toBeChecked();
    await page.getByTestId("days-balance_reminder").fill("5");
    await page.getByTestId("save-balance_reminder").click();
    await expect(page.getByTestId("automation-msg")).toHaveText("Balance reminder: saved.");
    await page.reload();
    await expect(page.getByTestId("days-balance_reminder")).toHaveValue("5");
    await page.getByTestId("toggle-thank_you").check();
    await expect(page.getByTestId("automation-msg")).toHaveText("Thank you and review request: saved.");
  });

  test("the terms page is written from Emily's settings", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.getByTestId("terms-rules")).toContainText("Cancel 14 days or more before pickup: your deposit back, minus a $20 admin fee.");
  });

  test("the new endpoints reject bad input and unknown orders", async ({ request }) => {
    const res = await request.post("/api/vouchers/check", { data: { code: "x" } });
    expect(res.status()).toBe(400);
    const bad = await request.post("/api/waitlist", { data: { date: "nope" } });
    expect(bad.status()).toBe(400);
    expect((await request.post(`/api/orders/${"a".repeat(43)}/cancel`, { data: { confirm: true } })).status()).toBe(404);
  });
});

test.describe("phase 2 at phone width (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("no sideways scrolling on the new screens", async ({ page }) => {
    for (const path of ["/boxes", "/vouchers", "/vouchers/thanks", "/terms"]) {
      await page.goto(path);
      await noSideScroll(page);
    }
    if (orderUrl) {
      await page.goto(orderUrl);
      await noSideScroll(page);
    }
    await page.request.post("/api/test-login");
    for (const path of ["/admin/kitchen", "/admin/waitlist", "/admin/boxes", "/admin/vouchers", "/admin/automations", "/admin/settings"]) {
      await page.goto(path);
      await noSideScroll(page);
    }
  });
});
