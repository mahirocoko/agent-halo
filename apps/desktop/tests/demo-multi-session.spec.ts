import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("grouped completed workspace exposes every child session and guarded clear", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");

  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await expect(page.locator('.session-row[data-status="done"]')).toHaveCount(2);
  await expect(page.locator('li[role="button"]')).toHaveCount(0);

  const expandGroup = page.getByRole("button", { name: "Expand agent-halo, 2 sessions" });
  await expandGroup.click();
  const completedSection = page.locator(".completed-section");
  await expect(completedSection.locator(".session-child-row")).toHaveCount(2);
  await expect(completedSection.getByRole("button", { name: "Focus agent-halo session in Ghostty" })).toHaveCount(2);
  await expect(completedSection.getByRole("button", { name: "Clear completed agent-halo session" })).toHaveCount(2);

  await completedSection.getByRole("button", { name: "Clear completed agent-halo session" }).first().click();
  await expect(completedSection.getByRole("button", { name: "Clear completed agent-halo session" })).toHaveCount(1);

  await page.getByRole("button", { name: "Clear completed", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm clear 2" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm clear 2" }).click();
  await expect(page.locator(".completed-section")).toHaveCount(0);
});
