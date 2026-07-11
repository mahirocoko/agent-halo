import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("needs-input activity stays visible until the flow continues", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=attention");

  await expect(page.locator(".overlay-root")).toHaveAttribute("data-status", "attention");
  await expect(page.locator(".pill-detail")).toHaveText("Question");
  await expect(page.locator('.session-row[data-status="attention"]')).toBeVisible();
});

test("done activity collapses after its ambient signal window while the row remains", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=done");

  await expect(page.locator(".overlay-root")).toHaveAttribute("data-status", "closed");
  await expect(page.locator(".pill-detail")).toHaveText("Done");
  await expect(page.locator('.session-row[data-status="done"]')).toBeVisible();

  await expect(page.locator(".overlay-root")).toHaveAttribute("data-live", "false", { timeout: 10_000 });
  await expect(page.locator('.session-row[data-status="done"]')).toBeVisible();
});

test("old unfinished activity becomes inactive and does not occupy the notch", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=inactive");

  await expect(page.locator(".overlay-root")).toHaveAttribute("data-live", "false");
  await expect(page.locator('.session-row[data-status="inactive"]')).toBeVisible();
  await expect(page.getByText("Still?")).toHaveCount(0);
});
