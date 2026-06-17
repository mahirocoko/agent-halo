import { expect, test } from "@playwright/test";

const dismissedStorageKey = "agent-halo.dismissed-sessions";

test("dismissed ended sessions stay hidden after reload", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.evaluate((key) => window.localStorage.removeItem(key), dismissedStorageKey);
  await page.reload();

  await page.getByTitle("Dismiss session").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTitle("Dismiss session").click();

  await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), dismissedStorageKey)).toContain("local-conv-demo-1");

  await page.reload();
  await expect(page.getByText("Waiting for Letta Code")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTitle("Dismiss session")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
});
