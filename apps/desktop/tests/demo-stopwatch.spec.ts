import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const openFocusTools = async (page: Page) => {
  await page.getByRole("tab", { name: "Focus" }).click();
};

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

test("Focus renders Pomodoro, Stopwatch, and Move concurrently without a nested tablist", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await openFocusTools(page);

  await expect(page.locator(".focus-tool-card")).toHaveCount(3);
  await expect(page.locator(".pomodoro-panel")).toBeVisible();
  await expect(page.locator(".stopwatch-panel")).toBeVisible();
  await expect(page.locator(".focus-movement-launcher")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Focus tools" })).toHaveCount(0);
});

test("Focus Move launcher stays concise while disabling unavailable manual actions", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("agent-halo.completion-pet-enabled", "false");
    window.localStorage.setItem("agent-halo.movement-break-enabled", "false");
  });
  await page.goto("/?demo=1&demoScenario=idle");
  await openFocusTools(page);

  await expect(page.locator(".focus-movement-launcher").getByRole("heading", { name: "Move" })).toBeVisible();
  await expect(page.getByText("Movement breaks need the desktop runtime.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start 10 Squats movement break" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Start 10 Overhead Reaches movement break" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Show Pet" })).toBeDisabled();
});

test("Focus Move launcher manually summons schema-v2 companions without notifications or Pomodoro mutation", async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem("agent-halo.completion-pet-enabled", "false");
    window.localStorage.setItem("agent-halo.movement-break-enabled", "false");
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      phase: "focus",
      status: "idle",
      completedFocusSessions: 0,
      phaseDurationMs: 25 * 60_000,
      remainingMs: 25 * 60_000,
      endsAt: null,
      runId: null,
      notificationScheduled: false,
      lastCompletion: null,
    }));
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __manualMoveCalls: typeof calls }).__manualMoveCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "show_completion_pet") return true;
        if (command === "take_completion_pet_action") return null;
        if (command === "notification_permission_state") return "authorized";
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  }, pomodoroStorageKey);

  await page.goto("/?demo=1&demoScenario=idle");
  await openFocusTools(page);
  await expect(page.locator(".focus-movement-launcher").getByRole("heading", { name: "Move" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start 10 Squats movement break" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Start 10 Overhead Reaches movement break" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Show Pet" })).toBeEnabled();
  const pomodoroBefore = await page.evaluate((key) => window.localStorage.getItem(key), pomodoroStorageKey);
  await page.evaluate(() => { (window as typeof window & { __manualMoveCalls: Array<unknown> }).__manualMoveCalls.length = 0; });

  await page.getByRole("button", { name: "Start 10 Squats movement break" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __manualMoveCalls: Array<{ command: string }> }).__manualMoveCalls.filter((call) => call.command === "show_completion_pet").length)).toBe(1);
  await page.getByRole("button", { name: "Start 10 Overhead Reaches movement break" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __manualMoveCalls: Array<{ command: string }> }).__manualMoveCalls.filter((call) => call.command === "show_completion_pet").length)).toBe(2);
  await page.getByRole("button", { name: "Show Pet" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __manualMoveCalls: Array<{ command: string }> }).__manualMoveCalls.filter((call) => call.command === "show_completion_pet").length)).toBe(3);

  const calls = await page.evaluate(() => (window as typeof window & { __manualMoveCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__manualMoveCalls);
  const shows = calls.filter((call) => call.command === "show_completion_pet");
  expect(shows.map((call) => (call.args?.summon as Record<string, unknown>)?.requestedExerciseId)).toEqual(["squat", "overhead-reach", undefined]);
  for (const show of shows) {
    expect(show.args?.summon).toMatchObject({ schemaVersion: 2, purpose: "manual-companion", pet: "halo-bot", loadout: "3051", petSize: "large", nextPhase: null });
    expect(show.args?.projection).toMatchObject({ schemaVersion: 2, summon: { purpose: "manual-companion", nextPhase: null } });
  }
  expect((shows[2]?.args?.summon as Record<string, unknown>) ?? {}).not.toHaveProperty("requestedExerciseId");
  expect(calls.filter((call) => ["notification_permission_state", "request_notification_permission", "schedule_pomodoro_notification", "cancel_pomodoro_notification"].includes(call.command))).toEqual([]);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), pomodoroStorageKey)).toBe(pomodoroBefore);
});

test("Pet Open Focus action activates and focuses the main Focus tab", async ({ page }) => {
  await page.addInitScript(() => {
    let pendingAction: Record<string, unknown> | null = null;
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __openFocusCalls: typeof calls; __queueOpenFocus: () => void }).__openFocusCalls = calls;
    (window as typeof window & { __queueOpenFocus: () => void }).__queueOpenFocus = () => {
      pendingAction = { action: "open-focus", summonId: "manual-focus", nextPhase: null };
    };
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "take_completion_pet_action") {
          const action = pendingAction;
          pendingAction = null;
          return action;
        }
        if (command === "notification_permission_state") return "authorized";
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  });
  await page.goto("/?demo=1&demoScenario=idle");
  await page.evaluate(() => (window as typeof window & { __queueOpenFocus: () => void }).__queueOpenFocus());
  const focusTab = page.getByRole("tab", { name: "Focus" });
  await expect(focusTab).toBeVisible();
  await expect(focusTab).toHaveAttribute("aria-selected", "true");
  await expect(focusTab).toBeFocused();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __openFocusCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__openFocusCalls.some((call) => call.command === "set_panel_open" && call.args?.open === true && call.args?.focus === true))).toBe(true);
});

test("Focus cards stack in DOM order without horizontal overflow at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 440 });
  await page.goto("/?demo=1&demoScenario=idle");
  await openFocusTools(page);
  await expect.poll(() => page.locator(".halo-surface").evaluate((surface) => Number.parseFloat(getComputedStyle(surface).height))).toBe(440);
  const geometry = await page.getByTestId("focus-tools-tray").evaluate((tray) => {
    const cards = [...tray.querySelectorAll<HTMLElement>(".focus-tool-card")];
    return {
      order: cards.map((card) => card.querySelector<HTMLElement>("[data-focus-card]")?.dataset.focusCard),
      tops: cards.map((card) => card.getBoundingClientRect().top),
      overflowY: getComputedStyle(tray).overflowY,
      horizontalOverflow: tray.scrollWidth > tray.clientWidth + 1,
      nestedScrollers: cards.filter((card) => {
        const scroller = card.querySelector<HTMLElement>("[data-scroll-owner='inner']")!;
        return ["auto", "scroll"].includes(getComputedStyle(scroller).overflowY);
      }).length,
    };
  });
  expect(geometry.order).toEqual(["pomodoro", "stopwatch", "move"]);
  expect(geometry.tops[0]).toBeLessThan(geometry.tops[1]);
  expect(geometry.tops[1]).toBeLessThan(geometry.tops[2]);
  expect(geometry.overflowY).toBe("auto");
  expect(geometry.horizontalOverflow).toBe(false);
  expect(geometry.nestedScrollers).toBe(0);
});

test("wide Stopwatch keeps its timer fixed while long history owns scrolling", async ({ page }) => {
  await page.addInitScript((key) => {
    const now = Date.now();
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      entries: Array.from({ length: 40 }, (_, index) => ({
        id: `scroll-entry-${index}`,
        startedAt: now - index * 120_000 - 60_000,
        endedAt: now - index * 120_000,
        durationMs: 60_000,
      })),
    }));
  }, stopwatchHistoryStorageKey);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/?demo=1&demoScenario=idle");
  await openFocusTools(page);

  const geometry = await page.locator(".focus-tool-card-stopwatch").evaluate((card) => {
    const owner = card.querySelector<HTMLElement>("[data-scroll-owner='inner']")!;
    const timer = card.querySelector<HTMLElement>("[role='timer']")!;
    const history = card.querySelector<HTMLElement>(".stopwatch-history-list")!;
    const timerTop = timer.getBoundingClientRect().top;
    history.scrollTop = 120;
    return {
      ownerOverflow: getComputedStyle(owner).overflowY,
      historyOverflow: getComputedStyle(history).overflowY,
      historyCanScroll: history.scrollHeight > history.clientHeight,
      historyScrollTop: history.scrollTop,
      timerStayedFixed: timer.getBoundingClientRect().top === timerTop,
    };
  });

  expect(geometry.ownerOverflow).toBe("hidden");
  expect(geometry.historyOverflow).toBe("auto");
  expect(geometry.historyCanScroll).toBe(true);
  expect(geometry.historyScrollTop).toBeGreaterThan(0);
  expect(geometry.timerStayedFixed).toBe(true);
});

test("Stopwatch and Pomodoro run together, persist, and share the collapsed Focus surface", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await openFocusTools(page);
  const stopwatchPanel = page.locator(".stopwatch-panel");

  await stopwatchPanel.getByRole("button", { name: "Start" }).click();
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
  await openFocusTools(page);
  await expect(page.locator(".pomodoro-panel").getByText("Running")).toBeVisible();
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
  await openFocusTools(page);
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
  await openFocusTools(page);
  const stopwatchPanel = page.locator(".stopwatch-panel");
  await expect(stopwatchPanel.getByRole("timer")).toHaveText("00:01:30");
  await stopwatchPanel.getByRole("button", { name: "Finish" }).click();

  await expect(stopwatchPanel.getByText("Today")).toBeVisible();
  await expect(stopwatchPanel.locator(".stopwatch-history-group strong")).toHaveText("00:01:30");
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.entries?.length, stopwatchHistoryStorageKey)).toBe(1);

  await page.reload();
  await openFocusTools(page);
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
  await openFocusTools(page);
  const stopwatchPanel = page.locator(".stopwatch-panel");
  await stopwatchPanel.getByRole("button", { name: "Start" }).click();
  await stopwatchPanel.getByRole("button", { name: "Discard current Stopwatch session" }).click();
  await expect(stopwatchPanel.getByRole("button", { name: "Confirm discard current Stopwatch session" })).toBeVisible();
  await stopwatchPanel.getByRole("button", { name: "Confirm discard current Stopwatch session" }).click();

  await expect(stopwatchPanel.getByRole("timer")).toHaveText("00:00:00");
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.status, stopwatchStorageKey)).toBe("idle");
  await expect(page.evaluate((key) => window.localStorage.getItem(key), stopwatchHistoryStorageKey)).resolves.toBeNull();
});
