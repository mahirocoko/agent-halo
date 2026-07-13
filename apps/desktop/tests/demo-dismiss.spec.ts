import { expect, test } from "@playwright/test";

const dismissedStorageKey = "agent-halo.dismissed-sessions";
const deletedStorageKey = "agent-halo.deleted-sessions";
const sessionEventsStorageKey = "agent-halo.session-events";

test("clear hides ended sessions until fresh activity resumes", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.evaluate((key) => window.localStorage.removeItem(key), dismissedStorageKey);
  await page.reload();

  const clearButton = page.getByRole("button", { name: /Clear completed .* session/ });
  await clearButton.waitFor({ state: "visible", timeout: 10_000 });
  await clearButton.click();

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

  await page.getByRole("button", { name: /Clear completed .* session/ }).waitFor({ state: "visible", timeout: 10_000 });
  await page.locator(".session-row-main").first().click();
  await page.getByRole("button", { name: "Remove history" }).click();
  await page.getByRole("button", { name: "Confirm remove" }).click();

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

test("completed session survives a quiet reload until explicitly cleared", async ({ page }) => {
  const timestamp = new Date(Date.now() - 60_000).toISOString();
  await page.route("http://127.0.0.1:47621/**", (route) => route.abort());
  await page.goto("/");
  await page.evaluate(
    ({ sessionKey, dismissedKey, deletedKey, eventTimestamp }) => {
      window.localStorage.setItem(sessionKey, JSON.stringify({
        "local-conv-quiet-done": [
          {
            version: 2,
            id: "quiet-done",
            timestamp: eventTimestamp,
            agentId: "agent-demo",
            agentName: "Mahiro Code",
            conversationId: "local-conv-quiet-done",
            cwd: "/Users/mahiro/ghq/github.com/mahirocoko/agent-halo",
            model: "gpt-5.6-sol",
            permissionMode: "unrestricted",
            type: "turn_complete",
            data: { hookEventName: "Stop", source: "hook", message: "Quiet completion" },
          },
        ],
      }));
      window.localStorage.removeItem(dismissedKey);
      window.localStorage.removeItem(deletedKey);
    },
    { sessionKey: sessionEventsStorageKey, dismissedKey: dismissedStorageKey, deletedKey: deletedStorageKey, eventTimestamp: timestamp },
  );

  await page.reload();
  await page.locator(".halo-surface").hover();
  await expect(page.locator('.session-row[data-status="done"]')).toBeVisible();
  await page.reload();
  await page.locator(".halo-surface").hover();
  await expect(page.locator('.session-row[data-status="done"]')).toBeVisible();
});
