import { expect, test } from "@playwright/test";

const sessionEventsStorageKey = "agent-halo.session-events";

test("long in-flight model and tool work remain active beyond 30 seconds", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=long-llm");
  await expect(page.locator(".overlay-root")).toHaveAttribute("data-running", "true");
  await expect(page.locator('.session-row[data-status="working"]')).toBeVisible();

  await page.goto("/?demo=1&demoScenario=long-tool");
  await expect(page.locator(".overlay-root")).toHaveAttribute("data-running", "true");
  await expect(page.locator('.session-row[data-status="working"]')).toBeVisible();
});

test("missing model terminal event eventually becomes inactive", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=inactive");
  await expect(page.locator(".overlay-root")).toHaveAttribute("data-running", "false");
  await expect(page.locator('.session-row[data-status="inactive"]')).toBeVisible();
});

test("legacy default registry events migrate into stable per-agent sessions", async ({ page }) => {
  await page.route("http://127.0.0.1:47621/**", (route) => route.abort());
  await page.goto("/");
  const timestamp = new Date(Date.now() - 60_000).toISOString();
  await page.evaluate(
    ({ key, eventTimestamp }) => {
      const event = (id: string, agentId: string, cwd: string) => ({
        version: 2,
        id,
        timestamp: eventTimestamp,
        agentId,
        agentName: "Letta Code",
        conversationId: "default",
        cwd,
        model: "gpt-5.6-sol",
        permissionMode: "unrestricted",
        type: "conversation_close",
        data: { reason: "complete" },
      });
      window.localStorage.setItem(key, JSON.stringify({
        default: [
          event("fallback-a", "agent-fallback-a", "/tmp/project-a"),
          event("fallback-b", "agent-fallback-b", "/tmp/project-b"),
        ],
      }));
    },
    { key: sessionEventsStorageKey, eventTimestamp: timestamp },
  );

  await page.reload();
  await page.locator(".halo-surface").hover();
  await expect(page.locator('.session-row[data-status="done"]')).toHaveCount(2);
  await expect.poll(async () => page.evaluate((key) => Object.keys(JSON.parse(window.localStorage.getItem(key) ?? "{}")), sessionEventsStorageKey)).toEqual([
    "agent:agent-fallback-a",
    "agent:agent-fallback-b",
  ]);
});
