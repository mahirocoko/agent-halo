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

test("Pomodoro tab starts, pauses, resumes, restarts, skips, and persists", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  const panel = page.getByRole("tabpanel", { name: "Pomodoro" });
  await expect(panel.getByRole("timer")).toHaveText(/25:00/);
  await expect(panel.getByText("Focus").first()).toBeVisible();
  await expect(panel.getByRole("button", { name: /Repeat/ })).toBeDisabled();

  await panel.getByRole("button", { name: "Start" }).click();
  await expect(panel.getByText("Running")).toBeVisible();
  await expect(panel.getByText("Focus").first()).toBeVisible();
  await expect(panel.getByText("Next · Short break")).toBeVisible();
  await expect(panel.getByText("Focus cycle")).toBeVisible();
  await expect(panel.getByRole("button", { name: /Repeat/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Skip" })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.status, storageKey)).toBe("running");

  await panel.getByRole("button", { name: "Pause" }).click();
  await expect(panel.getByText("Paused")).toBeVisible();
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.endsAt, storageKey)).toBeNull();

  await panel.getByRole("button", { name: "Resume" }).click();
  await page.reload();
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  await expect(page.getByRole("tabpanel", { name: "Pomodoro" }).getByText("Running")).toBeVisible();

  await page.getByRole("button", { name: /Repeat/ }).click();
  await expect(page.getByRole("timer")).toHaveText(/25:00/);
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("timer")).toHaveText(/5:00/);
  await expect(page.getByText("Short break").first()).toBeVisible();
});

test("Reset all returns to a fresh Focus cycle while preserving timer settings", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  await page.getByRole("button", { name: /Timer settings/ }).click();
  await page.getByRole("spinbutton", { name: "Focus min" }).fill("40");
  await page.getByRole("spinbutton", { name: "Focus sessions before long break" }).fill("3");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("Short break").first()).toBeVisible();

  const resetAll = page.getByRole("button", { name: "Reset all Pomodoro progress" });
  await expect(resetAll).toBeEnabled();
  await resetAll.click();
  await page.getByRole("button", { name: "Confirm reset all Pomodoro progress" }).click();

  await expect(page.getByText("Focus").first()).toBeVisible();
  await expect(page.getByRole("timer")).toHaveText(/40:00/);
  await expect(page.getByText("0 / 3")).toBeVisible();
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), storageKey)).toMatchObject({ phase: "focus", status: "idle", completedFocusSessions: 0, lastCompletion: null });
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("agent-halo.pomodoro-settings") ?? "null")?.focusMinutes)).toBe(40);
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

test("custom settings do not change a running or paused timer until Restart", async ({ page }) => {
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
  await page.getByRole("button", { name: /Repeat/ }).click();
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
  const [leftWingBox, detailBox, rightWingBox, phaseBox] = await Promise.all([
    page.locator(".notch-wing-left").boundingBox(),
    page.locator(".pill-detail").boundingBox(),
    page.locator(".notch-wing-right").boundingBox(),
    page.locator(".pomodoro-pill-phase").boundingBox(),
  ]);
  expect(leftWingBox).not.toBeNull();
  expect(detailBox).not.toBeNull();
  expect(rightWingBox).not.toBeNull();
  expect(phaseBox).not.toBeNull();
  expect(detailBox!.x - leftWingBox!.x).toBeGreaterThanOrEqual(42);
  expect(detailBox!.x - leftWingBox!.x).toBeLessThanOrEqual(46);
  const phaseRightInset = rightWingBox!.x + rightWingBox!.width - phaseBox!.x - phaseBox!.width;
  expect(phaseRightInset).toBeGreaterThanOrEqual(24);
  expect(phaseRightInset).toBeLessThanOrEqual(28);
  await expect(page.getByRole("button", { name: "Open Agent Halo — Short break ready" })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.completedFocusSessions, storageKey)).toBe(1);
  await page.getByRole("button", { name: "Open Agent Halo — Short break ready" }).click();
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.status, storageKey)).toBe("idle");
});

test("natural Focus completion summons Pet once and cancels the delayed notification fallback", async ({ page }) => {
  const endsAt = Date.now() + 350;
  await page.addInitScript(([key, endsAt]) => {
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      phase: "focus",
      status: "running",
      completedFocusSessions: 0,
      phaseDurationMs: 60_000,
      remainingMs: 60_000,
      endsAt,
      runId: "pet-natural-focus",
      notificationScheduled: false,
      lastCompletion: null,
    }));
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __petCompletionCalls: typeof calls }).__petCompletionCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "notification_permission_state") return "authorized";
        if (command === "show_completion_pet") return true;
        if (command === "cancel_pomodoro_notification") return true;
        if (command === "take_completion_pet_action") return null;
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  }, [storageKey, endsAt] as const);

  await page.goto("/?demo=1&demoScenario=idle");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __petCompletionCalls: Array<{ command: string }> }).__petCompletionCalls.filter((call) => call.command === "show_completion_pet").length)).toBe(1);
  const calls = await page.evaluate(() => (window as typeof window & { __petCompletionCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__petCompletionCalls);
  const schedule = calls.find((call) => call.command === "schedule_pomodoro_notification");
  expect(schedule?.args?.deadlineMs).toBe(endsAt + 5_000);
  const showIndex = calls.findIndex((call) => call.command === "show_completion_pet");
  const handoffCancel = calls.slice(0, showIndex).findLast((call) => call.command === "cancel_pomodoro_notification");
  expect(handoffCancel?.args).toMatchObject({ requestId: "agent-halo.pomodoro", handoffDeadlineMs: endsAt + 3_000 });
  const summon = calls[showIndex]?.args?.summon as Record<string, unknown>;
  expect(summon).toMatchObject({ id: "pet-natural-focus", pet: "scorpion", nextPhase: "short-break", actionLabel: "Start Short break" });
  expect(await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.phase, storageKey)).toBe("short-break");
});

test("disabled Completion Pet keeps the exact-deadline notification path and never summons", async ({ page }) => {
  const endsAt = Date.now() + 350;
  await page.addInitScript(([key, endsAt]) => {
    window.localStorage.setItem("agent-halo.completion-pet-enabled", "false");
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      phase: "focus",
      status: "running",
      completedFocusSessions: 0,
      phaseDurationMs: 60_000,
      remainingMs: 60_000,
      endsAt,
      runId: "pet-disabled-focus",
      notificationScheduled: false,
      lastCompletion: null,
    }));
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __petDisabledCalls: typeof calls }).__petDisabledCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "notification_permission_state") return "authorized";
        if (command === "take_completion_pet_action") return null;
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  }, [storageKey, endsAt] as const);

  await page.goto("/?demo=1&demoScenario=idle");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __petDisabledCalls: Array<{ command: string }> }).__petDisabledCalls.some((call) => call.command === "schedule_pomodoro_notification"))).toBe(true);
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.phase, storageKey)).toBe("short-break");
  const calls = await page.evaluate(() => (window as typeof window & { __petDisabledCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__petDisabledCalls);
  expect(calls.find((call) => call.command === "schedule_pomodoro_notification")?.args?.deadlineMs).toBe(endsAt);
  expect(calls.some((call) => call.command === "show_completion_pet")).toBe(false);
});

test("main renderer consumes one Pet action and remains the sole break timer owner", async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      phase: "short-break",
      status: "idle",
      completedFocusSessions: 1,
      phaseDurationMs: 5 * 60_000,
      remainingMs: 5 * 60_000,
      endsAt: null,
      runId: null,
      notificationScheduled: false,
      lastCompletion: { id: "pet-action-focus", completedAt: Date.now() - 1_000, observedAt: Date.now() - 1_000, completedPhase: "focus", nextPhase: "short-break", notificationScheduled: false },
    }));
    let pending = true;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        if (command === "take_completion_pet_action") {
          if (!pending) return null;
          pending = false;
          return { action: "start-break", summonId: "pet-action-focus", nextPhase: "short-break" };
        }
        if (command === "notification_permission_state") return "authorized";
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  }, storageKey);

  await page.goto("/?demo=1&demoScenario=idle");
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.status, storageKey)).toBe("running");
  const state = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), storageKey);
  expect(state.phase).toBe("short-break");
  expect(state.endsAt).toBeGreaterThan(Date.now());
});

test("completed Movement Break is revalidated by the sole main Pomodoro owner", async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      phase: "long-break",
      status: "idle",
      completedFocusSessions: 4,
      phaseDurationMs: 15 * 60_000,
      remainingMs: 15 * 60_000,
      endsAt: null,
      runId: null,
      notificationScheduled: false,
      lastCompletion: { id: "movement-focus", completedAt: Date.now() - 1_000, observedAt: Date.now() - 1_000, completedPhase: "focus", nextPhase: "long-break", notificationScheduled: false },
    }));
    let pending = true;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        if (command === "take_completion_pet_action") {
          if (!pending) return null;
          pending = false;
          return { action: "movement-complete", summonId: "movement-focus", nextPhase: "long-break" };
        }
        if (command === "notification_permission_state") return "authorized";
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  }, storageKey);

  await page.goto("/?demo=1&demoScenario=idle");
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.status, storageKey)).toBe("running");
  const state = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), storageKey);
  expect(state.phase).toBe("long-break");
  expect(state.endsAt).toBeGreaterThan(Date.now());
});

test("reload inside the delayed fallback window preserves the pending notification without resummoning Pet", async ({ page }) => {
  const now = Date.now();
  await page.addInitScript(([key, now]) => {
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      phase: "short-break",
      status: "idle",
      completedFocusSessions: 1,
      phaseDurationMs: 5 * 60_000,
      remainingMs: 5 * 60_000,
      endsAt: null,
      runId: null,
      notificationScheduled: false,
      lastCompletion: { id: "pet-reload-focus", completedAt: now - 500, observedAt: now - 500, completedPhase: "focus", nextPhase: "short-break", notificationScheduled: true },
    }));
    const calls: string[] = [];
    (window as typeof window & { __petReloadCalls: string[] }).__petReloadCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push(command);
        if (command === "notification_permission_state") return "authorized";
        if (command === "take_completion_pet_action") return null;
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  }, [storageKey, now] as const);

  await page.goto("/?demo=1&demoScenario=idle");
  await page.waitForTimeout(350);
  const calls = await page.evaluate(() => (window as typeof window & { __petReloadCalls: string[] }).__petReloadCalls);
  expect(calls).not.toContain("show_completion_pet");
  expect(calls).not.toContain("cancel_pomodoro_notification");
});

test("turning Pet off after the Focus deadline preserves the delayed fallback", async ({ page }) => {
  const baseNow = Date.now();
  const endsAt = baseNow + 10_000;
  await page.addInitScript(([key, baseNow, endsAt]) => {
    let currentNow = baseNow;
    Date.now = () => currentNow;
    (window as typeof window & { __setPetRaceNow: (value: number) => void }).__setPetRaceNow = (value) => { currentNow = value; };
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      phase: "focus",
      status: "running",
      completedFocusSessions: 0,
      phaseDurationMs: 60_000,
      remainingMs: 60_000,
      endsAt,
      runId: "pet-toggle-deadline",
      notificationScheduled: false,
      lastCompletion: null,
    }));
    const calls: string[] = [];
    (window as typeof window & { __petToggleRaceCalls: string[] }).__petToggleRaceCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push(command);
        if (command === "notification_permission_state") return "authorized";
        if (command === "take_completion_pet_action") return null;
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  }, [storageKey, baseNow, endsAt] as const);

  await page.goto("/?demo=1&demoScenario=idle");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __petToggleRaceCalls: string[] }).__petToggleRaceCalls.includes("schedule_pomodoro_notification"))).toBe(true);
  await page.getByRole("button", { name: "Setup" }).click();
  await page.getByRole("tab", { name: "Pet" }).click();
  const toggle = page.getByRole("switch", { name: "Disable completion pet" });
  await toggle.evaluate((element, deadline) => {
    (window as typeof window & { __setPetRaceNow: (value: number) => void }).__setPetRaceNow(deadline + 100);
    (element as HTMLButtonElement).click();
  }, endsAt);
  await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.phase, storageKey)).toBe("short-break");
  await page.waitForTimeout(250);
  const calls = await page.evaluate(() => (window as typeof window & { __petToggleRaceCalls: string[] }).__petToggleRaceCalls);
  expect(calls.filter((command) => command === "cancel_pomodoro_notification")).toHaveLength(0);
});

test("disabling Pet while native show is pending cannot cancel fallback or resurrect the summon", async ({ page }) => {
  const endsAt = Date.now() + 350;
  await page.addInitScript(([key, endsAt]) => {
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      phase: "focus",
      status: "running",
      completedFocusSessions: 0,
      phaseDurationMs: 60_000,
      remainingMs: 60_000,
      endsAt,
      runId: "pet-disable-show-race",
      notificationScheduled: false,
      lastCompletion: null,
    }));
    let resolveShow: (() => void) | null = null;
    let showPromise: Promise<void> | null = null;
    const calls: string[] = [];
    (window as typeof window & { __petShowRaceCalls: string[]; __resolvePetShow: () => void }).__petShowRaceCalls = calls;
    (window as typeof window & { __petShowRaceCalls: string[]; __resolvePetShow: () => void }).__resolvePetShow = () => resolveShow?.();
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push(command);
        if (command === "notification_permission_state") return "authorized";
        if (command === "cancel_pomodoro_notification") return true;
        if (command === "show_completion_pet") {
          showPromise ??= new Promise<void>((resolve) => { resolveShow = resolve; });
          await showPromise;
          return true;
        }
        if (command === "take_completion_pet_action") return null;
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  }, [storageKey, endsAt] as const);

  await page.goto("/?demo=1&demoScenario=idle");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __petShowRaceCalls: string[] }).__petShowRaceCalls.includes("show_completion_pet"))).toBe(true);
  await page.getByRole("button", { name: "Setup" }).click();
  await page.getByRole("tab", { name: "Pet" }).click();
  await page.getByRole("switch", { name: "Disable completion pet" }).click();
  await page.evaluate(() => (window as typeof window & { __resolvePetShow: () => void }).__resolvePetShow());
  await page.waitForTimeout(250);
  const calls = await page.evaluate(() => (window as typeof window & { __petShowRaceCalls: string[] }).__petShowRaceCalls);
  expect(calls.filter((command) => command === "cancel_pomodoro_notification")).toHaveLength(1);
  expect(calls.filter((command) => command === "schedule_pomodoro_notification")).toHaveLength(2);
  expect(calls.filter((command) => command === "hide_completion_pet").length).toBeGreaterThanOrEqual(2);
});

test("Pet handoff that resolves after its safety window hides without cancelling fallback", async ({ page }) => {
  const baseNow = Date.now();
  const endsAt = baseNow + 350;
  await page.addInitScript(([key, baseNow, endsAt]) => {
    let currentNow = baseNow;
    Date.now = () => currentNow;
    (window as typeof window & { __setLatePetNow: (value: number) => void }).__setLatePetNow = (value) => { currentNow = value; };
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      phase: "focus",
      status: "running",
      completedFocusSessions: 0,
      phaseDurationMs: 60_000,
      remainingMs: 60_000,
      endsAt,
      runId: "pet-late-handoff",
      notificationScheduled: false,
      lastCompletion: null,
    }));
    let resolveShow: (() => void) | null = null;
    const calls: string[] = [];
    (window as typeof window & { __latePetCalls: string[]; __resolveLatePet: () => void }).__latePetCalls = calls;
    (window as typeof window & { __latePetCalls: string[]; __resolveLatePet: () => void }).__resolveLatePet = () => resolveShow?.();
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push(command);
        if (command === "notification_permission_state") return "authorized";
        if (command === "cancel_pomodoro_notification") return true;
        if (command === "show_completion_pet") {
          await new Promise<void>((resolve) => { resolveShow = resolve; });
          return true;
        }
        if (command === "take_completion_pet_action") return null;
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  }, [storageKey, baseNow, endsAt] as const);

  await page.goto("/?demo=1&demoScenario=idle");
  await page.evaluate((completedNow) => (window as typeof window & { __setLatePetNow: (value: number) => void }).__setLatePetNow(completedNow), endsAt + 100);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __latePetCalls: string[] }).__latePetCalls.includes("show_completion_pet"))).toBe(true);
  await page.evaluate((lateNow) => {
    (window as typeof window & { __setLatePetNow: (value: number) => void }).__setLatePetNow(lateNow);
    (window as typeof window & { __resolveLatePet: () => void }).__resolveLatePet();
  }, endsAt + 3_100);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __latePetCalls: string[] }).__latePetCalls.includes("hide_completion_pet"))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __latePetCalls: string[] }).__latePetCalls.filter((command) => command === "schedule_pomodoro_notification").length)).toBe(2);
  const calls = await page.evaluate(() => (window as typeof window & { __latePetCalls: string[] }).__latePetCalls);
  expect(calls.filter((command) => command === "cancel_pomodoro_notification")).toHaveLength(1);
});

test("notification cancellation failure rolls Pet back and preserves fallback state", async ({ page }) => {
  const endsAt = Date.now() + 350;
  await page.addInitScript(([key, endsAt]) => {
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      phase: "focus",
      status: "running",
      completedFocusSessions: 0,
      phaseDurationMs: 60_000,
      remainingMs: 60_000,
      endsAt,
      runId: "pet-cancel-failure",
      notificationScheduled: false,
      lastCompletion: null,
    }));
    const calls: string[] = [];
    (window as typeof window & { __petCancelFailureCalls: string[] }).__petCancelFailureCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push(command);
        if (command === "notification_permission_state") return "authorized";
        if (command === "show_completion_pet") return true;
        if (command === "cancel_pomodoro_notification") throw new Error("simulated cancellation failure");
        if (command === "take_completion_pet_action") return null;
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  }, [storageKey, endsAt] as const);

  await page.goto("/?demo=1&demoScenario=idle");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __petCancelFailureCalls: string[] }).__petCancelFailureCalls.includes("cancel_pomodoro_notification"))).toBe(true);
  const calls = await page.evaluate(() => (window as typeof window & { __petCancelFailureCalls: string[] }).__petCancelFailureCalls);
  expect(calls).not.toContain("show_completion_pet");
  const state = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), storageKey);
  expect(state.lastCompletion.notificationScheduled).toBe(true);
});

test("stale Pet action identity cannot start a different prepared break", async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      phase: "short-break",
      status: "idle",
      completedFocusSessions: 1,
      phaseDurationMs: 5 * 60_000,
      remainingMs: 5 * 60_000,
      endsAt: null,
      runId: null,
      notificationScheduled: false,
      lastCompletion: { id: "current-focus", completedAt: Date.now() - 1_000, observedAt: Date.now() - 1_000, completedPhase: "focus", nextPhase: "short-break", notificationScheduled: false },
    }));
    let pending = true;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        if (command === "take_completion_pet_action" && pending) {
          pending = false;
          return { action: "start-break", summonId: "old-focus", nextPhase: "short-break" };
        }
        if (command === "notification_permission_state") return "authorized";
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  }, storageKey);

  await page.goto("/?demo=1&demoScenario=idle");
  await page.waitForTimeout(450);
  expect(await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null")?.status, storageKey)).toBe("idle");
});

test("an elapsed deadline wins atomically over Pause before the next timer tick", async ({ page }) => {
  await page.addInitScript((key) => {
    const controlledWindow = window as typeof window & { __pomodoroControlledNow: number };
    controlledWindow.__pomodoroControlledNow = Date.now();
    Date.now = () => controlledWindow.__pomodoroControlledNow;
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      phase: "focus",
      status: "running",
      completedFocusSessions: 0,
      remainingMs: 25 * 60 * 1_000,
      endsAt: controlledWindow.__pomodoroControlledNow + 120,
      runId: "deadline-precedence",
      notificationScheduled: false,
      lastCompletion: null,
    }));
  }, storageKey);

  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Pomodoro" }).click();
  await page.evaluate(() => {
    const controlledWindow = window as typeof window & { __pomodoroControlledNow: number };
    controlledWindow.__pomodoroControlledNow += 200;
    const pause = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Pause"));
    if (!(pause instanceof HTMLButtonElement)) throw new Error("Pause control is unavailable");
    pause.click();
  });
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
  await expect(page.locator('.activity-pet[data-status="attention"]')).toHaveCount(1);
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
  await expect(page.locator(".activity-pet")).toHaveCount(0);
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
  await expect(page.locator('.activity-pet[data-status="error"]')).toHaveCount(1);
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
  await page.getByRole("button", { name: /Repeat/ }).click();
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
