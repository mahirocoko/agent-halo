import { expect, test } from "@playwright/test";

const dismissedStorageKey = "agent-halo.dismissed-sessions";
const deletedStorageKey = "agent-halo.deleted-sessions";
const sessionEventsStorageKey = "agent-halo.session-events";

test("dismiss hides ended sessions until fresh activity resumes", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.evaluate((key) => window.localStorage.removeItem(key), dismissedStorageKey);
  await page.reload();

  await page.getByRole("button", { name: "Dismiss session" }).waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("button", { name: "Dismiss session" }).click();

  await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), dismissedStorageKey)).toContain("local-conv-demo-1");
  await expect(page.getByText("Waiting for Letta Code")).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect.poll(async () => page.evaluate((key) => window.localStorage.getItem(key), dismissedStorageKey), { timeout: 10_000 }).not.toContain("local-conv-demo-1");
  await expect(page.getByText("agent-halo").first()).toBeVisible({ timeout: 10_000 });
});

test("delete removes a stuck session registry locally", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.evaluate(
    ([dismissedKey, deletedKey, sessionKey]) => {
      window.localStorage.removeItem(dismissedKey);
      window.localStorage.removeItem(deletedKey);
      window.localStorage.removeItem(sessionKey);
    },
    [dismissedStorageKey, deletedStorageKey, sessionEventsStorageKey],
  );
  await page.reload();

  await page.getByRole("button", { name: "Dismiss session" }).waitFor({ state: "visible", timeout: 10_000 });
  await page.locator(".session-row").first().click();
  await page.getByRole("button", { name: "Delete" }).click();

  await expect.poll(async () =>
    page.evaluate(
      ([deletedKey, sessionKey]) => {
        const deleted = JSON.parse(window.localStorage.getItem(deletedKey) ?? "{}");
        const sessions = JSON.parse(window.localStorage.getItem(sessionKey) ?? "{}");
        return {
          deleted: typeof deleted["local-conv-demo-1"] === "number",
          hasSessionEvents: Object.hasOwn(sessions, "local-conv-demo-1"),
        };
      },
      [deletedStorageKey, sessionEventsStorageKey],
    ),
  ).toEqual({ deleted: true, hasSessionEvents: false });
});
