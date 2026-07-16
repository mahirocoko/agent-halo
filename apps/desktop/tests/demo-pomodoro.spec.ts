import { expect, test } from "@playwright/test";

const storageKey = "agent-halo.pomodoro";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("agent-halo.pomodoro-test-ready") === "true") return;
    window.localStorage.clear();
    window.sessionStorage.setItem("agent-halo.pomodoro-test-ready", "true");
  });
});

test("Pomodoro model grants a long break after four completed focus sessions", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const model = await import("/src/features/pomodoro/model.ts");
    let state = model.createPomodoroState();
    for (let focus = 0; focus < 4; focus += 1) {
      state = model.startPomodoro(state, focus * 10_000, `focus-${focus}`);
      state = model.completePomodoro(state, state.endsAt ?? 0);
      if (focus < 3) {
        state = model.startPomodoro(state, focus * 10_000 + 1, `break-${focus}`);
        state = model.completePomodoro(state, state.endsAt ?? 0);
      }
    }
    return {
      phase: state.phase,
      completed: state.completedFocusSessions,
      remaining: state.remainingMs,
      countdown: model.formatPomodoroCountdown(state.remainingMs),
    };
  });

  expect(result).toEqual({ phase: "long-break", completed: 4, remaining: 15 * 60 * 1_000, countdown: "15:00" });
});

test("Long break keeps the completed four-session cycle visible", async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      phase: "long-break",
      status: "idle",
      completedFocusSessions: 4,
      remainingMs: 15 * 60 * 1_000,
      endsAt: null,
      runId: null,
      notificationScheduled: false,
      lastCompletion: null,
    }));
  }, storageKey);
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  await expect(page.locator('.pomodoro-cycle-dot[data-complete="true"]')).toHaveCount(4);
  await expect(page.getByText("4 / 4")).toBeVisible();
});

test("Pomodoro tab starts, pauses, resumes, resets, skips, and persists", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  const panel = page.getByRole("tabpanel", { name: "Pomodoro" });
  await expect(panel.getByRole("timer")).toHaveText(/25:00/);
  await expect(panel.getByText("Focus").first()).toBeVisible();
  await expect(panel.getByRole("button", { name: "Reset" })).toBeDisabled();

  await panel.getByRole("button", { name: "Start" }).click();
  await expect(panel.getByText("Running")).toBeVisible();
  await expect(panel.getByText("Focus").first()).toBeVisible();
  await expect(panel.getByText("Next · Short break")).toBeVisible();
  await expect(panel.getByText("Focus cycle")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Reset" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Skip" })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.status, storageKey)).toBe("running");

  await panel.getByRole("button", { name: "Pause" }).click();
  await expect(panel.getByText("Paused")).toBeVisible();
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.endsAt, storageKey)).toBeNull();

  await panel.getByRole("button", { name: "Resume" }).click();
  await page.reload();
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  await expect(page.getByRole("tabpanel", { name: "Pomodoro" }).getByText("Running")).toBeVisible();

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("timer")).toHaveText(/25:00/);
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("timer")).toHaveText(/5:00/);
  await expect(page.getByText("Short break").first()).toBeVisible();
});

test("custom durations persist and apply to idle and future phases", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  await page.getByRole("button", { name: /Timer settings/ }).click();
  await page.getByRole("spinbutton", { name: "Focus min" }).fill("40");
  await page.getByRole("spinbutton", { name: "Short break min" }).fill("7");
  await page.getByRole("spinbutton", { name: "Long break min" }).fill("20");
  await page.getByRole("spinbutton", { name: "Focus sessions before long break" }).fill("3");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByRole("timer")).toHaveText(/40:00/);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("agent-halo.pomodoro-settings") ?? "null"))).toMatchObject({
    focusMinutes: 40,
    shortBreakMinutes: 7,
    longBreakMinutes: 20,
    longBreakEvery: 3,
  });

  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("timer")).toHaveText(/7:00/);
  await page.reload();
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  await expect(page.getByRole("timer")).toHaveText(/7:00/);
  await expect(page.locator(".pomodoro-settings-summary")).toHaveText("40 / 7 / 20 · ×3");

  await page.getByRole("button", { name: /Timer settings/ }).click();
  await page.getByRole("button", { name: "Defaults" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("agent-halo.pomodoro-settings") ?? "null")?.focusMinutes)).toBe(40);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("timer")).toHaveText(/5:00/);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("agent-halo.pomodoro-settings") ?? "null")?.focusMinutes)).toBe(25);
});

test("custom settings do not change a running or paused timer until Reset", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  await page.getByRole("button", { name: "Start" }).click();

  await page.getByRole("button", { name: /Timer settings/ }).click();
  await page.getByRole("spinbutton", { name: "Focus min" }).fill("50");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("timer")).not.toHaveText(/50:00/);
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("agent-halo.pomodoro") ?? "null")?.phaseDurationMs)).toBe(25 * 60 * 1_000);

  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("timer")).not.toHaveText(/50:00/);
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("timer")).toHaveText(/50:00/);
});

test("custom settings block invalid drafts with associated range feedback", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  await page.getByRole("button", { name: /Timer settings/ }).click();
  const focusInput = page.getByRole("spinbutton", { name: /Focus min/ });
  await focusInput.fill("");
  await expect(focusInput).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Whole number required")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
  await focusInput.fill("121");
  await expect(page.getByText("1–120")).toBeVisible();
  await focusInput.fill("30");
  await expect(page.getByRole("button", { name: "Apply" })).toBeEnabled();
});

test("custom cadence prepares Long break after the configured focus count", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const model = await import("/src/features/pomodoro/model.ts");
    const settings = { ...model.DEFAULT_POMODORO_SETTINGS, focusMinutes: 10, shortBreakMinutes: 2, longBreakMinutes: 9, longBreakEvery: 2 };
    let state = model.createPomodoroState(settings);
    state = model.startPomodoro(state, 0, "focus-1");
    state = model.completePomodoro(state, state.endsAt ?? 0, state.endsAt ?? 0, settings);
    state = model.startPomodoro(state, 1, "break-1");
    state = model.completePomodoro(state, state.endsAt ?? 0, state.endsAt ?? 0, settings);
    state = model.startPomodoro(state, 2, "focus-2");
    return model.completePomodoro(state, state.endsAt ?? 0, state.endsAt ?? 0, settings);
  });
  expect(result).toMatchObject({ phase: "long-break", completedFocusSessions: 2, phaseDurationMs: 9 * 60 * 1_000, remainingMs: 9 * 60 * 1_000 });
});

test("completed focus shows a quiet collapsed Done state and prepares the break", async ({ page }) => {
  await page.addInitScript(([key, now]) => {
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      phase: "focus",
      status: "running",
      completedFocusSessions: 0,
      remainingMs: 25 * 60 * 1_000,
      endsAt: now + 350,
      runId: "near-complete-focus",
      notificationScheduled: false,
      lastCompletion: null,
    }));
  }, [storageKey, Date.now()] as const);

  await page.goto("/?demo=1&demoScenario=idle");
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.phase, storageKey)).toBe("short-break");
  await page.locator(".halo-surface").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open Agent Halo" })).toBeVisible();
  await expect(page.locator(".pill-detail")).toHaveText("Done");
  await expect(page.locator(".pomodoro-pill-phase")).toHaveText("Short break ready");
  await expect(page.getByRole("button", { name: "Open Agent Halo — Short break ready" })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.completedFocusSessions, storageKey)).toBe(1);
  await page.getByRole("button", { name: "Open Agent Halo — Short break ready" }).click();
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.status, storageKey)).toBe("idle");
});

test("an elapsed deadline wins atomically over Pause before the next timer tick", async ({ page }) => {
  await page.addInitScript(([key, now]) => {
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      phase: "focus",
      status: "running",
      completedFocusSessions: 0,
      remainingMs: 25 * 60 * 1_000,
      endsAt: now + 120,
      runId: "deadline-precedence",
      notificationScheduled: false,
      lastCompletion: null,
    }));
  }, [storageKey, Date.now()] as const);

  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  await page.waitForTimeout(170);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), storageKey)).toMatchObject({
    phase: "short-break",
    status: "idle",
    completedFocusSessions: 1,
  });
});

test("wake reconciliation shows completion from observation time and remains exactly once", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const model = await import("/src/features/pomodoro/model.ts");
    const persistence = await import("/src/features/pomodoro/persistence.ts");
    const now = Date.now();
    const staleRunning = {
      ...model.createPomodoroState(),
      status: "running" as const,
      endsAt: now - 60_000,
      runId: "wake-completion",
    };
    const reconciled = persistence.normalizePomodoroState(staleRunning, now);
    const repeated = model.reconcilePomodoro(reconciled, now + 1_000);
    return {
      phase: reconciled.phase,
      completed: reconciled.completedFocusSessions,
      observedAt: reconciled.lastCompletion?.observedAt,
      repeatedCompleted: repeated.completedFocusSessions,
      sameObject: repeated === reconciled,
    };
  });
  expect(result).toMatchObject({ phase: "short-break", completed: 1, repeatedCompleted: 1, sameObject: true });
  expect(result.observedAt).toBeGreaterThan(Date.now() - 2_000);
});

test("corrupted Pomodoro storage resets implausible deadlines and future completion signals", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const persistence = await import("/src/features/pomodoro/persistence.ts");
    const now = Date.now();
    const state = persistence.normalizePomodoroState({
      schemaVersion: 1,
      phase: "focus",
      status: "running",
      completedFocusSessions: Number.MAX_SAFE_INTEGER,
      remainingMs: 1,
      endsAt: now + 365 * 24 * 60 * 60 * 1_000,
      runId: "corrupt",
      notificationScheduled: true,
      lastCompletion: {
        id: "future",
        completedAt: now + 10_000,
        observedAt: now + 10 * 60_000,
        completedPhase: "focus",
        nextPhase: "short-break",
        notificationScheduled: false,
      },
    }, now);
    const settings = persistence.normalizePomodoroSettings({
      schemaVersion: 1,
      focusMinutes: 0,
      shortBreakMinutes: 999,
      longBreakMinutes: -4,
      longBreakEvery: 80,
    });
    return { state, settings };
  });
  expect(result.state).toMatchObject({ status: "idle", endsAt: null, runId: null, notificationScheduled: false, lastCompletion: null });
  expect(result.settings).toMatchObject({ focusMinutes: 1, shortBreakMinutes: 60, longBreakMinutes: 1, longBreakEvery: 12 });
});

test("agent attention keeps precedence over an active Pomodoro countdown", async ({ page }) => {
  await page.addInitScript(([key, now]) => {
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      phase: "focus",
      status: "running",
      completedFocusSessions: 0,
      remainingMs: 25 * 60 * 1_000,
      endsAt: now + 20 * 60 * 1_000,
      runId: "attention-precedence",
      notificationScheduled: false,
      lastCompletion: null,
    }));
  }, [storageKey, Date.now()] as const);

  await page.goto("/?demo=1&demoScenario=attention");
  await expect(page.locator(".pomodoro-pill-icon")).toHaveCount(0);
  await expect(page.locator('.activity-mascot[data-status="attention"]')).toHaveCount(1);
});

test("active Pomodoro countdown stays visible over ordinary agent work", async ({ page }) => {
  await page.addInitScript(([key, now]) => {
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      phase: "focus",
      status: "running",
      completedFocusSessions: 2,
      remainingMs: 25 * 60 * 1_000,
      endsAt: now + 20 * 60 * 1_000,
      runId: "working-precedence",
      notificationScheduled: false,
      lastCompletion: null,
    }));
  }, [storageKey, Date.now()] as const);

  await page.goto("/?demo=1&demoScenario=long-llm");
  await expect(page.locator(".pomodoro-pill-icon")).toHaveCount(1);
  await expect(page.locator(".activity-mascot")).toHaveCount(0);
  await expect(page.locator(".pill-detail")).toContainText(":");
  await page.locator(".halo-surface").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Open Agent Halo — Focus, \d+:\d{2} remaining/ })).toBeVisible();
  expect(await page.locator(".pill-detail").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("recent agent error overrides Pomodoro even while another agent is working", async ({ page }) => {
  await page.addInitScript(([key, now]) => {
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      phase: "focus",
      status: "running",
      completedFocusSessions: 0,
      remainingMs: 25 * 60 * 1_000,
      endsAt: now + 20 * 60 * 1_000,
      runId: "mixed-error-precedence",
      notificationScheduled: false,
      lastCompletion: null,
    }));
  }, [storageKey, Date.now()] as const);
  await page.goto("/?demo=1&demoScenario=mixed-working-error");
  await expect(page.locator(".pomodoro-pill-icon")).toHaveCount(0);
  await expect(page.locator('.activity-mascot[data-status="error"]')).toHaveCount(1);
});

test("native Start requests permission, schedules silently, and Pause cancels", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __pomodoroNativeCalls: typeof calls }).__pomodoroNativeCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "notification_permission_state") return "notDetermined";
        if (command === "request_notification_permission") return "authorized";
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  });

  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __pomodoroNativeCalls: Array<{ command: string }> }).__pomodoroNativeCalls.some((call) => call.command === "schedule_pomodoro_notification"))).toBe(true);

  const schedule = await page.evaluate(() => (window as typeof window & { __pomodoroNativeCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__pomodoroNativeCalls.find((call) => call.command === "schedule_pomodoro_notification"));
  expect(schedule?.args).toMatchObject({ requestId: "agent-halo.pomodoro", title: "Focus complete", body: "Short break ready" });
  expect(typeof schedule?.args?.deadlineMs).toBe("number");

  await page.getByRole("button", { name: "Pause" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __pomodoroNativeCalls: Array<{ command: string }> }).__pomodoroNativeCalls.some((call) => call.command === "cancel_pomodoro_notification"))).toBe(true);

  await page.getByRole("button", { name: "Resume" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __pomodoroNativeCalls: Array<{ command: string }> }).__pomodoroNativeCalls.filter((call) => call.command === "schedule_pomodoro_notification").length)).toBe(2);
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __pomodoroNativeCalls: Array<{ command: string }> }).__pomodoroNativeCalls.filter((call) => call.command === "schedule_pomodoro_notification").length)).toBe(3);
  await page.getByRole("button", { name: "Skip" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __pomodoroNativeCalls: Array<{ command: string }> }).__pomodoroNativeCalls.filter((call) => call.command === "cancel_pomodoro_notification").length)).toBeGreaterThanOrEqual(3);
});

test("delayed old scheduling cannot cancel the resumed timer notification", async ({ page }) => {
  await page.addInitScript(() => {
    const sequence: string[] = [];
    let scheduleCount = 0;
    let resolveFirstSchedule: (() => void) | null = null;
    (window as typeof window & { __pomodoroSequence: string[]; __resolveFirstSchedule: () => void }).__pomodoroSequence = sequence;
    (window as typeof window & { __pomodoroSequence: string[]; __resolveFirstSchedule: () => void }).__resolveFirstSchedule = () => resolveFirstSchedule?.();
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        if (["schedule_pomodoro_notification", "cancel_pomodoro_notification"].includes(command)) sequence.push(command);
        if (command === "notification_permission_state") return "authorized";
        if (command === "schedule_pomodoro_notification") {
          scheduleCount += 1;
          if (scheduleCount === 1) await new Promise<void>((resolve) => { resolveFirstSchedule = resolve; });
          return null;
        }
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  });

  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __pomodoroSequence: string[] }).__pomodoroSequence.filter((item) => item === "schedule_pomodoro_notification").length)).toBe(1);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.evaluate(() => (window as typeof window & { __resolveFirstSchedule: () => void }).__resolveFirstSchedule());
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __pomodoroSequence: string[] }).__pomodoroSequence.filter((item) => item === "schedule_pomodoro_notification").length)).toBe(2);
  await page.waitForTimeout(100);
  const sequence = await page.evaluate(() => (window as typeof window & { __pomodoroSequence: string[] }).__pomodoroSequence);
  expect(sequence.at(-1)).toBe("schedule_pomodoro_notification");
});
