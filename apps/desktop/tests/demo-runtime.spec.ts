import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("runtime tab separates Letta host pressure from child processes", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");
  await page.getByRole("tab", { name: "Runtime" }).click();

  await expect(page.getByRole("tabpanel", { name: "Runtime" })).toBeVisible();
  await expect(page.getByText("Local host and child-process pressure")).toBeVisible();
  await expect(page.locator(".runtime-row")).toHaveCount(4);
  await expect(page.locator(".runtime-row[data-pressure=critical]")).toHaveCount(2);
  await expect(page.locator(".runtime-row").first()).toContainText("Letta");
  await expect(page.locator(".runtime-row").first()).toContainText("Subprocesses");
  await expect(page.locator(".runtime-pressure-label").first()).toBeVisible();
  await expect(page.locator(".runtime-row").first()).toContainText("PID");
  await expect(page.getByText("Read-only · 100% CPU equals one logical core · no process controls")).toBeVisible();

  await page.getByRole("button", { name: "Hide unavailable runtime row for paoplew" }).click();
  await expect(page.locator(".runtime-row")).toHaveCount(3);
  await page.getByRole("button", { name: "Refresh runtime metrics" }).click();
  await expect(page.locator(".runtime-row")).toHaveCount(4);
});

test("runtime list stays readable at narrow width and reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?demo=1&demoScenario=multi");
  await page.getByRole("tab", { name: "Runtime" }).click();

  const panel = page.getByRole("tabpanel", { name: "Runtime" });
  await expect(panel).toBeVisible();
  await expect(page.locator(".runtime-toolbar .is-spinning")).toHaveCount(0);
  const row = page.locator(".runtime-row").first();
  await expect(row).toContainText("Letta");
  await expect(row).toContainText("Subprocesses");
  const [panelBox, rowBox] = await Promise.all([panel.boundingBox(), row.boundingBox()]);
  expect(panelBox).not.toBeNull();
  expect(rowBox).not.toBeNull();
  expect(rowBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
  expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
});
