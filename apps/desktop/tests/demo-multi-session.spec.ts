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
  const geometry = await page.evaluate(() => {
    const sheet = document.querySelector(".sheet-inner")?.getBoundingClientRect();
    const body = document.querySelector(".sheet-body") as HTMLElement | null;
    const row = document.querySelector(".session-row")?.getBoundingClientRect();
    const bodyRect = body?.getBoundingClientRect();
    return {
      contentInset: bodyRect && row ? bodyRect.right - row.right : -1,
      edgeInset: sheet && bodyRect ? sheet.right - bodyRect.right : -1,
      scrollable: body ? body.scrollHeight > body.clientHeight : false,
    };
  });
  expect(geometry.edgeInset).toBeGreaterThanOrEqual(8);
  expect(geometry.edgeInset).toBeLessThanOrEqual(16);
  expect(geometry.contentInset).toBeGreaterThanOrEqual(20);
  expect(geometry.scrollable).toBe(true);

  await completedSection.getByRole("button", { name: "Clear completed agent-halo session" }).first().click();
  await expect(completedSection.getByRole("button", { name: "Clear completed agent-halo session" })).toHaveCount(1);

  await page.getByRole("button", { name: "Clear completed", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm clear 2" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm clear 2" }).click();
  await expect(page.locator(".completed-section")).toHaveCount(0);
});

test("completed workspace group can clear all of its done children", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");

  await page.getByRole("button", { name: "Clear completed agent-halo group" }).click();

  const completedSection = page.locator(".completed-section");
  await expect(completedSection.getByRole("button", { name: "Clear completed agent-halo group" })).toHaveCount(0);
  await expect(completedSection.getByRole("button", { name: "Clear completed paoplew session" })).toBeVisible();
  await expect(page.locator('.session-section:not(.completed-section) .session-row[data-status="working"]')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => Object.keys(JSON.parse(window.localStorage.getItem("agent-halo.dismissed-sessions") ?? "{}")))).toEqual([
    "local-conv-demo-done-a",
    "local-conv-demo-done-b",
  ]);
});
