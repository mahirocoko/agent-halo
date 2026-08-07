import { expect, test } from "@playwright/test";

const stopwatchStorageKey = "agent-halo.stopwatch";
const stopwatchHistoryStorageKey = "agent-halo.stopwatch-history";
const pomodoroStorageKey = "agent-halo.pomodoro";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("agent-halo.stopwatch-test-ready") === "true") return;
    window.localStorage.clear();
    window.sessionStorage.setItem("agent-halo.stopwatch-test-ready", "true");
  });
});

test("Stopwatch model excludes paused time and finishes one history entry", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const model = await import("/src/features/stopwatch/model.ts");
    let state = model.createStopwatchState();
    state = model.startStopwatch(state, 1_000);
    state = model.pauseStopwatch(state, 61_000);
    state = model.startStopwatch(state, 121_000);
    return model.finishStopwatch(state, 151_000, "history-1");
  });

  expect(result).toMatchObject({
    state: { status: "idle", accumulatedMs: 0, runningSince: null, sessionStartedAt: null },
    entry: { id: "history-1", startedAt: 1_000, endedAt: 151_000, durationMs: 90_000 },
  });
});

test("Stopwatch history normalization rejects malformed entries, deduplicates, and keeps the newest 500", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const persistence = await import("/src/features/stopwatch/persistence.ts");
    const now = Date.now();
    const entries = Array.from({ length: 505 }, (_, index) => ({
      id: `entry-${index}`,
      startedAt: now - index * 2_000 - 1_000,
      endedAt: now - index * 2_000,
      durationMs: 1_000,
    }));
    const normalized = persistence.normalizeStopwatchHistory({
      schemaVersion: 1,
      entries: [
        { ...entries[0] },
        ...entries,
        { id: "future", startedAt: now, endedAt: now + 10 * 60_000, durationMs: 1_000 },
        { id: "backwards", startedAt: now, endedAt: now - 1, durationMs: 0 },
      ],
    }, now);
    return {
      length: normalized.entries.length,
      first: normalized.entries[0]?.id,
      last: normalized.entries.at(-1)?.id,
      unique: new Set(normalized.entries.map((entry) => entry.id)).size,
    };
  });

  expect(result).toEqual({ length: 500, first: "entry-0", last: "entry-499", unique: 500 });
});

test("Focus tool tabs support roving keyboard navigation", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Focus" }).click();
  const pomodoroTab = page.getByRole("tab", { name: /^Pomodoro/ });
  await pomodoroTab.focus();
  await page.keyboard.press("ArrowRight");

  const stopwatchTab = page.getByRole("tab", { name: /^Stopwatch/ });
  await expect(stopwatchTab).toBeFocused();
  await expect(stopwatchTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Stopwatch" })).toBeVisible();
});

test("Stopwatch and Pomodoro run together, persist, and share the collapsed Focus surface", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Focus" }).click();
  await page.getByRole("tab", { name: /^Stopwatch/ }).click();
  const stopwatchPanel = page.locator(".stopwatch-panel");

  await stopwatchPanel.getByRole("button", { name: "Start" }).click();
  await page.getByRole("tab", { name: /^Pomodoro/ }).click();
  const pomodoroPanel = page.locator(".pomodoro-panel");
  await pomodoroPanel.getByRole("button", { name: "Start" }).click();
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.status, stopwatchStorageKey)).toBe("running");
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.status, pomodoroStorageKey)).toBe("running");

  await page.locator(".halo-surface").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".pomodoro-pill-icon")).toBeVisible();
  await expect(page.locator(".pill-detail")).toHaveText(/2[45]:\d{2}/);
  await expect(page.locator(".stopwatch-pill-secondary")).toHaveText(/SW 00:\d{2}/);
  await expect(page.getByRole("button", { name: /Pomodoro|Focus.*Stopwatch/ })).toHaveAttribute("aria-label", /Stopwatch running/);

  await page.reload();
  await page.getByRole("tab", { name: "Focus" }).click();
  await expect(page.locator(".pomodoro-panel").getByText("Running")).toBeVisible();
  await page.getByRole("tab", { name: /^Stopwatch/ }).click();
  await expect(page.locator(".stopwatch-panel").getByText("Running")).toBeVisible();
});

test("Stopwatch actions never schedule notifications, summon Pet, or change Keep display awake", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as typeof window & { __stopwatchNativeCalls: string[] }).__stopwatchNativeCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push(command);
        if (command === "notification_permission_state") return "authorized";
        if (command === "cancel_pomodoro_notification") return true;
        if (command === "take_completion_pet_action") return null;
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  });

  await page.goto("/?demo=1&demoScenario=idle");
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as typeof window & { __stopwatchNativeCalls: string[] }).__stopwatchNativeCalls;
    return calls.includes("cancel_pomodoro_notification") && calls.includes("set_keep_awake");
  })).toBe(true);
  await page.evaluate(() => { (window as typeof window & { __stopwatchNativeCalls: string[] }).__stopwatchNativeCalls.length = 0; });
  await page.getByRole("tab", { name: "Focus" }).click();
  await page.getByRole("tab", { name: /^Stopwatch/ }).click();
  const stopwatchPanel = page.locator(".stopwatch-panel");
  await stopwatchPanel.getByRole("button", { name: "Start" }).click();
  await stopwatchPanel.getByRole("button", { name: "Pause" }).click();
  await stopwatchPanel.getByRole("button", { name: "Resume" }).click();
  await stopwatchPanel.getByRole("button", { name: "Finish" }).click();

  const nativeMutations = await page.evaluate(() => (window as typeof window & { __stopwatchNativeCalls: string[] }).__stopwatchNativeCalls.filter((command) => [
    "notification_permission_state",
    "request_notification_permission",
    "schedule_pomodoro_notification",
    "cancel_pomodoro_notification",
    "show_completion_pet",
    "set_keep_awake",
  ].includes(command)));
  expect(nativeMutations).toEqual([]);
});

test("Attention overrides Stopwatch while Stopwatch overrides ordinary agent work", async ({ page }) => {
  const now = Date.now();
  await page.addInitScript(([key, now]) => {
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      status: "running",
      accumulatedMs: 60_000,
      runningSince: now - 30_000,
      sessionStartedAt: now - 90_000,
    }));
  }, [stopwatchStorageKey, now] as const);

  await page.goto("/?demo=1&demoScenario=attention");
  await expect(page.locator(".stopwatch-pill-icon")).toHaveCount(0);
  await expect(page.locator('.activity-pet[data-status="attention"]')).toHaveCount(1);

  await page.goto("/?demo=1&demoScenario=long-llm");
  await expect(page.locator(".stopwatch-pill-icon")).toHaveCount(1);
  await expect(page.locator(".activity-pet")).toHaveCount(0);
  await expect(page.locator(".pill-detail")).toHaveText(/01:\d{2}/);
});

test("Finishing saves local history and clearing it leaves the current Stopwatch running", async ({ page }) => {
  const now = Date.now();
  await page.addInitScript(([key, now]) => {
    if (window.sessionStorage.getItem("agent-halo.stopwatch-history-seeded") === "true") return;
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      status: "paused",
      accumulatedMs: 90_000,
      runningSince: null,
      sessionStartedAt: now - 120_000,
    }));
    window.sessionStorage.setItem("agent-halo.stopwatch-history-seeded", "true");
  }, [stopwatchStorageKey, now] as const);

  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Focus" }).click();
  await page.getByRole("tab", { name: /^Stopwatch/ }).click();
  const stopwatchPanel = page.locator(".stopwatch-panel");
  await expect(stopwatchPanel.getByRole("timer")).toHaveText("00:01:30");
  await stopwatchPanel.getByRole("button", { name: "Finish" }).click();

  await expect(stopwatchPanel.getByText("Today")).toBeVisible();
  await expect(stopwatchPanel.locator(".stopwatch-history-group strong")).toHaveText("00:01:30");
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.entries?.length, stopwatchHistoryStorageKey)).toBe(1);

  await page.reload();
  await page.getByRole("tab", { name: "Focus" }).click();
  await page.getByRole("tab", { name: /^Stopwatch/ }).click();
  const restoredPanel = page.locator(".stopwatch-panel");
  await expect(restoredPanel.getByText("Today")).toBeVisible();
  await restoredPanel.getByRole("button", { name: "Start" }).click();
  await restoredPanel.getByRole("button", { name: "Clear all Stopwatch history" }).click();
  await restoredPanel.getByRole("button", { name: "Confirm clear all Stopwatch history" }).click();

  await expect(restoredPanel.getByText("Finished sessions will appear here.")).toBeVisible();
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.entries?.length, stopwatchHistoryStorageKey)).toBe(0);
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.status, stopwatchStorageKey)).toBe("running");
});

test("Discard requires confirmation and never creates history", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Focus" }).click();
  await page.getByRole("tab", { name: /^Stopwatch/ }).click();
  const stopwatchPanel = page.locator(".stopwatch-panel");
  await stopwatchPanel.getByRole("button", { name: "Start" }).click();
  await stopwatchPanel.getByRole("button", { name: "Discard current Stopwatch session" }).click();
  await expect(stopwatchPanel.getByRole("button", { name: "Confirm discard current Stopwatch session" })).toBeVisible();
  await stopwatchPanel.getByRole("button", { name: "Confirm discard current Stopwatch session" }).click();

  await expect(stopwatchPanel.getByRole("timer")).toHaveText("00:00:00");
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.status, stopwatchStorageKey)).toBe("idle");
  await expect(page.evaluate((key) => window.localStorage.getItem(key), stopwatchHistoryStorageKey)).resolves.toBeNull();
});
