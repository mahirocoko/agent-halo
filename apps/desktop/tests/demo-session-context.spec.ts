import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("overview uses dense trusted metadata and contextual Focus", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=long-llm");

  const row = page.locator('.session-row[data-status="working"]');
  await expect(row.locator(".session-project")).toHaveText("agent-halo");
  await expect(row.locator(".session-inline-status")).toHaveText("Working");
  await expect(row.locator(".session-activity")).toHaveText("gpt-5.6-sol");
  await expect(row.locator(".session-model")).toHaveText("gpt-5.6-sol");
  await expect(page.getByText("LC", { exact: true })).toHaveCount(0);

  const focus = row.getByRole("button", { name: "Focus agent-halo session in Ghostty" });
  await expect(focus).toHaveCSS("opacity", "0");
  await row.hover();
  await expect(focus).toHaveCSS("opacity", "1");
});

test("trusted Herdr runtime identity changes the focus target without claiming Letta process control", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=herdr");

  const row = page.locator('.session-row[data-status="working"]');
  const focus = row.getByRole("button", { name: "Focus agent-halo session in Herdr" });
  await row.hover();
  await expect(focus).toBeVisible();
  await expect(focus).toHaveAttribute("title", "Focus exact Herdr pane");
});

test("working session replaces overview with a truthful context view", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=long-llm");

  await page.locator(".session-row-main").click();
  const context = page.locator('.session-context-view[data-status="working"]');
  await expect(context).toBeVisible();
  await expect(context.locator("#session-context-title")).toHaveText("Model is working");
  await expect(context.locator(".session-context-detail")).toHaveText("gpt-5.6-sol");
  await expect(page.getByRole("button", { name: "Back to all 1 session" })).toBeVisible();

  await page.getByRole("button", { name: "Back to all 1 session" }).click();
  await expect(page.locator('.session-row[data-status="working"]')).toBeVisible();
});

test("attention context reports a question without inventing answer controls", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=attention");

  await page.locator(".session-row-main").click();
  const context = page.locator('.session-context-view[data-status="attention"]');
  await expect(context.locator("#session-context-title")).toHaveText("Question requested");
  await expect(context.locator(".session-context-detail")).toHaveText("Question");
  await expect(page.getByRole("button", { name: /Allow|Deny|Bypass/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to all 1 session" })).toBeVisible();
});

test("done and error sessions use distinct truthful context states", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=done");
  await page.locator(".session-row-main").click();
  await expect(page.locator('.session-context-view[data-status="done"] #session-context-title')).toHaveText("Turn completed");
  await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();

  await page.goto("/?demo=1&demoScenario=error");
  await page.locator(".session-row-main").click();
  const errorContext = page.locator('.session-context-view[data-status="error"]');
  await expect(errorContext.locator("#session-context-title")).toHaveText("Activity failed");
  await expect(errorContext.locator(".session-context-detail")).toContainText("Provider request failed");
  await expect(page.getByRole("button", { name: "Clear" })).toHaveCount(0);
});
