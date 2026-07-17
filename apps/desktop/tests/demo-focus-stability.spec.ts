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
