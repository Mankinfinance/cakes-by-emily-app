import { expect, test, type Page } from "@playwright/test";

// Phase 3: corporate packages, party add-ons, referrals and the stamp card,
// reviews, Cake and Sip classes (booking, waitlist, admin), private groups
// and the sales snapshot. Memory adapter, test checkout, real clock.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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
// Dates for this spec, well clear of the other specs' dates.
const CORP_DATE = openDay(addDays(TODAY, 40));
const CAKE_DATE = openDay(addDays(TODAY, 44));
const CLASS_DATE = openDay(addDays(TODAY, 50));
const SOLD_OUT_DATE = openDay(addDays(CLASS_DATE, 1));
const PRIVATE_DATE = openDay(addDays(TODAY, 60));

let referrerOrderUrl = "";
let referralCode = "";

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

/** Design a default cake (6" round, $130) for a date and stop at the review step. */
async function toReview(page: Page, date: string, who: { name: string; email: string }) {
  await page.goto("/order");
  for (let i = 0; i < 6; i++) await next(page);
  await (await showDay(page, date)).click();
  await page.locator('[data-testid^="slot-"]:not([disabled])').first().click();
  await next(page);
  await page.getByLabel("Your name").fill(who.name);
  await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByLabel("Mobile").fill("0412 222 333");
  await next(page);
}

async function payAtTestCheckout(page: Page) {
  await expect(page).toHaveURL(/\/checkout\/test/);
  await page.getByTestId("test-pay").click();
}

test.describe.serial("phase 3", () => {
  test("a business orders logo cookies with a deposit, and it reaches the kitchen sheet", async ({ page }) => {
    await page.goto("/corporate");
    await page.getByTestId("pkg-corp-cookies-48").click();
    await page.getByTestId("corp-company").fill("Acme Pty Ltd");
    await page.getByTestId("corp-abn").fill("12 345 678 901");
    await page.getByTestId("corp-name").fill("Pat Lee");
    await page.getByTestId("corp-email").fill("pat@acme.example");
    await page.getByTestId("corp-phone").fill("0400 222 333");
    await page.getByTestId("corp-date").fill(CORP_DATE);
    await page.getByTestId("corp-slot-09:00").click();
    await page.getByTestId("corp-logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
    await page.getByTestId("corp-terms").check();
    await expect(page.getByTestId("corp-pay")).toHaveText("Pay 50% deposit $168");
    await page.getByTestId("corp-pay").click();
    await payAtTestCheckout(page);
    await expect(page.getByTestId("corp-status")).toHaveText("Confirmed");
    await expect(page.getByTestId("corp-paid")).toHaveText("$168");
    await expect(page.getByTestId("corp-balance")).toHaveText("$168");

    await adminLogin(page);
    await page.goto("/admin/corporate");
    await expect(page.getByTestId("corp-orders")).toContainText("Acme Pty Ltd");
    await expect(page.getByAltText("Acme Pty Ltd logo")).toBeVisible();
    await page.goto(`/admin/kitchen?view=day&date=${CORP_DATE}`);
    await expect(page.locator('[data-testid^="kitchen-CORP-"]').first()).toContainText("Logo cookies x 48 for Acme Pty Ltd");
  });

  test("a customer adds party add-ons and gets a referral code and stamp card", async ({ page }) => {
    await toReview(page, CAKE_DATE, { name: "Kim Lee", email: "kim.ref@example.com" });
    await page.getByTestId("addon-add-stand-hire").click();
    await page.getByTestId("addon-add-number-candle").click();
    await expect(page.getByTestId("review-lines")).toContainText("Refundable bond (stand hire)");
    // 130 + 15 stand + 4 candle + 20 bond = 169
    await expect(page.getByTestId("total")).toHaveText("$169");
    await page.getByTestId("accept-terms").check();
    await page.getByTestId("pay").click();
    await payAtTestCheckout(page);
    await expect(page.getByTestId("referral")).toContainText("Give $10, get $10");
    referralCode = (await page.getByTestId("referral-code").textContent())!.trim();
    expect(referralCode).toMatch(/^KIM-[A-Z2-9]{4}$/);
    await expect(page.getByTestId("stamp-card")).toContainText("Every 5th cake earns 6 iced cookies");
    await expect(page.getByTestId("msg-stand_return")).toBeVisible();
    referrerOrderUrl = page.url().split("?")[0];
  });

  test("a friend uses the referral code: $10 off for them, $10 credit for the referrer", async ({ page }) => {
    await toReview(page, CAKE_DATE, { name: "Lou Friend", email: "lou.friend@example.com" });
    await page.getByTestId("referral-input").fill(referralCode.toLowerCase());
    await page.getByTestId("accept-terms").check();
    await page.getByTestId("pay").click();
    await payAtTestCheckout(page);
    await expect(page.getByText("Referral discount")).toBeVisible();
    await expect(page.getByTestId("balance")).toHaveText("$60"); // $120 total, $60 deposit paid
    const credit = (await emailsTo(page, "kim.ref@example.com")).find((m) => m.subject.startsWith("Your $10 credit"));
    expect(credit?.text).toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/);

    // Using your own code is refused.
    await toReview(page, CAKE_DATE, { name: "Kim Lee", email: "kim.ref@example.com" });
    await page.getByTestId("referral-input").fill(referralCode);
    await page.getByTestId("accept-terms").check();
    await page.getByTestId("pay").click();
    await expect(page.getByRole("alert").filter({ hasText: "own referral code" })).toBeVisible();
  });

  test("after collection the customer reviews, Emily approves, and it shows on the home page", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin");
    await page.getByText("Kim Lee").first().click();
    await expect(page).toHaveURL(/\/admin\/orders\//);
    for (const stage of ["design_confirmed", "baking", "decorating", "ready", "collected"]) {
      await page.getByTestId("advance-stage").click();
      await expect(page.getByTestId("tracker")).toHaveAttribute("data-stage", stage);
    }
    const reviewHref = (await page.getByTestId("review-link").getAttribute("href"))!;
    await page.goto(new URL(reviewHref).pathname);
    await page.getByTestId("star-5").click();
    await page.getByTestId("review-text").fill("The stand made it! Beautiful cake.");
    await page.getByTestId("review-consent").check();
    await page.getByTestId("review-submit").click();
    await expect(page.getByTestId("review-thanks")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("review-done")).toBeVisible();

    await page.goto("/");
    await expect(page.getByTestId("home-reviews")).toHaveCount(0);
    await page.goto("/admin/reviews");
    const card = page.getByTestId("review-Kim L.");
    await expect(card.getByTestId("review-status")).toHaveText("pending");
    await card.getByTestId("review-approve").click();
    await expect(card.getByTestId("review-status")).toHaveText("approved");
    await page.goto("/");
    await expect(page.getByTestId("home-reviews")).toContainText("The stand made it! Beautiful cake.");
    await expect(page.getByTestId("home-reviews")).toContainText("Kim L.");
  });

  test("Emily schedules classes, a group books with the discount, and gets a ticket", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/classes");
    await page.getByTestId("series-type").selectOption("class-florals");
    await page.getByTestId("series-date").fill(CLASS_DATE);
    await page.getByTestId("series-time").fill("14:00");
    await page.getByTestId("series-count").fill("1");
    await page.getByTestId("series-create").click();
    await expect(page.getByTestId("series-msg")).toHaveText("Added 1 class.");
    await page.getByTestId("series-type").selectOption("class-drip");
    await page.getByTestId("series-date").fill(SOLD_OUT_DATE);
    await page.getByTestId("series-seats").fill("2");
    await page.getByTestId("series-count").fill("2");
    await page.getByTestId("series-every").selectOption("7");
    await page.getByTestId("series-preview").click();
    await expect(page.getByTestId("series-dates").locator("li")).toHaveCount(2);
    await page.getByTestId("series-count").fill("1");
    await page.getByTestId("series-create").click();
    await expect(page.getByTestId("series-msg")).toHaveText("Added 1 class.");
    await expect(page.getByTestId(`admin-session-${CLASS_DATE}`)).toBeVisible();

    await page.goto("/classes");
    const row = page.locator('[data-testid^="session-"]', { hasText: "Buttercream Florals" }).first();
    await expect(row.getByTestId("seats-left")).toHaveText("8 seats left");
    await row.getByTestId("book-session").click();
    await page.getByTestId("class-seats").selectOption("4");
    for (let i = 0; i < 4; i++) await page.getByTestId(`guest-name-${i}`).fill(`Guest ${i + 1}`);
    await page.getByTestId("guest-allergies-0").fill("Tree nuts");
    await page.getByTestId("class-contact").fill("Mia Hens");
    await page.getByTestId("class-email").fill("mia.hens@example.com");
    await page.getByTestId("class-phone").fill("0400 777 888");
    await page.getByTestId("class-terms").check();
    await expect(page.getByTestId("class-pay")).toBeDisabled(); // 18+ tick needed for a sip class
    await page.getByTestId("class-adult").check();
    await expect(page.getByTestId("class-total")).toHaveText("$342"); // 4 x $95 less 10%
    await page.getByTestId("class-pay").click();
    await payAtTestCheckout(page);
    await expect(page.getByTestId("ticket-status")).toHaveText("Booked");
    await expect(page.getByTestId("ticket-guests")).toContainText("Allergies: Tree nuts");
    const ics = await page.request.get((await page.getByTestId("add-to-calendar").getAttribute("href"))!);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    const body = await ics.text();
    expect(body).toContain(`DTSTART;TZID=Australia/Sydney:${CLASS_DATE.replace(/-/g, "")}T140000`);

    // Emily's guest list, check-in and printable class-day sheet.
    await adminLogin(page);
    await page.goto("/admin/classes");
    await page.getByTestId(`admin-session-${CLASS_DATE}`).click();
    await expect(page.getByTestId("guest-list")).toContainText("ALLERGIES: Tree nuts");
    await page.getByTestId("checkin-Guest 1").check();
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page.getByTestId("checkin-Guest 1")).toBeChecked();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("header").first()).toBeHidden();
    await expect(page.getByTestId("guest-list")).toBeVisible();
    await page.emulateMedia({ media: "screen" });

    // A class day takes no cake orders.
    const slots = await page.request.get(`/api/slots?date=${CLASS_DATE}`);
    expect((await slots.json()).bookable).toBe(false);
  });

  test("a sold-out class takes a waitlist, and a cancellation offers the seats", async ({ page }) => {
    await page.goto("/classes");
    const row = page.locator('[data-testid^="session-"]', { hasText: "Drip Cakes" }).first();
    await row.getByTestId("book-session").click();
    await page.getByTestId("class-seats").selectOption("2");
    await page.getByTestId("guest-name-0").fill("Ada");
    await page.getByTestId("guest-name-1").fill("Bo");
    await page.getByTestId("class-contact").fill("Ada Smith");
    await page.getByTestId("class-email").fill("ada@example.com");
    await page.getByTestId("class-phone").fill("0400 123 123");
    await page.getByTestId("class-adult").check();
    await page.getByTestId("class-terms").check();
    await page.getByTestId("class-pay").click();
    await payAtTestCheckout(page);

    await page.goto("/classes");
    const sold = page.locator('[data-testid^="session-"]', { hasText: "Drip Cakes" }).first();
    await expect(sold.getByTestId("seats-left")).toHaveText("Sold out");
    await sold.getByTestId("class-waitlist-open").click();
    await sold.getByLabel("Waitlist name").fill("Cy Wait");
    await sold.getByLabel("Waitlist email").fill("cy.wait@example.com");
    await sold.getByLabel("Waitlist mobile").fill("0400 999 000");
    await sold.getByTestId("class-waitlist-join").click();
    await expect(sold.getByTestId("class-waitlist-msg")).toContainText("number 1");

    await adminLogin(page);
    await page.goto("/admin/classes");
    await page.getByTestId(`admin-session-${SOLD_OUT_DATE}`).click();
    await expect(page.getByTestId("session-below-min")).toContainText("2 booked, minimum 4");
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("session-bookings").getByRole("button", { name: "Cancel booking" }).click();
    await expect(page.getByTestId("session-waitlist")).toContainText("offered");
    const offer = (await emailsTo(page, "cy.wait@example.com")).find((m) => m.subject.startsWith("Seats opened"))!;
    const link = /\/classes\/claim\/[A-Za-z0-9_-]{43}/.exec(offer.text)![0];
    await page.goto(link);
    await page.getByTestId("class-adult").check();
    await page.getByTestId("class-terms").check();
    await page.getByTestId("class-pay").click();
    await payAtTestCheckout(page);
    await expect(page.getByTestId("ticket-status")).toHaveText("Booked");
    await page.goto(link);
    await expect(page.getByTestId("class-claim-expired")).toBeVisible();
  });

  test("a private group request is accepted and the deposit paid", async ({ page }) => {
    await page.goto("/classes/private");
    await page.getByTestId("private-deluxe").click();
    await page.getByTestId("private-guests").fill("8");
    await expect(page.getByTestId("private-estimate")).toHaveText("Estimate $960, with a $150 deposit once Emily confirms.");
    await page.getByTestId("private-guests").fill("12");
    await expect(page.getByTestId("private-estimate")).toContainText("is for 6 to 10");
    await page.getByTestId("private-guests").fill("8");
    await page.getByTestId("private-date").fill(PRIVATE_DATE);
    await page.getByTestId("private-name").fill("Jo Park");
    await page.getByTestId("private-email").fill("jo.private@example.com");
    await page.getByTestId("private-phone").fill("0400 555 666");
    await page.getByTestId("private-submit").click();
    await expect(page.getByTestId("private-sent")).toContainText("is with Emily");

    await adminLogin(page);
    await page.goto("/admin/classes/private");
    await page.getByTestId("private-accept").first().click();
    await expect(page.getByTestId("private-status").first()).toHaveText("Accepted (deposit link sent)");
    const mail = (await emailsTo(page, "jo.private@example.com")).find((m) => m.subject.includes("pay the $150 deposit"))!;
    const pay = /\/p\/[A-Za-z0-9_-]{43}/.exec(mail.text)![0];
    await page.goto(pay);
    await page.getByTestId("private-pay").click();
    await payAtTestCheckout(page);
    await expect(page.getByTestId("private-paid")).toBeVisible();
  });

  test("Emily sees the sales snapshot and controls referrals and stamps", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/snapshot");
    await expect(page.getByTestId("snapshot")).toBeVisible();
    expect(Number(await page.getByTestId("this-orders").textContent())).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId("capacity").locator("li")).toHaveCount(4);
    await expect(page.getByTestId("balances")).toContainText("Lou Friend");

    await page.goto("/admin/referrals");
    await expect(page.getByTestId("referrals")).toContainText("Credit sent");
    await page.getByTestId("stamp-every").fill("6");
    await page.getByTestId("save-rewards").click();
    await expect(page.getByTestId("rewards-msg")).toHaveText("Saved.");
    await page.reload();
    await expect(page.getByTestId("stamp-every")).toHaveValue("6");
    await page.goto(referrerOrderUrl);
    await expect(page.getByTestId("stamp-card")).toContainText("Every 6th cake");
  });
});

test.describe("phase 3 at phone width (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("no sideways scrolling on the new screens", async ({ page }) => {
    for (const path of ["/", "/corporate", "/classes", "/classes/private"]) {
      await page.goto(path);
      await noSideScroll(page);
    }
    if (referrerOrderUrl) {
      await page.goto(referrerOrderUrl);
      await noSideScroll(page);
    }
    await page.request.post("/api/test-login");
    for (const path of ["/admin/classes", "/admin/classes/private", "/admin/corporate", "/admin/reviews", "/admin/referrals", "/admin/snapshot", "/admin/catalogue"]) {
      await page.goto(path);
      await noSideScroll(page);
    }
  });
});
