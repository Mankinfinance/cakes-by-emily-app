import { expect, test, type Page } from "@playwright/test";

// Phase 4: split payments and guest details for private classes, class
// photo galleries, the class pass, vouchers on seasonal boxes, customer
// self-cancel and automated refunds. Memory adapter, test checkout, real clock.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
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
  while (new Date(`${d}T00:00:00Z`).getUTCDay() === 1 || d === "2026-12-24") d = addDays(d, 1);
  return d;
}

/** Same format as the site's formatDateLong, to find a class row by its date. */
function longDate(date: string): string {
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

const TODAY = sydneyToday();
const CLASS_DATE = openDay(addDays(TODAY, 33));
const PRIVATE_DATE = openDay(addDays(TODAY, 75));

let organiserUrl = "";
let ticketUrl = "";
let galleryUrl = "";

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

test.describe.serial("phase 4", () => {
  test("a private class is split between guests, who add their details and pay their shares", async ({ page }) => {
    await page.goto("/classes/private");
    await page.getByTestId("private-deluxe").click();
    await page.getByTestId("private-guests").fill("6");
    await page.getByTestId("private-date").fill(PRIVATE_DATE);
    await page.getByTestId("private-name").fill("Jo Split");
    await page.getByTestId("private-email").fill("jo.split@example.com");
    await page.getByTestId("private-phone").fill("0400 555 777");
    await page.getByTestId("private-submit").click();
    await expect(page.getByTestId("private-sent")).toBeVisible();

    await adminLogin(page);
    await page.goto("/admin/classes/private");
    const card = page.locator("li", { hasText: "Jo Split" }).first();
    await card.getByTestId("private-accept").click();
    await expect(card.getByTestId("private-status")).toHaveText("Accepted (deposit link sent)");

    const accepted = (await emailsTo(page, "jo.split@example.com")).find((m) => m.subject.includes("pay the $150 deposit"))!;
    organiserUrl = /http:\/\/localhost:\d+\/p\/[A-Za-z0-9_-]{43}/.exec(accepted.text)![0];
    await page.goto(organiserUrl);
    await page.getByTestId("private-pay").click();
    await payAtTestCheckout(page);
    await expect(page.getByTestId("organiser-tracker")).toBeVisible();
    await expect(page.getByTestId("tracker-count")).toHaveText("0 of 6 paid");
    const share = (await page.getByTestId("share-link").textContent())!.trim();
    await expect(page.getByTestId("nudge")).toBeDisabled(); // nobody to remind yet
    await expect(page.getByTestId("pay-rest")).toBeDisabled(); // not due yet

    // Guest 1 adds details and pays. Deluxe x 6: ($720 - $150) / 6 = $95.
    await page.goto(new URL(share).pathname);
    await expect(page.getByTestId("guest-heading")).toHaveText("Join Jo's class: add your details and pay your share");
    await page.getByTestId("guest-name").fill("Bea Wu");
    await page.getByTestId("guest-email").fill("bea.split@example.com");
    await page.getByRole("button", { name: "Egg-free" }).click();
    await page.getByTestId("guest-allergies").fill("Peanuts");
    await page.getByTestId("guest-optin").check();
    await expect(page.getByTestId("guest-pay")).toHaveText("Save and pay my share $95");
    await page.getByTestId("guest-pay").click();
    await payAtTestCheckout(page);
    await expect(page.getByTestId("share-paid")).toContainText("Your share of $95 is paid");

    // Guest 2 just saves details.
    await page.goto(new URL(share).pathname);
    await page.getByTestId("guest-name").fill("Cy Ng");
    await page.getByTestId("guest-email").fill("cy.split@example.com");
    await page.getByTestId("guest-save").click();
    await expect(page.getByTestId("pay-share")).toHaveText("Pay my share $95");

    // The organiser sees names and who has paid, never allergies, and can nudge once.
    await page.goto(organiserUrl);
    await expect(page.getByTestId("tracker-count")).toHaveText("1 of 6 paid");
    await expect(page.getByTestId("tracker-names")).toContainText("Bea Wu");
    await expect(page.getByTestId("tracker-names")).toContainText("Cy Ng");
    await expect(page.getByTestId("organiser-tracker")).not.toContainText("Peanuts");
    await page.getByTestId("nudge").click();
    await expect(page.getByTestId("organiser-msg")).toHaveText("Reminder sent to 1 guest.");
    await expect(page.getByTestId("nudge")).toBeDisabled();
    const nudge = (await emailsTo(page, "cy.split@example.com")).find((m) => m.subject.startsWith("Reminder: your share"))!;
    expect(nudge.text).toMatch(/\/g\/[A-Za-z0-9_-]{43}\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{43}/);

    // Emily's guest list fills in live, with allergies and "details missing" flags.
    await adminLogin(page);
    await page.goto("/admin/classes/private");
    const split = page.locator('[data-testid^="split-"]').first();
    await expect(split.getByTestId("split-progress")).toContainText("1 of 6 shares paid");
    await expect(split).toContainText("ALLERGIES: Egg-free. Peanuts");
    await expect(split.getByText("Details missing")).toHaveCount(4);
  });

  test("a class pass pays for seats, and a guest can cancel from their ticket", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/classes");
    await page.getByTestId("series-type").selectOption("class-florals");
    await page.getByTestId("series-date").fill(CLASS_DATE);
    await page.getByTestId("series-count").fill("1");
    await page.getByTestId("series-create").click();
    await expect(page.getByTestId("series-msg")).toHaveText("Added 1 class.");

    await page.goto("/classes/pass");
    await page.getByTestId("pass-name").fill("Pia Pass");
    await page.getByTestId("pass-email").fill("pia.pass@example.com");
    await page.getByTestId("pass-terms").check();
    await expect(page.getByTestId("pass-buy")).toHaveText("Buy the pass for $255");
    await page.getByTestId("pass-buy").click();
    await payAtTestCheckout(page);
    await expect(page.getByTestId("pass-thanks")).toBeVisible();
    const code = CODE.exec((await emailsTo(page, "pia.pass@example.com")).find((m) => m.subject === "Your 3-class pass")!.text)![0];

    await page.goto("/classes");
    const row = page.locator('[data-testid^="session-"]', { hasText: longDate(CLASS_DATE) }).first();
    await row.getByTestId("book-session").click();
    await page.getByTestId("class-seats").selectOption("2");
    await page.getByTestId("guest-name-0").fill("Pia");
    await page.getByTestId("guest-name-1").fill("Quinn");
    await page.getByTestId("class-contact").fill("Pia Pass");
    await page.getByTestId("class-email").fill("pia.pass@example.com");
    await page.getByTestId("class-phone").fill("0400 101 202");
    await page.getByTestId("class-pass-code").fill(code.toLowerCase());
    await page.getByTestId("class-adult").check();
    await page.getByTestId("class-terms").check();
    await page.getByTestId("class-pay").click();
    // Both seats covered by the pass: straight to the ticket, no checkout.
    await expect(page).toHaveURL(/\/t\/[A-Za-z0-9_-]{43}\?paid=1$/);
    await expect(page.getByTestId("ticket-status")).toHaveText("Booked");
    await expect(page.getByTestId("ticket")).toContainText("plus 2 class pass credits");
    ticketUrl = page.url().split("?")[0];

    await expect(page.getByTestId("ticket-cancel-rule")).toContainText("Your 2 class pass credits come back");
    await page.getByTestId("ticket-cancel-open").click();
    await page.getByTestId("ticket-cancel-confirm").click();
    await expect(page.getByTestId("ticket-status")).toHaveText("Cancelled");
    await adminLogin(page);
    await page.goto("/admin/vouchers");
    await expect(page.getByTestId("pass-list")).toContainText("3 of 3 left");
  });

  test("Emily uploads class photos and guests view, download and share them", async ({ page }) => {
    // A paid booking to send the gallery to.
    await page.goto("/classes");
    const row = page.locator('[data-testid^="session-"]', { hasText: longDate(CLASS_DATE) }).first();
    await row.getByTestId("book-session").click();
    await page.getByTestId("guest-name-0").fill("Gil");
    await page.getByTestId("class-contact").fill("Gil Gallery");
    await page.getByTestId("class-email").fill("gil.gallery@example.com");
    await page.getByTestId("class-phone").fill("0400 303 404");
    await page.getByTestId("class-adult").check();
    await page.getByTestId("class-terms").check();
    await page.getByTestId("class-pay").click();
    await payAtTestCheckout(page);
    await expect(page.getByTestId("ticket-status")).toHaveText("Booked");

    await adminLogin(page);
    await page.goto("/admin/classes");
    await page.getByTestId(`admin-session-${CLASS_DATE}`).click();
    for (const caption of ["Piping practice", "Finished cakes"]) {
      await page.getByTestId("gallery-file").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
      await page.getByLabel("Caption").fill(caption);
      await page.getByTestId("gallery-upload").click();
      await expect(page.getByTestId("gallery-msg")).toHaveText("Photo added.");
    }
    await expect(page.getByTestId("gallery-photos").locator("li")).toHaveCount(2);
    await page.getByTestId("gallery-email").click();
    await expect(page.getByTestId("gallery-msg")).toHaveText("Gallery link emailed to 1 booking.");
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("gallery-delete").first().click();
    await expect(page.getByTestId("gallery-photos").locator("li")).toHaveCount(1);

    const mail = (await emailsTo(page, "gil.gallery@example.com")).find((m) => m.subject.startsWith("Your photos from"))!;
    galleryUrl = /\/gallery\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{43}/.exec(mail.text)![0];
    await page.context().clearCookies();
    await page.goto(galleryUrl);
    await expect(page.getByTestId("gallery-grid").locator("li")).toHaveCount(1);
    await page.getByTestId("photo-0").click();
    await expect(page.getByTestId("viewer-caption")).toHaveText("Finished cakes @_cakes_by_emily_");
    const download = page.waitForEvent("download");
    await page.getByTestId("photo-download").click();
    expect((await download).suggestedFilename()).toMatch(/^cakes-by-emily-1\.(jpg|png)$/);
    await page.getByTestId("viewer-close").click();

    // The link only works with the right token.
    const bad = galleryUrl.replace(/[A-Za-z0-9_-]{43}$/, "a".repeat(43));
    expect((await page.request.get(bad)).status()).toBe(404);
  });

  test("a gift voucher pays for a whole seasonal box", async ({ page }) => {
    await page.goto("/vouchers");
    await page.getByTestId("amount-10000").click();
    await page.getByTestId("buyer-name").fill("Val Voucher");
    await page.getByTestId("buyer-email").fill("val.voucher@example.com");
    await page.getByTestId("recipient-name").fill("Val");
    await page.getByTestId("voucher-terms").check();
    await page.getByTestId("buy-voucher").click();
    await payAtTestCheckout(page);
    const code = CODE.exec((await emailsTo(page, "val.voucher@example.com")).at(-1)!.text)![0];

    await page.goto("/boxes");
    const card = page.locator('[data-testid^="box-"]', { hasText: "Christmas cookie box" }).first();
    const before = (await card.getByTestId("box-remaining").textContent())!;
    await card.getByTestId("box-preorder").click();
    const pickup = openDay(addDays(TODAY > "2026-12-18" ? TODAY : "2026-12-18", 1));
    await card.getByTestId("box-date").fill(pickup);
    await card.getByTestId("box-slot").selectOption("10:00");
    await card.getByTestId("box-name").fill("Val Voucher");
    await card.getByTestId("box-email").fill("val.voucher@example.com");
    await card.getByTestId("box-phone").fill("0400 505 606");
    await card.getByTestId("box-voucher").fill(code);
    await card.getByTestId("box-terms").check();
    await card.getByTestId("box-pay").click();
    await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{43}\?paid=1$/);
    await expect(page.getByTestId("box-status")).toHaveText("Confirmed");
    await expect(page.getByTestId("box-voucher-applied")).toHaveText("$45");
    await page.goto("/boxes");
    expect(await page.locator('[data-testid^="box-"]', { hasText: "Christmas cookie box" }).first().getByTestId("box-remaining").textContent()).not.toBe(before);
  });

  test("with automatic refunds on, Emily's cancel button shows the refund and Stripe makes it", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/settings");
    await page.getByTestId("auto-refunds").check();
    await page.getByTestId("save-settings").click();
    await expect(page.getByTestId("settings-msg")).toHaveText("Settings saved.");

    await page.goto("/admin/classes");
    await page.getByTestId(`admin-session-${CLASS_DATE}`).click();
    const button = page.getByTestId("session-bookings").getByRole("button", { name: "Cancel booking and refund $95 via Stripe" });
    await expect(button).toBeVisible();
    let confirmText = "";
    page.once("dialog", (d) => {
      confirmText = d.message();
      d.accept();
    });
    await button.click();
    await expect(page.getByTestId("session-bookings")).toContainText("(cancelled)");
    expect(confirmText).toContain("$95 will be refunded through Stripe now");
    const alerts = await emailsTo(page, "emily@example.com");
    expect(alerts.some((m) => m.subject.startsWith("Refund needed by hand"))).toBe(false);

    // Private class: deposit and the paid share refunded together.
    await page.goto("/admin/classes/private");
    const card = page.locator("li", { hasText: "Jo Split" }).first();
    page.once("dialog", (d) => d.accept());
    await card.getByRole("button", { name: "Cancel private class and refund $245 via Stripe" }).click();
    await expect(card.getByTestId("private-status")).toHaveText("Cancelled");

    await page.goto("/admin/settings");
    await page.getByTestId("auto-refunds").uncheck();
    await page.getByTestId("save-settings").click();
    await expect(page.getByTestId("settings-msg")).toHaveText("Settings saved.");
  });
});

test.describe("phase 4 at phone width (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("no sideways scrolling on the new screens", async ({ page }) => {
    for (const path of ["/classes", "/classes/pass", "/classes/pass/thanks", organiserUrl, ticketUrl, galleryUrl].filter(Boolean)) {
      await page.goto(path);
      await noSideScroll(page);
    }
    await page.request.post("/api/test-login");
    for (const path of ["/admin/classes/private", "/admin/vouchers", "/admin/settings", "/admin/classes"]) {
      await page.goto(path);
      await noSideScroll(page);
    }
  });
});
