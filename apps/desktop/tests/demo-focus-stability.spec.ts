import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("agent status changes stay collapsed and never force the full panel open", async ({ page }) => {
  for (const scenario of ["done", "attention", "error"]) {
    await page.goto(`/?demo=1&demoCollapsed=1&demoScenario=${scenario}`);
    const surface = page.locator(".halo-surface");
    await expect(surface).toHaveAttribute("data-state", "closed");
    await expect(surface).toHaveAttribute("aria-expanded", "false");
    await page.waitForTimeout(350);
    await expect(surface).toHaveAttribute("data-state", "closed");
    await expect(surface).toHaveAttribute("aria-expanded", "false");
  }
});

test("hover expansion avoids native focus while explicit keyboard opening may request it", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __panelCalls: Array<Record<string, unknown>> }).__panelCalls = [];
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        if (command === "set_panel_open") {
          (window as typeof window & { __panelCalls: Array<Record<string, unknown>> }).__panelCalls.push(args ?? {});
          return null;
        }
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "notification_permission_state") return "denied";
        return null;
      },
    };
  });

  await page.goto("/?demo=1&demoCollapsed=1&demoScenario=idle");
  const surface = page.locator(".halo-surface");
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "external-focus-probe";
    document.body.append(input);
    input.focus();
  });
  await surface.hover();
  await expect(surface).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("external-focus-probe");
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __panelCalls: Array<Record<string, unknown>> }
  ).__panelCalls.some((call) => call.open === true && call.focus === false))).toBe(true);

  await surface.focus();
  await page.keyboard.press("Escape");
  await expect(surface).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => { (
    window as typeof window & { __panelCalls: Array<Record<string, unknown>> }
  ).__panelCalls = []; });

  await surface.focus();
  await page.keyboard.press("Enter");
  await expect(surface).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __panelCalls: Array<Record<string, unknown>> }
  ).__panelCalls.some((call) => call.open === true && call.focus === true))).toBe(true);
});

test("failed explicit open cannot leak focus intent into a later hover", async ({ page }) => {
  await page.addInitScript(() => {
    let focusedOpenFailures = 0;
    (window as typeof window & { __panelCalls: Array<Record<string, unknown>> }).__panelCalls = [];
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        if (command === "set_panel_open") {
          (window as typeof window & { __panelCalls: Array<Record<string, unknown>> }).__panelCalls.push(args ?? {});
          if (args?.open === true && args.focus === true && focusedOpenFailures < 2) {
            focusedOpenFailures += 1;
            throw new Error("simulated native open failure");
          }
          return null;
        }
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "notification_permission_state") return "denied";
        return null;
      },
    };
  });

  await page.goto("/?demo=1&demoCollapsed=1&demoScenario=idle");
  const surface = page.locator(".halo-surface");
  await surface.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __panelCalls: Array<Record<string, unknown>> }
  ).__panelCalls.filter((call) => call.open === true && call.focus === true).length)).toBe(2);
  await expect(surface).toHaveAttribute("aria-expanded", "false");

  await page.evaluate(() => { (
    window as typeof window & { __panelCalls: Array<Record<string, unknown>> }
  ).__panelCalls = []; });
  await surface.hover();
  await expect(surface).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __panelCalls: Array<Record<string, unknown>> }
  ).__panelCalls.some((call) => call.open === true && call.focus === false))).toBe(true);
  expect(await page.evaluate(() => (
    window as typeof window & { __panelCalls: Array<Record<string, unknown>> }
  ).__panelCalls.some((call) => call.open === true && call.focus === true))).toBe(false);
});

test("passive dimension updates cannot duplicate a delayed focus request", async ({ page }) => {
  await page.addInitScript(() => {
    let delayedFocusedOpen = false;
    (window as typeof window & { __panelCalls: Array<Record<string, unknown>>; __resolveFocusedOpen: () => void }).__panelCalls = [];
    (window as typeof window & { __panelCalls: Array<Record<string, unknown>>; __resolveFocusedOpen: () => void }).__resolveFocusedOpen = () => undefined;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        if (command === "set_panel_open") {
          (window as typeof window & { __panelCalls: Array<Record<string, unknown>> }).__panelCalls.push(args ?? {});
          if (args?.open === true && args.focus === true && !delayedFocusedOpen) {
            delayedFocusedOpen = true;
            await new Promise<void>((resolve) => {
              (window as typeof window & { __resolveFocusedOpen: () => void }).__resolveFocusedOpen = resolve;
            });
          }
          return null;
        }
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "notification_permission_state") return "denied";
        return null;
      },
    };
  });

  await page.goto("/?demo=1&demoCollapsed=1&demoScenario=idle");
  const surface = page.locator(".halo-surface");
  await surface.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __panelCalls: Array<Record<string, unknown>> }
  ).__panelCalls.filter((call) => call.open === true && call.focus === true).length)).toBe(1);

  await page.setViewportSize({ width: 700, height: 650 });
  await page.evaluate(() => (
    window as typeof window & { __resolveFocusedOpen: () => void }
  ).__resolveFocusedOpen());
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __panelCalls: Array<Record<string, unknown>> }
  ).__panelCalls.some((call) => call.open === true && call.focus === false))).toBe(true);
  expect(await page.evaluate(() => (
    window as typeof window & { __panelCalls: Array<Record<string, unknown>> }
  ).__panelCalls.filter((call) => call.open === true && call.focus === true).length)).toBe(1);
});

for (const closeMode of ['none', 'escape', 'footer'] as const) {
  const closeBeforeRelease = closeMode !== 'none';
  test(`queued Pet focus intent ${closeBeforeRelease ? `is invalidated by ${closeMode} close` : "survives resize before dispatch"}`, async ({ page }) => {
    await page.addInitScript(() => {
      const probe = {
        calls: [] as Array<Record<string, unknown>>,
        blocked: false,
        released: false,
        release: () => {},
        pendingAction: null as Record<string, unknown> | null,
      };
      (window as typeof window & { __queuedFocusProbe: typeof probe }).__queuedFocusProbe = probe;
      (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          if (command === "set_panel_open") {
            probe.calls.push(args ?? {});
            if (args?.open === true && args.focus === false && !probe.blocked) {
              probe.blocked = true;
              await new Promise<void>((resolve) => { probe.release = resolve; });
              probe.released = true;
            }
            return null;
          }
          if (command === "take_completion_pet_action") {
            const action = probe.pendingAction;
            probe.pendingAction = null;
            return action;
          }
          if (command === "notch_metrics") return [184, 36];
          if (command === "set_keep_awake") return args?.active === true;
          if (command === "notification_permission_state") return "denied";
          return null;
        },
      };
    });
    type Probe = {
      calls: Array<Record<string, unknown>>;
      blocked: boolean;
      released: boolean;
      release: () => void;
      pendingAction: Record<string, unknown> | null;
    };
    await page.goto(`/?demo=1&demoScenario=${closeMode === 'footer' ? 'done' : 'idle'}`);
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __queuedFocusProbe: Probe }).__queuedFocusProbe.blocked)).toBe(true);
    await page.evaluate(() => {
      (window as typeof window & { __queuedFocusProbe: Probe }).__queuedFocusProbe.pendingAction = {
        action: "open-focus", summonId: "queued-focus", nextPhase: null,
      };
    });
    await expect(page.getByRole("tab", { name: "Focus" })).toHaveAttribute("aria-selected", "true");
    await page.setViewportSize({ width: 700, height: 650 });
    await expect(page.locator(".halo-surface")).toHaveAttribute("data-panel-width", "700");
    if (closeMode === 'footer') {
      await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
      await page.locator('.sheet-footer').getByRole('button', { name: 'Close', exact: true }).click();
    } else if (closeMode === 'escape') {
      await page.getByRole("tab", { name: "Focus" }).press("Escape");
    }
    if (closeBeforeRelease) await expect(page.locator(".halo-surface")).toHaveAttribute("aria-expanded", "false");
    // Flush the resize/close effect while the passive native call still blocks the queue.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await page.evaluate(() => (window as typeof window & { __queuedFocusProbe: Probe }).__queuedFocusProbe.calls.filter((call) => call.focus === true).length)).toBe(0);
    await page.evaluate(() => (window as typeof window & { __queuedFocusProbe: Probe }).__queuedFocusProbe.release());
    await expect.poll(() => page.evaluate((closed) => {
      const calls = (window as typeof window & { __queuedFocusProbe: Probe }).__queuedFocusProbe.calls;
      return calls.length > 1 && calls.at(-1)?.open === !closed;
    }, closeBeforeRelease)).toBe(true);
    if (closeMode === 'footer') {
      await expect(page.locator('.halo-surface')).toHaveAttribute('data-state', 'closed');
      await page.mouse.move(0, 600);
      await page.locator('.halo-surface').hover();
      await expect(page.locator('.halo-surface')).toHaveAttribute('aria-expanded', 'true');
      await expect.poll(() => page.evaluate(() => (window as typeof window & { __queuedFocusProbe: Probe }).__queuedFocusProbe.calls.at(-1)?.open)).toBe(true);
    }
    // A further passive update proves the dispatched/invalidated intent cannot leak.
    await page.setViewportSize({ width: 680, height: 630 });
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => (window as typeof window & { __queuedFocusProbe: Probe }).__queuedFocusProbe.calls.filter((call) => call.open === true && call.focus === true).length)).toBe(closeBeforeRelease ? 0 : 1);
  });
}

test("Pomodoro completion only expands the closed wing without requesting focus", async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now();
    window.localStorage.setItem("agent-halo.pomodoro", JSON.stringify({
      schemaVersion: 2,
      phase: "focus",
      status: "running",
      completedFocusSessions: 0,
      phaseDurationMs: 25 * 60 * 1_000,
      remainingMs: 25 * 60 * 1_000,
      endsAt: now + 120,
      runId: "focus-stability-completion",
      notificationScheduled: false,
      lastCompletion: null,
    }));
    (window as typeof window & { __panelCalls: Array<Record<string, unknown>> }).__panelCalls = [];
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        if (command === "set_panel_open") {
          (window as typeof window & { __panelCalls: Array<Record<string, unknown>> }).__panelCalls.push(args ?? {});
          return null;
        }
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "notification_permission_state") return "denied";
        return null;
      },
    };
  });

  await page.goto("/?demo=1&demoCollapsed=1&demoScenario=idle");
  await expect.poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem("agent-halo.pomodoro") ?? "null")?.phase)).toBe("short-break");
  const surface = page.locator(".halo-surface");
  await expect(surface).toHaveAttribute("data-state", "closed");
  await expect(surface).toHaveAttribute("aria-expanded", "false");
  const calls = await page.evaluate(() => (
    window as typeof window & { __panelCalls: Array<Record<string, unknown>> }
  ).__panelCalls);
  expect(calls.some((call) => call.open === true)).toBe(false);
  expect(calls.some((call) => call.open === false && call.focus === false)).toBe(true);
});
