import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("Pet surface is projection-only and keeps the approved Scorpion completion anatomy", async ({ page }) => {
  await page.setViewportSize({ width: 116, height: 88 });
  await page.goto("/?surface=pet&demoPet=1");
  await expect(page.locator(".overlay-root")).toHaveCount(0);
  const companion = page.getByRole("button", { name: "Focus complete. Open break actions" });
  await expect(companion).toBeVisible();
  await expect(companion).toHaveAttribute("aria-expanded", "false");
  const visual = page.locator('.completion-pet-visual[data-pet="scorpion"][data-state="working"][data-signal="none"]');
  await expect(visual).toHaveCount(1);
  await expect(visual.locator(".halo-pet-body")).toHaveCSS("animation-name", "halo-pet-three-frame-loop");
  await expect(visual.locator(".halo-pet-body")).toHaveCSS("animation-iteration-count", "infinite");
  await expect(visual.locator(".halo-pet-body")).toHaveCSS("width", "104px");
  await expect(visual.locator(".halo-pet-body")).toHaveCSS("height", "78px");
  await expect(visual.locator(".halo-pet-signal")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Hide completion pet" })).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Focus complete. Short break ready.");
  expect(await page.evaluate(() => window.localStorage.getItem("agent-halo.pomodoro"))).toBeNull();
});

test("Pet radial menu is compact, keyboard reachable, and starts the prepared break once", async ({ page }) => {
  await page.setViewportSize({ width: 260, height: 230 });
  await page.goto("/?surface=pet&demoPet=1");
  const companion = page.getByRole("button", { name: "Focus complete. Open break actions" });
  await companion.focus();
  await companion.press("Enter");
  await expect(companion).toHaveAttribute("aria-expanded", "true");
  const dialog = page.getByRole("dialog", { name: "Focus complete actions" });
  await expect(dialog).toBeVisible();
  const start = dialog.getByRole("button", { name: "Start Short break" });
  await expect(start).toBeFocused();
  await expect(dialog).toHaveCSS("width", "260px");
  await expect(dialog).toHaveCSS("height", "230px");
  await expect(start).toHaveCSS("border-radius", "50%");
  await expect(start).toHaveCSS("border-top-width", "0px");
  await expect(start).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(start).toHaveCSS("box-shadow", "none");
  await expect(start).toHaveCSS("animation-duration", "0.52s");
  await page.waitForTimeout(800);
  const [orbit, startBox] = await Promise.all([page.locator(".completion-pet-orbit").boundingBox(), start.boundingBox()]);
  expect(orbit).not.toBeNull();
  expect(startBox).not.toBeNull();
  expect(Math.abs((startBox!.y + startBox!.height / 2) - orbit!.y)).toBeLessThanOrEqual(1);
  const [laterBox, closeBox] = await Promise.all([
    dialog.getByRole("button", { name: "Not now" }).boundingBox(),
    dialog.getByRole("button", { name: "Hide completion pet" }).boundingBox(),
  ]);
  expect(laterBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  expect(Math.abs((laterBox!.x + laterBox!.width / 2) - orbit!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs((closeBox!.x + closeBox!.width / 2) - (orbit!.x + orbit!.width))).toBeLessThanOrEqual(1);
  await start.click();
  await expect(page.locator(".completion-pet-root")).toHaveAttribute("data-visible", "false");
  expect(await page.evaluate(() => window.__AGENT_HALO_PET_ACTIONS__)).toEqual(["start-break"]);
});

test("Not now and close hide only the active Pet summon", async ({ page }) => {
  await page.setViewportSize({ width: 260, height: 230 });
  await page.goto("/?surface=pet&demoPet=1&demoPetExpanded=1");
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.locator(".completion-pet-root")).toHaveAttribute("data-visible", "false");
  expect(await page.evaluate(() => window.__AGENT_HALO_PET_ACTIONS__ ?? [])).toEqual([]);

  await page.reload();
  await page.getByRole("button", { name: "Hide completion pet" }).click();
  await expect(page.locator(".completion-pet-root")).toHaveAttribute("data-visible", "false");
});

test("pointer-open enters the action order and Escape restores the companion", async ({ page }) => {
  await page.setViewportSize({ width: 260, height: 230 });
  await page.goto("/?surface=pet&demoPet=1");
  const companion = page.getByRole("button", { name: "Focus complete. Open break actions" });
  await companion.click();
  const start = page.getByRole("button", { name: "Start Short break" });
  await expect(start).toBeFocused();
  await expect(page.locator(".completion-pet-root")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.keyboard.press("Escape");
  await expect(companion).toBeFocused();
  await expect(companion).toHaveAttribute("aria-expanded", "false");
  await expect(companion).toHaveCSS("outline-style", "none");

  await companion.press("Enter");
  await page.getByRole("button", { name: "Hide completion pet" }).focus();
  await page.keyboard.press("Escape");
  await expect(companion).toBeFocused();
  await expect(companion).toHaveAttribute("aria-expanded", "false");
});

test("reduced motion holds the final Pet completion frame", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 116, height: 88 });
  await page.goto("/?surface=pet&demoPet=1");
  await expect(page.locator(".completion-pet-visual .halo-pet-body")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".completion-pet-visual .halo-pet-signal")).toHaveCount(0);
});

test("native Pet surface reads projection and sends only validated custom commands", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __petNativeCalls: typeof calls }).__petNativeCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "completion_pet_state") return {
          summon: { schemaVersion: 1, id: "native-pet", pet: "scorpion", petSize: "large", preview: false, nextPhase: "short-break", title: "Focus complete", actionLabel: "Start Short break" },
        };
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 260, height: 230 });
  await page.goto("/?surface=pet");
  const companion = page.getByRole("button", { name: "Focus complete. Open break actions" });
  await expect(companion).toBeVisible();
  await companion.click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __petNativeCalls: Array<{ command: string }> }).__petNativeCalls.some((call) => call.command === "activate_completion_pet"))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __petNativeCalls: Array<{ command: string }> }).__petNativeCalls.some((call) => call.command === "set_completion_pet_expanded"))).toBe(true);
  await page.getByRole("button", { name: "Start Short break" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __petNativeCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__petNativeCalls.some((call) => call.command === "submit_completion_pet_action" && call.args?.action === "start-break"))).toBe(true);
});

test("manual Pet preview is dismiss-only and never exposes a Pomodoro action", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "completion_pet_state") return {
          summon: { schemaVersion: 1, id: "preview-pet", pet: "scorpion", petSize: "large", preview: true, nextPhase: "short-break", title: "Pet preview", actionLabel: "" },
        };
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 260, height: 230 });
  await page.goto("/?surface=pet");
  await page.getByRole("button", { name: "Pet preview. Open controls" }).click();
  await expect(page.getByRole("dialog", { name: "Pet preview controls" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Start .*break/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Not now" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Hide completion pet" })).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("Pet preview.");
});
