import { expect, test, type Page } from "@playwright/test";

// A real 1x1 PNG, so the browser can decode and resize it.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
// The start of an MP4 file ("ftyp" box). Enough to pass the server's file check.
const MP4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

let orderUrl = "";

async function next(page: Page) {
  await page.getByTestId("next").click();
}

/** Click the first day in the calendar with the given state, moving forward a month if needed. */
async function pickDay(page: Page, state: "available" | "rush") {
  for (let i = 0; i < 3; i++) {
    await expect(page.locator('[data-testid^="day-"]').first()).toBeVisible();
    const day = page.locator(`[data-testid^="day-"][data-state="${state}"]`).first();
    if (await day.count()) {
      await day.click();
      return (await day.getAttribute("data-testid"))!.slice(4);
    }
    await page.getByTestId("next-month").click();
  }
  throw new Error(`No ${state} day found`);
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe.serial("ordering and admin", () => {
  test("customer designs a cake, pays the deposit and sees the tracker", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Custom celebration cakes");
    await page.getByRole("link", { name: "Design your cake" }).first().click();
    await expect(page).toHaveURL(/\/order$/);

    // Occasion and size
    await page.getByTestId("opt-occ-birthday").click();
    await next(page);
    await page.getByTestId("opt-size-8-round").click();
    await expect(page.getByTestId("total")).toHaveText("$170");
    await next(page);

    // Dietary filter disables clashing flavours and clears a clashing choice
    await expect(page.getByTestId("opt-fl-vanilla")).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Egg-free" }).click();
    await expect(page.getByTestId("opt-fl-vanilla")).toBeDisabled();
    await expect(page.getByTestId("opt-fl-vegan-chocolate")).toBeEnabled();
    await expect(page.getByTestId("builder-notice")).toContainText("Vanilla bean");
    await page.getByRole("button", { name: "Egg-free" }).click();
    await page.getByTestId("opt-fl-chocolate").click();
    await next(page);

    // Finish and colour, charged per tier
    await page.getByTestId("opt-fin-drip").click();
    await page.getByTestId("opt-col-sage").click();
    await expect(page.getByTestId("total")).toHaveText("$195");
    await next(page);

    // Decorations with a topper that shows in the preview
    await page.getByTestId("opt-dec-topper").click();
    await page.getByLabel("Topper name or message").fill("Mia");
    await expect(page.getByTestId("topper-text")).toHaveText("Mia");
    await expect(page.getByTestId("total")).toHaveText("$215");
    await next(page);
    await next(page); // no extras

    // Date and pickup slot
    await expect(page.getByTestId("next")).toBeDisabled();
    await pickDay(page, "available");
    await page.locator('[data-testid^="slot-"]:not([disabled])').first().click();
    await next(page);

    // Details
    await expect(page.getByTestId("next")).toBeDisabled();
    await page.getByLabel("Your name").fill("Jess Nguyen");
    await page.getByLabel("Email").fill("jess@example.com");
    await page.getByLabel("Mobile").fill("0412 345 678");
    await page.getByLabel("Allergies Emily should know about").fill("Tree nuts");
    await page.getByLabel("Inspiration photo (optional)").setInputFiles({ name: "idea.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("Added: idea.png")).toBeVisible();
    await next(page);

    // Review and pay
    await expect(page.getByTestId("review-lines")).toContainText("Script name topper");
    await expect(page.getByTestId("pay")).toBeDisabled();
    await page.getByTestId("accept-terms").check();
    await expect(page.getByTestId("pay")).toHaveText("Pay deposit $108");
    await page.getByTestId("pay").click();

    await expect(page).toHaveURL(/\/checkout\/test/);
    await page.getByTestId("test-pay").click();
    await expect(page).toHaveURL(/\/o\/[A-Za-z0-9_-]{43}\?paid=1$/);
    await expect(page.getByTestId("paid-banner")).toBeVisible();
    await expect(page.getByTestId("tracker")).toHaveAttribute("data-stage", "received");
    await expect(page.getByTestId("amount-paid")).toHaveText("$108");
    await expect(page.getByTestId("balance")).toHaveText("$107");
    orderUrl = page.url().split("?")[0];
  });

  test("Emily signs in, moves the order on and posts photo and video updates", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
    await page.getByTestId("test-login").click();
    await expect(page.getByTestId("admin-orders")).toContainText("Jess Nguyen");
    await expect(page.getByTestId("admin-orders")).toContainText("Allergies");
    await page.getByText("Jess Nguyen").click();

    await expect(page.getByText("Allergies: Tree nuts")).toBeVisible();
    await expect(page.getByAltText("Customer's inspiration")).toBeVisible();

    await page.getByTestId("advance-stage").click();
    await expect(page.getByTestId("tracker")).toHaveAttribute("data-stage", "design_confirmed");
    await page.getByTestId("advance-stage").click();
    await expect(page.getByTestId("tracker")).toHaveAttribute("data-stage", "baking");

    await page.getByTestId("update-file").setInputFiles({ name: "layers.png", mimeType: "image/png", buffer: PNG });
    await page.getByTestId("update-caption").fill("Layers are baked!");
    await page.getByTestId("post-update").click();
    await expect(page.getByText("Posted. The customer has been emailed.")).toBeVisible();
    await expect(page.getByTestId("admin-updates")).toContainText("Layers are baked!");

    await page.getByTestId("update-file").setInputFiles({ name: "decorating.mp4", mimeType: "video/mp4", buffer: MP4 });
    await page.getByTestId("update-caption").fill("Decorating now");
    await page.getByTestId("post-update").click();
    await expect(page.getByTestId("admin-updates")).toContainText("Decorating now");
    await expect(page.getByTestId("admin-updates").locator("video")).toHaveCount(1);

    // The customer sees it all
    await page.goto(orderUrl);
    await expect(page.getByTestId("tracker")).toHaveAttribute("data-stage", "baking");
    await expect(page.getByTestId("updates")).toContainText("Layers are baked!");
    await expect(page.getByTestId("updates").locator("img")).toHaveCount(1);
    await expect(page.getByTestId("updates").locator("video")).toHaveCount(1);
    await expect(page.getByTestId("updates")).toContainText("Your cake is in the oven.");
  });

  test("customer pays the balance", async ({ page }) => {
    await page.goto(orderUrl);
    await page.getByTestId("pay-balance").click();
    await expect(page).toHaveURL(/\/checkout\/test/);
    await page.getByTestId("test-pay").click();
    await expect(page.getByTestId("balance")).toHaveText("$0");
    await expect(page.getByTestId("pay-balance")).toHaveCount(0);
  });

  test("hiding an item removes it from the builder, and the last size can't be hidden", async ({ page }) => {
    await page.request.post("/api/test-login");
    await page.goto("/admin/catalogue");
    await page.getByTestId("visible-fl-chocolate").uncheck();
    await expect(page.getByTestId("item-fl-chocolate")).toContainText("Hidden");

    for (const id of ["size-8-round", "size-6-tall", "size-two-tier"]) {
      await page.getByTestId(`visible-${id}`).uncheck();
      await expect(page.getByTestId(`item-${id}`)).toContainText("Hidden");
    }
    await page.getByTestId("visible-size-6-round").uncheck();
    await expect(page.getByTestId("catalogue-error")).toHaveText("Keep at least one size visible.");
    await expect(page.getByTestId("visible-size-6-round")).toBeChecked();

    await page.goto("/order");
    await next(page);
    await expect(page.locator('[data-testid^="opt-size-"]')).toHaveCount(1);
    await next(page);
    await expect(page.getByTestId("opt-fl-vanilla")).toBeVisible();
    await expect(page.getByTestId("opt-fl-chocolate")).toHaveCount(0);

    // The existing order still shows its hidden flavour
    await page.goto(orderUrl);
    await expect(page.getByText("Chocolate mud")).toBeVisible();

    // Put things back for later tests
    await page.goto("/admin/catalogue");
    for (const id of ["fl-chocolate", "size-8-round", "size-6-tall", "size-two-tier"]) {
      await page.getByTestId(`visible-${id}`).check();
      await expect(page.getByTestId(`item-${id}`)).not.toContainText("Hidden");
    }
  });

  test("rush dates add the fee and take full payment", async ({ page }) => {
    await page.goto("/order");
    for (let i = 0; i < 6; i++) await next(page);
    await pickDay(page, "rush");
    await expect(page.getByTestId("deposit")).toContainText("Rush order: paid in full today (includes $40 rush fee)");
    await expect(page.getByTestId("total")).toHaveText("$170");
  });

  test("Emily's settings change the calendar", async ({ page }) => {
    await page.request.post("/api/test-login");
    await page.goto("/admin/settings");
    await page.getByTestId("daily-cap").fill("0");
    await page.getByTestId("save-settings").click();
    await expect(page.getByTestId("settings-msg")).toHaveText("Settings saved.");

    const month = new Date().toISOString().slice(0, 7);
    const res = await page.request.get(`/api/availability?month=${month}`);
    const data = (await res.json()) as { days: { bookable: boolean }[] };
    expect(data.days.every((d) => !d.bookable)).toBe(true);

    await page.getByTestId("daily-cap").fill("3");
    await page.getByTestId("save-settings").click();
    await expect(page.getByTestId("settings-msg")).toHaveText("Settings saved.");
  });

  test("private and protected routes stay private", async ({ page, request }) => {
    expect((await request.get("/o/not-a-real-token")).status()).toBe(404);
    expect((await request.get(`/o/${"a".repeat(43)}`)).status()).toBe(404);
    expect((await request.get("/api/cron/reminders")).status()).toBe(401);
    expect((await request.get("/api/cron/reminders", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
    expect((await request.post("/api/stripe/webhook", { data: "{}" })).status()).toBe(400);
    expect((await request.put("/api/test-upload?path=x", { data: "x" })).status()).toBe(401);
    const bad = await request.post("/api/orders", { multipart: { payload: JSON.stringify({ config: {} }) } });
    expect(bad.status()).toBe(400);
    await page.context().clearCookies();
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("the reminders job runs with the cron secret", async ({ request }) => {
    const res = await request.get("/api/cron/reminders", { headers: { authorization: "Bearer e2e-cron-secret-0123456789" } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

test.describe("phone width (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("no sideways scrolling on customer and admin screens", async ({ page }) => {
    await page.goto("/");
    await noSideScroll(page);
    await page.goto("/order");
    for (let step = 0; step < 6; step++) {
      await noSideScroll(page);
      await next(page);
    }
    await pickDay(page, "available");
    await page.locator('[data-testid^="slot-"]:not([disabled])').first().click();
    await noSideScroll(page);
    await next(page);
    await noSideScroll(page);
    await page.goto("/terms");
    await noSideScroll(page);
    await page.goto(orderUrl || "/");
    await noSideScroll(page);

    await page.request.post("/api/test-login");
    for (const path of ["/admin", "/admin/catalogue", "/admin/settings"]) {
      await page.goto(path);
      await noSideScroll(page);
    }
  });
});
