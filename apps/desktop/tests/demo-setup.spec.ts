import { expect, test } from "@playwright/test";

test("keep awake follows any working session instead of ambient attention priority", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const { shouldKeepDisplayAwakeForActivity } = await import("/src/features/session/selectors.ts");
    return {
      attentionAndWorking: shouldKeepDisplayAwakeForActivity(
        [{ status: "attention" }, { status: "working" }],
        "attention",
      ),
      attentionOnly: shouldKeepDisplayAwakeForActivity([{ status: "attention" }], "attention"),
      fallbackWorking: shouldKeepDisplayAwakeForActivity([], "working"),
      completedOnly: shouldKeepDisplayAwakeForActivity([{ status: "done" }], "done"),
    };
  });

  expect(result).toEqual({
    attentionAndWorking: true,
    attentionOnly: false,
    fallbackWorking: true,
    completedOnly: false,
  });
});

test("keep awake retries a transient native synchronization failure", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("agent-halo.keep-awake-while-working", "true");
    const calls: Array<{ active: boolean }> = [];
    let activeAttempts = 0;
    (window as typeof window & { __keepAwakeCalls: Array<{ active: boolean }> }).__keepAwakeCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: { active?: boolean }) => {
        if (command === "notch_metrics") return [184, 36];
        if (command !== "set_keep_awake") return null;
        const active = args?.active === true;
        calls.push({ active });
        if (active) {
          activeAttempts += 1;
          if (activeAttempts === 1) throw new Error("transient IOKit failure");
        }
        return active;
      },
    };
  });

  await page.goto("/?demo=1&demoScenario=long-llm");
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __keepAwakeCalls: Array<{ active: boolean }> }
  ).__keepAwakeCalls)).toEqual([{ active: false }, { active: true }, { active: true }]);

  await page.getByTitle("Setup").click();
  await expect(page.getByText("Active · Letta is working")).toBeVisible();
});

test("setup view stays capability-aware in browser demo", async ({ page }) => {
  await page.goto("/?demo=1");
  await page.getByTitle("Setup").click();

  await expect(page.getByText("Setup")).toBeVisible();
  await expect(page.getByText("Bridge", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo mode")).toBeVisible();
  await expect(page.getByText("Letta mod")).toBeVisible();
  await expect(page.getByText("Tauri runtime needed")).toBeVisible();
  await expect(page.getByText("Open desktop runtime")).toBeVisible();
  await expect(page.getByText("Browser demo cannot install or check the mod")).toBeVisible();
  await expect(page.getByText("Session controls")).toBeVisible();
  await expect(page.getByText("Focus/end unavailable in current bridge")).toBeVisible();
  await expect(page.getByText("Display", { exact: true })).toBeVisible();
  await expect(page.locator(".display-setting-row").getByText("Desktop runtime required")).toBeVisible();
  await expect(page.getByText("Keep display awake")).toBeVisible();
  await expect(page.getByText("Off · display follows macOS idle settings")).toBeVisible();

  await page.getByRole("button", { name: "Enable keep display awake" }).click();
  await expect(page.locator(".setup-row").filter({ hasText: "Keep display awake" }).getByText("Desktop runtime required")).toBeVisible();
  await page.reload();
  await page.getByTitle("Setup").click();
  await expect(page.getByRole("button", { name: "Disable keep display awake" })).toBeVisible();
  await page.getByRole("button", { name: "Disable keep display awake" }).click();

  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("Native controls need Tauri runtime")).toBeVisible();

  await page.getByRole("button", { name: "Install" }).click();
  await expect(page.getByText("Open with pnpm desktop:dev")).toBeVisible();
});

test("setup selects one native display with radio keyboard semantics", async ({ page }) => {
  await page.addInitScript(() => {
    let activeDisplayId = "macos:1";
    const displays = [
      { id: "macos:1", fingerprint: "Built-in|3024x1964|2.000", name: "Built-in Retina Display", width: 3024, height: 1964, scaleFactor: 2, isPrimary: true },
      { id: "macos:2", fingerprint: "Studio|3840x2160|2.000", name: "Studio Display", width: 3840, height: 2160, scaleFactor: 2, isPrimary: false },
    ];
    const snapshot = () => ({ displays, preferredDisplayId: activeDisplayId, preferredDisplayName: displays.find((display) => display.id === activeDisplayId)?.name ?? null, selectedDisplayId: activeDisplayId, activeDisplayId, fallbackActive: false });
    (window as typeof window & { __displayCalls: string[] }).__displayCalls = [];
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: { displayId?: string; active?: boolean }) => {
        if (command === "display_state") return snapshot();
        if (command === "reconcile_display") return snapshot();
        if (command === "select_display") {
          activeDisplayId = args?.displayId ?? activeDisplayId;
          (window as typeof window & { __displayCalls: string[] }).__displayCalls.push(activeDisplayId);
          return snapshot();
        }
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  });

  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByTitle("Setup").click();
  await expect(page.getByText("Built-in Retina Display · 3024×1964 · Primary")).toBeVisible();
  const displayRow = page.locator(".display-setting-row");
  await displayRow.getByRole("button", { name: /Choose/ }).click();
  const picker = page.getByRole("radiogroup", { name: "Display" });
  const builtIn = picker.getByRole("radio", { name: /Built-in Retina Display/ });
  const studio = picker.getByRole("radio", { name: /Studio Display/ });
  await expect(builtIn).toBeFocused();
  await builtIn.press("ArrowRight");
  await expect(studio).toHaveAttribute("aria-checked", "true");
  await expect(studio).toBeFocused();
  await studio.press("Escape");
  await expect(displayRow.getByRole("button", { name: /Choose/ })).toBeFocused();
  await expect(page.getByText("Studio Display · 3840×2160")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __displayCalls: string[] }).__displayCalls)).toEqual(["macos:2"]);
});

test("disconnected preferred display falls back without claiming Primary is selected", async ({ page }) => {
  await page.addInitScript(() => {
    const display = { id: "macos:1", fingerprint: "Built-in|3024x1964|2.000", name: "Color LCD", width: 3024, height: 1964, scaleFactor: 2, isPrimary: true };
    const snapshot = { displays: [display], preferredDisplayId: "macos:2", preferredDisplayName: "24G2W1G4", selectedDisplayId: null, activeDisplayId: "macos:1", fallbackActive: true };
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: { active?: boolean }) => {
        if (["display_state", "reconcile_display"].includes(command)) return snapshot;
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        return null;
      },
    };
  });

  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByTitle("Setup").click();
  const displayRow = page.locator(".display-setting-row");
  await expect(displayRow.getByText("24G2W1G4 unavailable · using Color LCD")).toBeVisible();
  await displayRow.getByRole("button", { name: /Choose/ }).click();
  const picker = page.getByRole("radiogroup", { name: "Display" });
  const primary = picker.getByRole("radio", { name: /Color LCD/ });
  await expect(primary).toHaveAttribute("aria-checked", "false");
  await expect(primary).toHaveAttribute("tabindex", "0");
  await expect(primary).toBeFocused();
  await primary.press("Escape");
  await expect(displayRow.getByRole("button", { name: /Choose/ })).toBeFocused();
});

test("native panel resize rejection closes cleanly without an unhandled promise", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __resizeRejections: string[] }).__resizeRejections = [];
    window.addEventListener("unhandledrejection", (event) => {
      (window as typeof window & { __resizeRejections: string[] }).__resizeRejections.push(String(event.reason));
    });
    const display = { id: "macos:1", fingerprint: "Built-in|3024x1964|2.000", name: "Color LCD", width: 3024, height: 1964, scaleFactor: 2, isPrimary: true };
    const snapshot = { displays: [display], preferredDisplayId: null, preferredDisplayName: null, selectedDisplayId: "macos:1", activeDisplayId: "macos:1", fallbackActive: false };
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: { active?: boolean }) => {
        if (command === "set_panel_open") throw new Error("native display move failed");
        if (["display_state", "reconcile_display"].includes(command)) return snapshot;
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        return null;
      },
    };
  });

  await page.goto("/?demo=1&demoScenario=idle");
  await expect(page.locator(".halo-surface")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".sheet-inner")).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { __resizeRejections: string[] }).__resizeRejections)).toEqual([]);
});
