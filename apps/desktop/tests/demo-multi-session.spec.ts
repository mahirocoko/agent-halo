import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("agent-halo-test-storage-ready")) return;
    window.localStorage.clear();
    window.sessionStorage.setItem("agent-halo-test-storage-ready", "true");
  });
});

const seedInactiveGroup = async (page: import("@playwright/test").Page, mixed = false) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await page.evaluate(({ hasWorkingChild }) => {
    const now = Date.now();
    const old = new Date(now - 3_600_000).toISOString();
    const registry = Object.fromEntries(Array.from({ length: 6 }, (_, index) => {
      const conversationId = `local-conv-demo-inactive-${index + 1}`;
      return [conversationId, [
        {
          version: 2,
          id: `inactive-${index + 1}-llm`,
          timestamp: hasWorkingChild && index === 0 ? new Date(now).toISOString() : old,
          agentId: "agent-demo-mahiro-code",
          agentName: "Mahiro Code",
          conversationId,
          cwd: "/Users/mahiro/ghq/github.com/haabiz/admin-template",
          model: "gpt-5.6-sol",
          permissionMode: "unrestricted",
          type: "llm_start",
          data: { model: "gpt-5.6-sol", messageCount: 4, contextWindow: 200_000 },
        },
      ]];
    }));
    window.localStorage.setItem("agent-halo.session-events", JSON.stringify(registry));
  }, { hasWorkingChild: mixed });
  await page.goto("/?demo=1");
};

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
    const scroller = document.querySelector<HTMLElement>("[data-scroll-card='completed']");
    const row = scroller?.querySelector<HTMLElement>(".session-row");
    if (!scroller || !row) throw new Error("missing Completed card scroller or row");
    scroller.style.maxHeight = "100px";
    scroller.scrollTop = 48;
    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return {
      leftInset: rowRect.left - scrollerRect.left,
      rightInset: scrollerRect.right - rowRect.right,
      overflowY: getComputedStyle(scroller).overflowY,
      scrollTop: scroller.scrollTop,
      scrollable: scroller.scrollHeight > scroller.clientHeight,
      scrollbarWidth: scroller.offsetWidth - scroller.clientWidth,
    };
  });
  expect(geometry.leftInset).toBeGreaterThanOrEqual(12);
  expect(geometry.leftInset).toBeLessThanOrEqual(18);
  expect(geometry.rightInset).toBeGreaterThanOrEqual(12 + geometry.scrollbarWidth);
  expect(geometry.rightInset).toBeLessThanOrEqual(20 + geometry.scrollbarWidth);
  expect(geometry.overflowY).toBe("auto");
  expect(geometry.scrollable).toBe(true);
  expect(geometry.scrollTop).toBeGreaterThan(0);

  await completedSection.getByRole("button", { name: "Clear completed agent-halo session" }).first().click();
  await expect(completedSection.getByRole("button", { name: "Clear completed agent-halo session" })).toHaveCount(1);

  await page.getByRole("button", { name: "Clear completed", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm clear 2" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm clear 2" }).click();
  await expect(page.locator(".completed-section")).toHaveCount(0);
});

test("narrow grouped row preserves its project name and wrapped pills", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 440 });
  await page.goto("/?demo=1&demoScenario=multi");
  await page.waitForTimeout(350);

  const geometry = await page.locator(".session-group-main").evaluate((group) => {
    const row = group.closest<HTMLElement>(".session-row")!;
    const title = group.querySelector<HTMLElement>(".session-title-line")!;
    const project = group.querySelector<HTMLElement>(".session-project")!;
    const count = group.querySelector<HTMLElement>(".session-group-count")!;
    const status = group.querySelector<HTMLElement>(".session-inline-status")!;
    const signal = group.querySelector<HTMLElement>(".halo-pet-signal")!.getBoundingClientRect();
    const activity = group.querySelector<HTMLElement>(".session-activity")!.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const countRect = count.getBoundingClientRect();
    const statusRect = status.getBoundingClientRect();

    return {
      projectClientWidth: project.clientWidth,
      projectScrollWidth: project.scrollWidth,
      projectText: project.textContent,
      rowClientWidth: row.clientWidth,
      rowScrollWidth: row.scrollWidth,
      signalActivityGap: activity.left - signal.right,
      pillsContained:
        countRect.right <= titleRect.right &&
        countRect.bottom <= titleRect.bottom &&
        statusRect.right <= titleRect.right &&
        statusRect.bottom <= titleRect.bottom,
    };
  });

  expect(geometry.projectText).toBe("agent-halo");
  expect(geometry.projectClientWidth).toBeGreaterThanOrEqual(50);
  expect(geometry.projectScrollWidth).toBeLessThanOrEqual(geometry.projectClientWidth);
  expect(geometry.pillsContained).toBe(true);
  expect(geometry.signalActivityGap).toBeGreaterThanOrEqual(4);
  expect(geometry.rowScrollWidth).toBeLessThanOrEqual(geometry.rowClientWidth);
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

test("inactive workspace group requires confirmation before removing every child", async ({ page }) => {
  await seedInactiveGroup(page);

  const removeGroup = page.getByRole("button", { name: "Remove 6 inactive admin-template sessions" });
  await expect(removeGroup).toBeVisible();
  await removeGroup.focus();
  await removeGroup.press("Enter");

  const confirmRemove = page.getByRole("button", { name: "Confirm remove 6 inactive admin-template sessions" });
  await expect(confirmRemove).toBeVisible();
  await expect(confirmRemove).toBeFocused();
  await expect(confirmRemove).toContainText("Remove 6");
  await expect.poll(async () => page.evaluate(() => Object.keys(JSON.parse(window.localStorage.getItem("agent-halo.deleted-sessions") ?? "{}")))).toEqual([]);

  await confirmRemove.click();

  await expect(page.getByRole("button", { name: "Expand admin-template, 6 sessions" })).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => ({
    deleted: Object.keys(JSON.parse(window.localStorage.getItem("agent-halo.deleted-sessions") ?? "{}")).sort(),
    sessions: Object.keys(JSON.parse(window.localStorage.getItem("agent-halo.session-events") ?? "{}")).filter((conversationId) => conversationId.startsWith("local-conv-demo-inactive")),
  }))).toEqual({
    deleted: [
      "local-conv-demo-inactive-1",
      "local-conv-demo-inactive-2",
      "local-conv-demo-inactive-3",
      "local-conv-demo-inactive-4",
      "local-conv-demo-inactive-5",
      "local-conv-demo-inactive-6",
    ],
    sessions: [],
  });
});

test("workspace group with a working child never exposes destructive group removal", async ({ page }) => {
  await seedInactiveGroup(page, true);

  await expect(page.getByRole("button", { name: "Expand admin-template, 6 sessions" })).toBeVisible();
  await expect(page.getByRole("button", { name: /inactive admin-template sessions/ })).toHaveCount(0);
  await expect(page.locator('.session-row.session-group[data-status="working"]')).toBeVisible();
});

test("inactive group removal disarms when leaving the Sessions context", async ({ page }) => {
  await seedInactiveGroup(page);

  await page.getByRole("button", { name: "Remove 6 inactive admin-template sessions" }).click();
  await expect(page.getByRole("button", { name: "Confirm remove 6 inactive admin-template sessions" })).toBeVisible();

  await page.getByRole("tab", { name: "Focus" }).click();
  await page.getByRole("tab", { name: "Sessions" }).click();

  await expect(page.getByRole("button", { name: "Remove 6 inactive admin-template sessions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm remove 6 inactive admin-template sessions" })).toHaveCount(0);
});
