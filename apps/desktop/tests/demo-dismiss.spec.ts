import { expect, test } from "@playwright/test";

const dismissedStorageKey = "agent-halo.dismissed-sessions";

test("dismiss hides ended sessions until fresh activity resumes", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.evaluate((key) => window.localStorage.removeItem(key), dismissedStorageKey);
  await page.reload();

  await page.getByTitle("Dismiss session").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTitle("Dismiss session").click();

  await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), dismissedStorageKey)).toContain("local-conv-demo-1");
  await expect(page.getByText("Waiting for Letta Code")).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), dismissedStorageKey), { timeout: 10_000 }).not.toContain("local-conv-demo-1");
  await expect(page.getByText("agent-halo").first()).toBeVisible({ timeout: 10_000 });
});
