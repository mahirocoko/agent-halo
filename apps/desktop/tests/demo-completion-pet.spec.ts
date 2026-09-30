import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("Pet surface is projection-only and uses the approved Haloform completion anatomy", async ({ page }) => {
  await page.setViewportSize({ width: 116, height: 88 });
  await page.goto("/?surface=pet&demoPet=1");
  await expect(page.locator(".overlay-root")).toHaveCount(0);
  const companion = page.getByRole("button", { name: "Focus complete. Open break actions" });
  await expect(companion).toBeVisible();
  await expect(companion).toHaveAttribute("aria-expanded", "false");
  expect(await companion.boundingBox()).toMatchObject({ x: 0, y: 0, width: 116, height: 88 });
  const visual = page.locator('.completion-pet-visual[data-pet="haloform"][data-state="done"][data-motion="done"][data-signal="done"]');
  await expect(visual).toHaveCount(1);
  await expect(visual.locator(".halo-pet-body")).toHaveCSS("animation-name", "haloform-done");
  await expect(visual.locator(".halo-pet-body")).toHaveCSS("animation-duration", "1.44s");
  await expect(visual.locator(".halo-pet-body")).toHaveCSS("animation-iteration-count", "1");
  await expect(visual.locator(".halo-pet-body")).toHaveCSS("width", "78px");
  await expect(visual.locator(".halo-pet-body")).toHaveCSS("height", "78px");
  await expect(visual.locator(".halo-pet-body")).toHaveCSS("background-image", /\/body\/haloform\/completion\/done\.png/);
  await expect(visual.locator(".halo-pet-signal")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Close" })).toHaveCount(0);
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
    dialog.getByRole("button", { name: "Later" }).boundingBox(),
    dialog.getByRole("button", { name: "Close" }).boundingBox(),
  ]);
  expect(laterBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  expect(Math.abs((laterBox!.x + laterBox!.width / 2) - orbit!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs((closeBox!.x + closeBox!.width / 2) - (orbit!.x + orbit!.width))).toBeLessThanOrEqual(1);
  await start.click();
  await expect(page.locator(".completion-pet-root")).toHaveAttribute("data-visible", "false");
  expect(await page.evaluate(() => window.__AGENT_HALO_PET_ACTIONS__)).toEqual(["start-break"]);
});

test("Later and close hide only the active Pet summon", async ({ page }) => {
  await page.setViewportSize({ width: 260, height: 230 });
  await page.goto("/?surface=pet&demoPet=1&demoPetExpanded=1");
  await page.getByRole("button", { name: "Later" }).click();
  await expect(page.locator(".completion-pet-root")).toHaveAttribute("data-visible", "false");
  expect(await page.evaluate(() => window.__AGENT_HALO_PET_ACTIONS__ ?? [])).toEqual([]);

  await page.reload();
  await page.getByRole("button", { name: "Close" }).click();
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
  await page.getByRole("button", { name: "Close" }).focus();
  await page.keyboard.press("Escape");
  await expect(companion).toBeFocused();
  await expect(companion).toHaveAttribute("aria-expanded", "false");
});

test("reduced motion holds the final Pet completion frame", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 116, height: 88 });
  await page.goto("/?surface=pet&demoPet=1");
  await expect(page.locator(".completion-pet-visual .halo-pet-body")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".completion-pet-visual")).toHaveAttribute("data-signal", "done");
  await expect(page.locator(".completion-pet-visual .halo-pet-body")).toHaveCSS("background-position", "-234px 0px");
  await expect(page.locator(".completion-pet-visual .halo-pet-signal")).toHaveCSS("animation-name", "none");
});

test("native Pet surface reads projection and sends only validated custom commands", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __petNativeCalls: typeof calls }).__petNativeCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "completion_pet_state") {
          const summon = { schemaVersion: 2, id: "native-pet", purpose: "focus-completion", pet: "haloform", petSize: "large", movementBreakEnabled: false, nextPhase: "short-break" };
          return {
            summon,
            projection: {
              schemaVersion: 2,
              summon,
              sessionStatus: "working",
              activityKind: "session",
              dataState: "working",
              motionMapping: { idle: "idle", working: "working", attention: "attention", done: "done", error: "error" },
              replayId: "native-pet:working",
            },
          };
        }
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 260, height: 230 });
  await page.goto("/?surface=pet");
  const root = page.locator(".completion-pet-root");
  const visual = page.locator('.completion-pet-visual[data-pet="haloform"]');
  const companion = page.getByRole("button", { name: "Focus complete. Open break actions" });
  await expect(companion).toBeVisible();
  await expect(root).toHaveAttribute("data-purpose", "focus-completion");
  await expect(root).toHaveAttribute("data-projection-replay-id", "native-pet:working");
  await expect(visual).toHaveAttribute("data-state", "working");
  await companion.click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __petNativeCalls: Array<{ command: string }> }).__petNativeCalls.some((call) => call.command === "activate_completion_pet"))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __petNativeCalls: Array<{ command: string }> }).__petNativeCalls.some((call) => call.command === "set_completion_pet_expanded"))).toBe(true);
  await page.getByRole("button", { name: "Start Short break" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __petNativeCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__petNativeCalls.some((call) => call.command === "submit_completion_pet_action" && call.args?.action === "start-break"))).toBe(true);
});

test("Halo Bot completion keeps the selected loadout and square pixel geometry", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("agent-halo.halo-bot-loadout", "f061");
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "completion_pet_state") {
          const summon = { schemaVersion: 2, id: "halo-bot-pet", purpose: "focus-completion", pet: "halo-bot", loadout: "f061", petSize: "large", movementBreakEnabled: false, nextPhase: "short-break" };
          return {
            summon,
            projection: {
              schemaVersion: 2,
              summon,
              sessionStatus: "working",
              activityKind: "session",
              dataState: "working",
              motionMapping: { idle: "idle", working: "working", attention: "attention", done: "done", error: "error" },
              replayId: "halo-bot-pet:working",
            },
          };
        }
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 116, height: 88 });
  await page.goto("/?surface=pet");
  const pet = page.locator('.completion-pet-visual.halo-pet[data-pet="halo-bot"]');
  await expect(pet).toHaveAttribute("data-loadout", "f061");
  const body = pet.locator(".halo-pet-body");
  await expect(body).toHaveCSS("width", "78px");
  await expect(body).toHaveCSS("height", "78px");
  await expect(body).toHaveCSS("top", "5px");
  await expect(body).toHaveCSS("left", "19px");
  await expect(body).toHaveCSS("background-image", "none");
  await expect(body).toHaveCSS("animation-name", "none");
  await expect(body.locator('.pixabot-layer[data-category="top"]')).toHaveCSS("animation-name", "pixabot-working-top");
  await expect(body.locator('.pixabot-layer[data-category="body"]')).toHaveCSS("animation-name", "pixabot-working-body");
  await expect(body.locator('.pixabot-layer[data-category="heads"]')).toHaveCSS("animation-name", "pixabot-working-head");
  await expect(body.locator(".pixabot-layer")).toHaveCount(4);
  await expect(body.locator('.pixabot-layer[data-category="eyes"] .pixabot-part')).toHaveCSS("background-image", /\/body\/halo-bot\/parts\/eyes\/wayfarer-face\.png/);
  await expect(body.locator('.pixabot-layer[data-category="body"] .pixabot-part')).toHaveCSS("background-image", /\/body\/halo-bot\/parts\/body\/fire\.png/);
  await expect(body).toHaveCSS("image-rendering", "pixelated");
});

test("setup Pet preview is dismiss-only and never exposes a Pomodoro action", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "completion_pet_state") {
          const summon = { schemaVersion: 2, id: "preview-pet", purpose: "setup-preview", pet: "haloform", petSize: "large", nextPhase: null };
          return {
            summon,
            projection: {
              schemaVersion: 2,
              summon,
              sessionStatus: "idle",
              activityKind: "session",
              dataState: "idle",
              motionMapping: { idle: "idle", working: "working", attention: "attention", done: "done", error: "error" },
              replayId: "preview-pet:idle",
            },
          };
        }
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 260, height: 230 });
  await page.goto("/?surface=pet");
  await page.getByRole("button", { name: "Pet setup preview. Open controls" }).click();
  await expect(page.getByRole("dialog", { name: "Pet setup preview controls" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Start .*break/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Later" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("Pet setup preview.");
});

test("native manual companion uses its v2 projection and never offers a prepared break", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __manualCompanionCalls: typeof calls }).__manualCompanionCalls = calls;
    const summon = { schemaVersion: 2, id: "manual-companion", purpose: "manual-companion", pet: "haloform", petSize: "large", nextPhase: null };
    const projection = {
      schemaVersion: 2,
      summon,
      sessionStatus: "attention",
      activityKind: "asking",
      dataState: "attention",
      motionMapping: { idle: "idle", working: "working", attention: "done", done: "done", error: "error" },
      replayId: "manual-companion:attention",
    };
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "completion_pet_state") return { summon, projection };
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 260, height: 230 });
  await page.goto("/?surface=pet");
  const root = page.locator(".completion-pet-root");
  const visual = page.locator('.completion-pet-visual[data-pet="haloform"]');
  await expect(root).toHaveAttribute("data-purpose", "manual-companion");
  await expect(root).toHaveAttribute("data-movement-option", "true");
  await expect(root).toHaveAttribute("data-projection-replay-id", "manual-companion:attention");
  await expect(visual).toHaveAttribute("data-state", "attention");
  await expect(visual).toHaveAttribute("data-motion", "done");
  await expect(visual).toHaveAttribute("data-signal", "attention-asking");

  const companion = page.getByRole("button", { name: "Manual companion. Open controls" });
  await companion.click();
  const dialog = page.getByRole("dialog", { name: "Manual companion controls" });
  await expect(dialog).toBeVisible();
  const focus = dialog.getByRole("button", { name: "Open Focus" });
  await expect(focus).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Choose movement exercise" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Hide" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Start .*break/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Later" })).toHaveCount(0);

  await focus.click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __manualCompanionCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__manualCompanionCalls.some((call) => call.command === "submit_completion_pet_action" && call.args?.action === "open-focus"))).toBe(true);
  await expect(page.getByRole("button", { name: "Manual companion. Open controls" })).toBeFocused();
  await expect(root).toHaveAttribute("data-visible", "true");
  expect(await page.evaluate(() => (window as typeof window & { __manualCompanionCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__manualCompanionCalls.filter((call) => call.command === "hide_completion_pet").length)).toBe(0);
});

test("manual companion requested Movement starts only its requested exercise and cancels cleanly", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __manualRequestedMovementCalls: typeof calls }).__manualRequestedMovementCalls = calls;
    const summon = { schemaVersion: 2, id: "manual-overhead", purpose: "manual-companion", pet: "haloform", petSize: "large", nextPhase: null, requestedExerciseId: "overhead-reach" };
    const projection = {
      schemaVersion: 2,
      summon,
      sessionStatus: "working",
      activityKind: "session",
      dataState: "working",
      motionMapping: { idle: "idle", working: "working", attention: "attention", done: "done", error: "error" },
      replayId: "manual-overhead:working",
    };
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "completion_pet_state") return { summon, projection };
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 600, height: 420 });
  await page.goto("/?surface=pet&demoCameraOff=1");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __manualRequestedMovementCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__manualRequestedMovementCalls.filter((call) => call.command === "set_completion_pet_movement" && call.args?.active === true && call.args?.summonId === "manual-overhead").length)).toBe(1);
  await expect(page.getByRole("dialog", { name: "10 Overhead Reaches movement break" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "10 Squats movement break" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start Short break" })).toHaveCount(0);

  await page.getByRole("button", { name: "Close movement break" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __manualRequestedMovementCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__manualRequestedMovementCalls.filter((call) => call.command === "set_completion_pet_movement" && call.args?.active === false && call.args?.summonId === "manual-overhead").length)).toBe(1);
  await expect(page.getByRole("button", { name: "Manual companion. Open controls" })).toBeFocused();
  expect(await page.evaluate(() => (window as typeof window & { __manualRequestedMovementCalls: Array<{ command: string }> }).__manualRequestedMovementCalls.filter((call) => call.command === "submit_completion_pet_action").length)).toBe(0);
});

test("manual Movement camera failure returns to Pet without offering or queueing a break", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __manualFailureCalls: typeof calls }).__manualFailureCalls = calls;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => { throw new DOMException("Camera denied", "NotAllowedError"); } },
    });
    const summon = { schemaVersion: 2, id: "manual-camera-failure", purpose: "manual-companion", pet: "haloform", petSize: "large", nextPhase: null };
    const projection = {
      schemaVersion: 2,
      summon,
      sessionStatus: "idle",
      activityKind: "session",
      dataState: "idle",
      motionMapping: { idle: "idle", working: "working", attention: "attention", done: "done", error: "error" },
      replayId: "manual-camera-failure:idle",
    };
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "completion_pet_state") return { summon, projection };
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 600, height: 420 });
  await page.goto("/?surface=pet");
  await page.getByRole("button", { name: "Manual companion. Open controls" }).click();
  await page.getByRole("button", { name: "Choose movement exercise" }).click();
  await page.getByRole("button", { name: "Start 10 Squats movement break" }).click();
  const challenge = page.getByRole("dialog", { name: "10 Squats movement break" });
  await expect(challenge.getByRole("button", { name: "Back to Pet" })).toBeVisible();
  await expect(challenge.getByRole("button", { name: "Start break" })).toHaveCount(0);
  await challenge.getByRole("button", { name: "Back to Pet" }).click();
  await expect(page.getByRole("button", { name: "Manual companion. Open controls" })).toBeFocused();
  expect(await page.evaluate(() => (window as typeof window & { __manualFailureCalls: Array<{ command: string }> }).__manualFailureCalls.filter((call) => call.command === "submit_completion_pet_action").length)).toBe(0);
});

test("manual Movement completion returns to the companion without a Pomodoro action", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __manualCompletedMovementCalls: typeof calls }).__manualCompletedMovementCalls = calls;
    const summon = { schemaVersion: 2, id: "manual-squat", purpose: "manual-companion", pet: "haloform", petSize: "large", nextPhase: null };
    const projection = {
      schemaVersion: 2,
      summon,
      sessionStatus: "working",
      activityKind: "session",
      dataState: "working",
      motionMapping: { idle: "idle", working: "working", attention: "attention", done: "done", error: "error" },
      replayId: "manual-squat:working",
    };
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "completion_pet_state") return { summon, projection };
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 600, height: 420 });
  await page.goto("/?surface=pet&demoCameraOff=1&demoMovementCompleted=1");
  await page.getByRole("button", { name: "Manual companion. Open controls" }).click();
  await page.getByRole("button", { name: "Choose movement exercise" }).click();
  await page.getByRole("dialog", { name: "Choose movement exercise" }).getByRole("button", { name: "Start 10 Squats movement break" }).click();
  await expect(page.getByRole("dialog", { name: "10 Squats movement break" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Celebration" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __manualCompletedMovementCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__manualCompletedMovementCalls.filter((call) => call.command === "set_completion_pet_movement" && call.args?.active === true && call.args?.summonId === "manual-squat").length)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __manualCompletedMovementCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__manualCompletedMovementCalls.filter((call) => call.command === "set_completion_pet_movement" && call.args?.active === false && call.args?.summonId === "manual-squat").length)).toBe(1);
  await expect(page.getByRole("button", { name: "Manual companion. Open controls" })).toBeFocused();
  await expect(page.locator(".completion-pet-root")).toHaveAttribute("data-projection-replay-id", "manual-squat:working");
  await expect(page.locator('.completion-pet-visual[data-state="done"][data-signal="done"]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as typeof window & { __manualCompletedMovementCalls: Array<{ command: string }> }).__manualCompletedMovementCalls.filter((call) => call.command === "submit_completion_pet_action").length)).toBe(0);
  expect(await page.evaluate(() => window.localStorage.getItem("agent-halo.pomodoro"))).toBeNull();
});

test("global Haloform completion exposes the prepared break actions", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "completion_pet_state") {
          const summon = { schemaVersion: 2, id: "haloform-focus", purpose: "focus-completion", pet: "haloform", petSize: "large", movementBreakEnabled: false, nextPhase: "short-break" };
          return {
            summon,
            projection: {
              schemaVersion: 2,
              summon,
              sessionStatus: "done",
              activityKind: "done",
              dataState: "done",
              motionMapping: { idle: "idle", working: "working", attention: "attention", done: "done", error: "error" },
              replayId: "haloform-focus:done",
            },
          };
        }
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 260, height: 230 });
  await page.goto("/?surface=pet");
  const root = page.locator(".completion-pet-root");
  const companion = page.getByRole("button", { name: "Focus complete. Open break actions" });
  await expect(root).not.toHaveAttribute("data-preview", /.+/);
  await expect(page.getByRole("status")).toHaveText("Focus complete. Short break ready.");
  await companion.click();
  const dialog = page.getByRole("dialog", { name: "Focus complete actions" });
  await expect(dialog.getByRole("button", { name: "Start Short break" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Start Short break" })).toHaveText(/Short\s*break/);
  const context = dialog.getByText("Focus complete");
  await expect(context).toBeVisible();
  await expect(context).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(context).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(dialog.getByRole("button", { name: "Later" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Choose Movement Break exercise" })).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Later" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Later" })).toHaveCSS("outline-width", "2px");
});

test("global Haloform setup preview uses the generic dismiss-only surface", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command !== "completion_pet_state") return null;
        const summon = { schemaVersion: 2, id: "haloform-preview", purpose: "setup-preview", pet: "haloform", petSize: "large", nextPhase: null };
        return {
          summon,
          projection: {
            schemaVersion: 2,
            summon,
            sessionStatus: "idle",
            activityKind: "session",
            dataState: "idle",
            motionMapping: { idle: "idle", working: "working", attention: "attention", done: "done", error: "error" },
            replayId: "haloform-preview:idle",
          },
        };
      },
    };
  });
  await page.setViewportSize({ width: 116, height: 88 });
  await page.goto("/?surface=pet");
  const root = page.locator(".completion-pet-root");
  const companion = page.getByRole("button", { name: "Pet setup preview. Open controls" });
  const petVisual = page.locator('.completion-pet-visual[data-pet="haloform"]');
  const visual = petVisual.locator(".halo-pet-body");
  await expect(root).toHaveAttribute("data-preview", "true");
  await expect(companion).toHaveCSS("width", "116px");
  await expect(companion).toHaveCSS("height", "88px");
  await expect(visual).toHaveCSS("width", "78px");
  await expect(visual).toHaveCSS("height", "78px");
  await expect(visual).toHaveCSS("background-size", "234px 78px");
  await expect(page.getByRole("status")).toHaveText("Pet setup preview.");
  await companion.focus();
  await expect(petVisual).toHaveCSS("filter", /drop-shadow/);

  await page.setViewportSize({ width: 260, height: 230 });
  await companion.click();
  const dialog = page.getByRole("dialog", { name: "Pet setup preview controls" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Start .*break/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Later" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Choose Movement Break exercise" })).toHaveCount(0);
  const close = dialog.getByRole("button", { name: "Close" });
  await expect(close).toBeFocused();
  await expect(page.locator(".completion-pet-context")).toHaveText("Setup preview");
});

test("reduced motion holds Haloform on the meaningful Done final frame", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 116, height: 88 });
  await page.goto("/?surface=pet&demoPet=1");
  const body = page.locator('.completion-pet-visual[data-pet="haloform"] .halo-pet-body');
  await expect(body).toHaveCSS("animation-name", "none");
  await expect(body).toHaveCSS("background-position", "-234px 0px");
});

test("Haloform keeps square generic geometry at 1× and 1.5×", async ({ page }) => {
  const cases = [
    { size: "small", body: 39, top: 25, left: 39 },
    { size: "medium", body: 59, top: 15, left: 29 },
  ] as const;
  for (const candidate of cases) {
    await page.setViewportSize({ width: 116, height: 88 });
    await page.goto(`/?surface=pet&demoPet=1&demoPetSize=${candidate.size}`);
    const root = page.locator(".completion-pet-root");
    const companion = page.getByRole("button", { name: "Focus complete. Open break actions" });
    const body = page.locator('.completion-pet-visual[data-pet="haloform"] .halo-pet-body');
    await expect(root).toHaveAttribute("data-pet-size", candidate.size);
    await expect(companion).toHaveCSS("width", "116px");
    await expect(companion).toHaveCSS("height", "88px");
    await expect(body).toHaveCSS("width", `${candidate.body}px`);
    await expect(body).toHaveCSS("height", `${candidate.body}px`);
    await expect(body).toHaveCSS("top", `${candidate.top}px`);
    await expect(body).toHaveCSS("left", `${candidate.left}px`);
    await page.setViewportSize({ width: 260, height: 230 });
    await companion.click();
    await expect(companion).toHaveCSS("left", "72px");
    await expect(companion).toHaveCSS("top", "72px");
  }
});

test("Movement Break opens a two-exercise picker before any explicit camera action", async ({ page }) => {
  await page.setViewportSize({ width: 260, height: 230 });
  await page.goto("/?surface=pet&demoPet=1");
  await expect(page.getByRole("dialog", { name: "10 Squats movement break" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "10 Overhead Reaches movement break" })).toHaveCount(0);
  await page.getByRole("button", { name: "Focus complete. Open break actions" }).click();
  await expect(page.getByRole("button", { name: "Start Short break" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Later" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
  await page.getByRole("button", { name: "Choose Movement Break exercise" }).click();
  const picker = page.getByRole("dialog", { name: "Choose movement break exercise" });
  const squats = picker.getByRole("button", { name: "Start 10 Squats movement break" });
  const reaches = picker.getByRole("button", { name: "Start 10 Overhead Reaches movement break" });
  await expect(squats).toBeFocused();
  await expect(squats).toContainText("Lower body");
  await expect(reaches).toContainText("Upper body");
  const [contextBox, squatBox] = await Promise.all([
    picker.getByText("Pick one · camera starts next").boundingBox(),
    squats.boundingBox(),
  ]);
  expect(contextBox).not.toBeNull();
  expect(squatBox).not.toBeNull();
  expect(contextBox!.height).toBeLessThan(30);
  expect(contextBox!.y + contextBox!.height).toBeLessThan(squatBox!.y);
  await expect(page.getByRole("dialog", { name: /movement break$/ })).toHaveCount(0);
  await page.setViewportSize({ width: 600, height: 420 });
  await squats.click();
  const challenge = page.getByRole("dialog", { name: "10 Squats movement break" });
  await expect(challenge).toBeVisible();
  await expect(challenge.getByRole("button", { name: "Close movement break" })).toBeFocused();
  await expect(challenge.getByText("Live view only · no video or audio saved")).toBeVisible();
  await expect(challenge.getByRole("progressbar", { name: "Squat depth" })).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Start 10 Squats movement break" })).toBeFocused();
  await page.getByRole("button", { name: "Back to break actions" }).click();
  await expect(page.getByRole("button", { name: "Choose Movement Break exercise" })).toBeFocused();
});

test("Overhead Reach starts the shared camera only after its specific exercise click", async ({ page }) => {
  await page.addInitScript(() => {
    const controlled = window as typeof window & { __reachCameraRequests: number; __reachPreviewStops: number; __TAURI_INTERNALS__: unknown };
    controlled.__reachCameraRequests = 0;
    controlled.__reachPreviewStops = 0;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#57545f";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const stream = canvas.captureStream(15);
    const track = stream.getVideoTracks()[0]!;
    const originalStop = track.stop.bind(track);
    track.stop = () => { controlled.__reachPreviewStops += 1; originalStop(); };
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: async () => { controlled.__reachCameraRequests += 1; return stream; } },
      configurable: true,
    });
    controlled.__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "completion_pet_state") {
          const summon = { schemaVersion: 2, id: "reach-focus", purpose: "focus-completion", pet: "haloform", petSize: "large", movementBreakEnabled: true, nextPhase: "short-break" };
          return {
            summon,
            projection: {
              schemaVersion: 2,
              summon,
              sessionStatus: "working",
              activityKind: "session",
              dataState: "working",
              motionMapping: { idle: "idle", working: "working", attention: "attention", done: "done", error: "error" },
              replayId: "reach-focus:working",
            },
          };
        }
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 600, height: 420 });
  await page.goto("/?surface=pet&demoPose=1");
  await page.getByRole("button", { name: "Focus complete. Open break actions" }).click();
  await page.getByRole("button", { name: "Choose Movement Break exercise" }).click();
  expect(await page.evaluate(() => (window as typeof window & { __reachCameraRequests: number }).__reachCameraRequests)).toBe(0);
  await page.getByRole("button", { name: "Start 10 Overhead Reaches movement break" }).click();
  const challenge = page.getByRole("dialog", { name: "10 Overhead Reaches movement break" });
  await expect(challenge).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __reachCameraRequests: number }).__reachCameraRequests)).toBe(1);
  await expect(challenge.getByRole("progressbar", { name: "Reach height" })).toHaveAttribute("aria-valuenow", "72");
  await expect(page.locator('.movement-tracking-line[data-label="HANDS"]')).toHaveAttribute("style", /^top: 28/);
  await expect(page.locator('.movement-target-line[data-label="REACH ABOVE"]')).toHaveAttribute("style", "top: 36%;");
  await challenge.getByRole("button", { name: "Close movement break" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __reachPreviewStops: number }).__reachPreviewStops)).toBe(1);
});

test("native Movement Break queues one completion result without mounting Pomodoro ownership", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __movementNativeCalls: typeof calls }).__movementNativeCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "completion_pet_state") {
          const summon = { schemaVersion: 2, id: "movement-focus", purpose: "focus-completion", pet: "haloform", petSize: "large", movementBreakEnabled: true, nextPhase: "short-break" };
          return {
            summon,
            projection: {
              schemaVersion: 2,
              summon,
              sessionStatus: "working",
              activityKind: "session",
              dataState: "working",
              motionMapping: { idle: "idle", working: "working", attention: "attention", done: "done", error: "error" },
              replayId: "movement-focus:working",
            },
          };
        }
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 600, height: 420 });
  await page.goto("/?surface=pet&demoCameraOff=1&demoMovementCompleted=1");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __movementNativeCalls: Array<{ command: string }> }).__movementNativeCalls.some((call) => call.command === "completion_pet_state"))).toBe(true);
  await page.getByRole("button", { name: "Focus complete. Open break actions" }).click();
  await page.getByRole("button", { name: "Choose Movement Break exercise" }).click();
  await page.getByRole("button", { name: "Start 10 Overhead Reaches movement break" }).click();
  await expect(page.getByRole("dialog", { name: "10 Overhead Reaches movement break" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Celebration" })).toBeVisible();
  await expect(page.locator(".movement-tracking-line, .movement-target-line")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __movementNativeCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__movementNativeCalls.some((call) => call.command === "set_completion_pet_movement" && call.args?.active === true && call.args?.summonId === "movement-focus"))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __movementNativeCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__movementNativeCalls.filter((call) => call.command === "submit_completion_pet_action" && call.args?.action === "movement-complete").length)).toBe(1);
  expect(await page.evaluate(() => window.localStorage.getItem("agent-halo.pomodoro"))).toBeNull();
});

test("Movement attempt remains cancellable and clears its native attempt token", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __movementCancelCalls: typeof calls }).__movementCancelCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "completion_pet_state") {
          const summon = { schemaVersion: 2, id: "movement-permission", purpose: "focus-completion", pet: "haloform", petSize: "large", movementBreakEnabled: true, nextPhase: "short-break" };
          return {
            summon,
            projection: {
              schemaVersion: 2,
              summon,
              sessionStatus: "working",
              activityKind: "session",
              dataState: "working",
              motionMapping: { idle: "idle", working: "working", attention: "attention", done: "done", error: "error" },
              replayId: "movement-permission:working",
            },
          };
        }
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 600, height: 420 });
  await page.goto("/?surface=pet&demoCameraOff=1");
  await page.getByRole("button", { name: "Focus complete. Open break actions" }).click();
  await page.getByRole("button", { name: "Choose Movement Break exercise" }).click();
  await page.getByRole("button", { name: "Start 10 Squats movement break" }).click();
  const close = page.getByRole("button", { name: "Close movement break" });
  await expect(close).toBeEnabled();
  const challenge = page.getByRole("dialog", { name: "10 Squats movement break" });
  await expect(challenge).toHaveAttribute("data-draggable", "true");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __movementCancelCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__movementCancelCalls.filter((call) => call.command === "nudge_completion_pet").map((call) => call.args))).toEqual([{ dx: 16, dy: 0 }, { dx: 0, dy: -48 }]);
  await close.click();
  await expect(page.getByRole("button", { name: "Start 10 Squats movement break" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __movementCancelCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__movementCancelCalls.filter((call) => call.command === "set_completion_pet_movement" && call.args?.active === false && call.args?.summonId === "movement-permission").length)).toBe(1);
});

test("authorized Movement Break shows a live preview with fixed target and stops its stream", async ({ page }) => {
  await page.addInitScript(() => {
    const controlled = window as typeof window & { __previewStops: number; __TAURI_INTERNALS__: unknown };
    controlled.__previewStops = 0;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#57545f";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const stream = canvas.captureStream(15);
    const track = stream.getVideoTracks()[0]!;
    const originalStop = track.stop.bind(track);
    track.stop = () => { controlled.__previewStops += 1; originalStop(); };
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => stream }, configurable: true });
    controlled.__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        if (command === "completion_pet_state") {
          const summon = { schemaVersion: 2, id: "preview-focus", purpose: "focus-completion", pet: "haloform", petSize: "large", movementBreakEnabled: true, nextPhase: "short-break" };
          return {
            summon,
            projection: {
              schemaVersion: 2,
              summon,
              sessionStatus: "working",
              activityKind: "session",
              dataState: "working",
              motionMapping: { idle: "idle", working: "working", attention: "attention", done: "done", error: "error" },
              replayId: "preview-focus:working",
            },
          };
        }
        if (command === "set_completion_pet_movement" && args?.active === false) throw new Error("resize failed");
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 600, height: 420 });
  await page.goto("/?surface=pet&demoPose=1");
  await page.getByRole("button", { name: "Focus complete. Open break actions" }).click();
  await page.getByRole("button", { name: "Choose Movement Break exercise" }).click();
  await page.getByRole("button", { name: "Start 10 Squats movement break" }).click();
  await expect(page.locator('video[aria-label="Live mirrored Movement Break camera"]')).toBeVisible();
  await expect(page.locator(".movement-tracking-line")).toHaveCount(1);
  await expect(page.locator(".movement-target-line")).toHaveCount(1);
  await expect(page.locator(".movement-target-line")).toHaveAttribute("style", "top: 86%;");
  await page.locator(".movement-tracking-line").evaluate((line) => { line.style.top = "70%"; });
  await expect(page.locator(".movement-tracking-line")).toHaveAttribute("style", "top: 70%;");
  await expect(page.locator(".movement-target-line")).toHaveAttribute("style", "top: 86%;");
  await expect(page.getByText("48% to target")).toBeVisible();
  await page.getByRole("button", { name: "Close movement break" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __previewStops: number }).__previewStops)).toBe(1);
});

test("shoulder-line counter counts white-to-green then standing traversal", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const { ShoulderSquatCounter } = await import("/src/features/movement/squat.ts");
    const counter = new ShoulderSquatCounter();
    const standing = { shoulderY: 0.3, confidence: 0.95 };
    const bottom = { shoulderY: 0.86, confidence: 0.95 };
    const targetBeforeCalibration = counter.targetLineY;
    const events = [0, 80, 160, 240, 320, 400, 480].map((time) => counter.update(time, standing));
    events.push(counter.update(600, bottom), counter.update(800, bottom), counter.update(1_000, standing), counter.update(1_200, standing));
    return { count: counter.count, final: events.at(-1), targetBeforeCalibration, targetAfterMovement: counter.targetLineY };
  });
  expect(result).toEqual({ count: 1, final: "rep", targetBeforeCalibration: 0.86, targetAfterMovement: 0.86 });
});

test("Overhead Reach counts only a complete both-hands down-up-down cycle", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const { OverheadReachCounter } = await import("/src/features/movement/overhead-reach.ts");
    const counter = new OverheadReachCounter();
    const down = { shoulderY: 0.44, wristY: 0.61, leftRaiseDistance: -0.17, rightRaiseDistance: -0.17, confidence: 0.96 };
    const oneHandOnly = { shoulderY: 0.44, wristY: 0.4, leftRaiseDistance: 0.16, rightRaiseDistance: -0.08, confidence: 0.96 };
    const overhead = { shoulderY: 0.44, wristY: 0.27, leftRaiseDistance: 0.17, rightRaiseDistance: 0.17, confidence: 0.96 };
    const events = [counter.update(0, down), counter.update(200, oneHandOnly), counter.update(400, oneHandOnly)];
    const countAfterOneHand = counter.count;
    events.push(counter.update(600, overhead), counter.update(800, overhead), counter.update(1_000, down), counter.update(1_200, down));
    return { countAfterOneHand, count: counter.count, final: events.at(-1), progress: counter.progress };
  });
  expect(result).toEqual({ countAfterOneHand: 0, count: 1, final: "rep", progress: 0 });
});

test("bundled pose runtime initializes without a remote model request", async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:47622")) remoteRequests.push(request.url());
  });
  await page.goto("/?demo=1&demoScenario=idle");
  const initialized = await page.evaluate(async () => {
    const { createLocalPoseLandmarker } = await import("/src/features/movement/runtime.ts");
    const landmarker = await createLocalPoseLandmarker();
    landmarker.close();
    return true;
  });
  expect(initialized).toBe(true);
  expect(remoteRequests).toEqual([]);
});
