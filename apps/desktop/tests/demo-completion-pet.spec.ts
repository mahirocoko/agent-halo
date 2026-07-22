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

test("Halo Bot completion keeps the selected loadout and square pixel geometry", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("agent-halo.halo-bot-loadout", "f061");
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "completion_pet_state") return {
          summon: { schemaVersion: 1, id: "halo-bot-pet", pet: "halo-bot", loadout: "f061", petSize: "large", preview: false, nextPhase: "short-break", title: "Focus complete", actionLabel: "Start Short break" },
        };
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
  await expect(body).toHaveCSS("background-size", "234px 78px");
  await expect(body).toHaveCSS("background-image", /\/body\/halo-bot\/f061\/working\.png/);
  await expect(body).toHaveCSS("image-rendering", "pixelated");
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

test("global Ember Starling completion exposes the prepared break actions", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "completion_pet_state") return {
          summon: { schemaVersion: 1, id: "ember-focus", pet: "ember-starling", petSize: "large", visual: "ember-starling", preview: false, movementBreakEnabled: false, nextPhase: "short-break", title: "Focus complete", actionLabel: "Start Short break" },
        };
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 260, height: 270 });
  await page.goto("/?surface=pet");
  const root = page.locator(".completion-pet-root");
  const companion = page.getByRole("button", { name: "Focus complete. Open break actions" });
  await expect(root).toHaveAttribute("data-visual", "ember-starling");
  await expect(page.getByRole("status")).toHaveText("Focus complete. Short break ready.");
  await companion.click();
  const dialog = page.getByRole("dialog", { name: "Focus complete actions" });
  await expect(dialog.getByRole("button", { name: "Start Short break" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Start Short break" })).toHaveCSS("z-index", "4");
  await expect(dialog.getByRole("button", { name: "Start Short break" })).toHaveText(/Short\s*break/);
  await expect(dialog.getByText("Short break ready")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Not now" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Hide completion pet" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Start 10 Squats movement break" })).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Not now" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Not now" })).toHaveCSS("outline-width", "2px");
});

test("global Ember Starling preview uses its isolated large dismiss-only surface", async ({ page }) => {
  await page.setViewportSize({ width: 100, height: 120 });
  await page.goto("/?surface=pet&demoEmberPet=1");
  const root = page.locator(".completion-pet-root");
  const companion = page.getByRole("button", { name: "Ember Starling preview. Open controls" });
  const visual = page.locator(".completion-pet-ember-starling");
  await expect(root).toHaveAttribute("data-visual", "ember-starling");
  await expect(root).toHaveAttribute("data-preview", "true");
  await expect(companion).toHaveCSS("width", "100px");
  await expect(companion).toHaveCSS("height", "120px");
  await expect(visual).toHaveCSS("width", "88px");
  await expect(visual).toHaveCSS("height", "108px");
  await expect(visual).toHaveCSS("background-size", "400% 100%");
  await expect(visual).toHaveCSS("animation-name", "ember-starling-working");
  await expect(page.locator(".completion-pet-visual")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Ember Starling preview.");
  await companion.focus();
  await expect(visual).toHaveCSS("filter", /drop-shadow/);

  await page.setViewportSize({ width: 260, height: 270 });
  await companion.click();
  const dialog = page.getByRole("dialog", { name: "Ember Starling preview controls" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Start .*break/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Not now" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Start 10 Squats movement break" })).toHaveCount(0);
  const close = dialog.getByRole("button", { name: "Hide Ember Starling preview" });
  await expect(close).toBeFocused();
  await expect(close).toHaveCSS("z-index", "4");
  await expect(page.locator(".completion-pet-context")).toHaveCount(0);
  await expect(companion).toHaveCSS("left", "80px");
  await expect(companion).toHaveCSS("top", "60px");
});

test("reduced motion holds Ember Starling on its first frame", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 100, height: 120 });
  await page.goto("/?surface=pet&demoEmberPet=1");
  await expect(page.locator(".completion-pet-ember-starling")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".completion-pet-ember-starling")).toHaveCSS("background-position", "0px 0px");
});

test("Ember Starling keeps tight native geometry at 1× and 1.5×", async ({ page }) => {
  const cases = [
    { size: "small", viewport: [56, 66], companion: [56, 66], visual: [44, 54], expanded: [102, 87] },
    { size: "medium", viewport: [78, 93], companion: [78, 93], visual: [66, 81], expanded: [91, 73.5] },
  ] as const;
  for (const candidate of cases) {
    await page.setViewportSize({ width: candidate.viewport[0], height: candidate.viewport[1] });
    await page.goto(`/?surface=pet&demoEmberPet=1&demoPetSize=${candidate.size}`);
    const root = page.locator(".completion-pet-root");
    const companion = page.getByRole("button", { name: "Ember Starling preview. Open controls" });
    const visual = page.locator(".completion-pet-ember-starling");
    await expect(root).toHaveAttribute("data-pet-size", candidate.size);
    await expect(companion).toHaveCSS("width", `${candidate.companion[0]}px`);
    await expect(companion).toHaveCSS("height", `${candidate.companion[1]}px`);
    await expect(visual).toHaveCSS("width", `${candidate.visual[0]}px`);
    await expect(visual).toHaveCSS("height", `${candidate.visual[1]}px`);
    await page.setViewportSize({ width: 260, height: 270 });
    await companion.click();
    await expect(companion).toHaveCSS("left", `${candidate.expanded[0]}px`);
    await expect(companion).toHaveCSS("top", `${candidate.expanded[1]}px`);
  }
});

test("Movement Break starts camera tracking only after the explicit 10 Squats action", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 420 });
  await page.goto("/?surface=pet&demoPet=1");
  await expect(page.getByRole("dialog", { name: "10 Squats movement break" })).toHaveCount(0);
  await page.getByRole("button", { name: "Focus complete. Open break actions" }).click();
  await expect(page.getByRole("button", { name: "Start Short break" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Not now" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide completion pet" })).toBeVisible();
  await page.getByRole("button", { name: "Start 10 Squats movement break" }).click();
  const challenge = page.getByRole("dialog", { name: "10 Squats movement break" });
  await expect(challenge).toBeVisible();
  await expect(challenge.getByRole("button", { name: "Close movement break" })).toBeFocused();
  await expect(challenge.getByText("Live view only · no video or audio saved")).toBeVisible();
  await expect(challenge.getByRole("progressbar", { name: "Squat depth" })).toHaveAttribute("aria-valuenow", "0");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Start 10 Squats movement break" })).toBeFocused();
});

test("native Movement Break queues one completion result without mounting Pomodoro ownership", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __movementNativeCalls: typeof calls }).__movementNativeCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "completion_pet_state") return {
          summon: { schemaVersion: 1, id: "movement-focus", pet: "scorpion", petSize: "large", preview: false, movementBreakEnabled: true, nextPhase: "short-break", title: "Focus complete", actionLabel: "Start Short break" },
        };
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 600, height: 420 });
  await page.goto("/?surface=pet&demoCameraOff=1&demoMovementCompleted=1");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __movementNativeCalls: Array<{ command: string }> }).__movementNativeCalls.some((call) => call.command === "completion_pet_state"))).toBe(true);
  await page.getByRole("button", { name: "Focus complete. Open break actions" }).click();
  await page.getByRole("button", { name: "Start 10 Squats movement break" }).click();
  await expect(page.getByRole("img", { name: "Celebration" })).toBeVisible();
  await expect(page.locator(".movement-shoulder-line, .movement-target-line")).toHaveCount(0);
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
        if (command === "completion_pet_state") return {
          summon: { schemaVersion: 1, id: "movement-permission", pet: "scorpion", petSize: "large", preview: false, movementBreakEnabled: true, nextPhase: "short-break", title: "Focus complete", actionLabel: "Start Short break" },
        };
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 600, height: 420 });
  await page.goto("/?surface=pet&demoCameraOff=1");
  await page.getByRole("button", { name: "Focus complete. Open break actions" }).click();
  await page.getByRole("button", { name: "Start 10 Squats movement break" }).click();
  const close = page.getByRole("button", { name: "Close movement break" });
  await expect(close).toBeEnabled();
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
        if (command === "completion_pet_state") return { summon: { schemaVersion: 1, id: "preview-focus", pet: "scorpion", petSize: "large", preview: false, movementBreakEnabled: true, nextPhase: "short-break", title: "Focus complete", actionLabel: "Start Short break" } };
        if (command === "set_completion_pet_movement" && args?.active === false) throw new Error("resize failed");
        return null;
      },
    };
  });
  await page.setViewportSize({ width: 600, height: 420 });
  await page.goto("/?surface=pet&demoPose=1");
  await page.getByRole("button", { name: "Focus complete. Open break actions" }).click();
  await page.getByRole("button", { name: "Start 10 Squats movement break" }).click();
  await expect(page.locator('video[aria-label="Live mirrored Movement Break camera"]')).toBeVisible();
  await expect(page.locator(".movement-shoulder-line")).toHaveCount(1);
  await expect(page.locator(".movement-target-line")).toHaveCount(1);
  await expect(page.locator(".movement-target-line")).toHaveAttribute("style", "top: 86%;");
  await page.locator(".movement-shoulder-line").evaluate((line) => { line.style.top = "70%"; });
  await expect(page.locator(".movement-shoulder-line")).toHaveAttribute("style", "top: 70%;");
  await expect(page.locator(".movement-target-line")).toHaveAttribute("style", "top: 86%;");
  await expect(page.getByText("48% to target")).toBeVisible();
  await page.getByRole("button", { name: "Close movement break" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __previewStops: number }).__previewStops)).toBe(1);
});

test("shoulder-line counter counts white-to-green then standing traversal", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const { ShoulderSquatCounter } = await import("/src/features/movement/model.ts");
    const counter = new ShoulderSquatCounter();
    const standing = { shoulderY: 0.3, confidence: 0.95 };
    const bottom = { shoulderY: 0.86, confidence: 0.95 };
    const targetBeforeCalibration = counter.targetLineY;
    const events = [0, 80, 160, 240, 320, 400, 480].map((time) => counter.update(time, standing));
    events.push(counter.update(600, bottom), counter.update(800, bottom), counter.update(1_000, standing), counter.update(1_200, standing));
    return { count: counter.count, final: events.at(-1)?.type, targetBeforeCalibration, targetAfterMovement: counter.targetLineY };
  });
  expect(result).toEqual({ count: 1, final: "rep", targetBeforeCalibration: 0.86, targetAfterMovement: 0.86 });
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
