import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("every surface uses the Ember Starling default with no random palette", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=long-llm");

  const pet = page.locator('.session-row .halo-pet[data-state="working"][data-signal="thinking-model"]');
  await expect(pet).toHaveCount(1);
  const initialPet = await pet.getAttribute("data-pet");
  const roster = ["pot", "crawler", "bat", "jelly", "cat", "crt", "cactus", "nautilus", "turtle", "lantern", "kettle", "dragonfly", "giraffe", "scorpion", "squid", "ember-starling"];
  expect(roster).toContain(initialPet);
  expect(initialPet).toBe("ember-starling");
  expect(await pet.getAttribute("data-palette")).toBeNull();
  await expect(pet.locator(".halo-pet-body")).toHaveCSS("background-size", "108px 36px");
  const signal = pet.locator(".halo-pet-signal");
  await expect(signal).toHaveCSS("background-size", "80px 20px");
  await expect(signal).toHaveCSS("left", "40px");
  await expect(signal).toHaveCSS("top", "8px");
  await expect(signal).toHaveCSS("width", "20px");
  await expect(signal).toHaveCSS("height", "20px");

  const dimensions = await pet.evaluate(async (element) => {
    const body = getComputedStyle(element.querySelector(".halo-pet-body")!).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    const signal = getComputedStyle(element.querySelector(".halo-pet-signal")!).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    const read = async (url: string | undefined) => {
      if (!url) return null;
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      return [bitmap.width, bitmap.height];
    };
    return { body: await read(body), signal: await read(signal) };
  });
  expect(dimensions).toEqual({ body: [432, 144], signal: [80, 20] });

  const ambientPet = page.locator(".activity-pet.halo-pet");
  await expect(ambientPet).toHaveCSS("width", "58px");
  await expect(ambientPet).toHaveCSS("height", "30px");
  await expect(ambientPet.locator(".halo-pet-body")).toHaveCSS("width", "30px");
  await expect(ambientPet.locator(".halo-pet-body")).toHaveCSS("height", "30px");
  await expect(ambientPet.locator(".halo-pet-body")).toHaveCSS("top", "0px");
  await expect(ambientPet.locator(".halo-pet-signal")).toHaveCSS("left", "34px");
  await expect(ambientPet.locator(".halo-pet-signal")).toHaveCSS("top", "5px");

  await page.reload();
  await expect(page.locator(".session-row .halo-pet")).toHaveAttribute("data-pet", initialPet ?? "");
});

test("pet normalization defaults invalid or missing values to Ember Starling", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const { getHaloPetName, HALO_PET_ROSTER } = await import("/src/features/session/HaloPet.tsx");
    return {
      fallback: getHaloPetName(null),
      invalid: getHaloPetName("/Users/mahiro/Git/one"),
      selected: getHaloPetName("crt"),
      roster: [...HALO_PET_ROSTER],
    };
  });
  expect(result.fallback).toBe("ember-starling");
  expect(result.invalid).toBe("ember-starling");
  expect(result.selected).toBe("crt");
  expect(result.roster).toHaveLength(16);
});

test("legacy mascot preference migrates once into the Pet key", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("agent-halo.mascot", "crt"));
  await page.goto("/?demo=1&demoScenario=idle");
  await expect(page.locator(".session-row .halo-pet")).toHaveAttribute("data-pet", "crt");
  expect(await page.evaluate(() => window.localStorage.getItem("agent-halo.pet"))).toBe("crt");
});

test("an existing explicit Scorpion selection remains intact", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("agent-halo.pet", "scorpion"));
  await page.goto("/?demo=1&demoScenario=idle");
  await expect(page.locator(".session-row .halo-pet")).toHaveAttribute("data-pet", "scorpion");
  expect(await page.evaluate(() => window.localStorage.getItem("agent-halo.pet"))).toBe("scorpion");
});

test("setup selects one global pet and persists the preference", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=long-llm");
  await expect(page.locator(".session-row .halo-pet")).toHaveAttribute("data-pet", "ember-starling");

  await page.getByRole("button", { name: "Setup" }).click();
  await page.getByRole("tab", { name: "Pet" }).click();
  const petRow = page.locator(".pet-setting-row");
  await petRow.getByRole("button", { name: /Choose/ }).click();
  const picker = page.getByRole("radiogroup", { name: "Pet", exact: true });
  const radios = picker.getByRole("radio");
  await expect(radios).toHaveCount(16);
  const emberOption = picker.getByRole("radio", { name: "Ember Starling" });
  await expect(emberOption).toHaveAttribute("aria-checked", "true");
  await expect(emberOption).toBeFocused();
  expect(await radios.evaluateAll((options) => options.filter((option) => option.tabIndex === 0).length)).toBe(1);

  await emberOption.press("ArrowRight");
  const potOption = picker.getByRole("radio", { name: "Pot" });
  await expect(potOption).toHaveAttribute("aria-checked", "true");
  await expect(potOption).toBeFocused();
  await potOption.press("Escape");
  await expect(petRow.getByRole("button", { name: /Choose/ })).toBeFocused();

  await petRow.getByRole("button", { name: /Choose/ }).click();
  await picker.getByRole("radio", { name: "CRT" }).click();
  await page.getByRole("button", { name: "Back to sessions" }).click();
  await expect(page.locator(".session-row .halo-pet")).toHaveAttribute("data-pet", "crt");
  await expect(page.locator(".activity-pet.halo-pet")).toHaveAttribute("data-pet", "crt");
  await page.locator(".session-row-main").click();
  await expect(page.locator(".session-context-summary .halo-pet")).toHaveAttribute("data-pet", "crt");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("agent-halo.pet"))).toBe("crt");
  const stored = await page.evaluate(async () => (await import("/src/features/session/petPreference.ts")).readHaloPetPreference());
  expect(stored).toBe("crt");
});

test("Setup owns one global Completion Pet toggle", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("button", { name: "Setup" }).click();
  await page.getByRole("tab", { name: "Pet" }).click();
  const row = page.locator(".setup-row").filter({ has: page.locator(".setup-title", { hasText: /^Completion Pet$/ }) });
  await expect(row).toContainText("Shows after a completed Focus");
  const toggle = row.getByRole("switch", { name: "Disable completion pet" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(row).toContainText("Off · uses a macOS notification");
  await expect(row.getByRole("switch", { name: "Enable completion pet" })).toHaveText("Off");
  await expect(row.getByRole("switch", { name: "Enable completion pet" })).toHaveAttribute("aria-checked", "false");
  expect(await page.evaluate(() => window.localStorage.getItem("agent-halo.completion-pet-enabled"))).toBe("false");
});

test("Movement Break is opt-in with truthful local camera copy", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("button", { name: "Setup" }).click();
  await page.getByRole("tab", { name: "Pet" }).click();
  const row = page.locator(".setup-row").filter({ has: page.locator(".setup-title", { hasText: /^Movement break$/ }) });
  await expect(row).toContainText("Off · hidden from future completions");
  const toggle = row.getByRole("switch", { name: "Enable movement break" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(row).toContainText("10 squats · camera only after you choose it");
  await expect(page.getByRole("note")).toContainText("Pose analysis stays on this Mac; no video or audio is saved.");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("agent-halo.movement-break-enabled"))).toBe("true");
});

test("disabling future Movement Breaks does not dismiss an active completion Pet", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("agent-halo.movement-break-enabled", "true");
    const calls: Array<{ command: string }> = [];
    (window as typeof window & { __movementSettingCalls: typeof calls }).__movementSettingCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command });
        if (command === "take_completion_pet_action") return null;
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        if (command === "display_state" || command === "reconcile_display") return { displays: [], preferredDisplayId: null, preferredDisplayName: null, selectedDisplayId: null, activeDisplayId: null, fallbackActive: false };
        return null;
      },
    };
  });
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("button", { name: "Setup" }).click();
  await page.getByRole("tab", { name: "Pet" }).click();
  await page.getByRole("switch", { name: "Disable movement break" }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("agent-halo.movement-break-enabled"))).toBe("false");
  expect(await page.evaluate(() => (window as typeof window & { __movementSettingCalls: Array<{ command: string }> }).__movementSettingCalls.some((call) => call.command === "hide_completion_pet"))).toBe(false);
});

test("Pet Setup persists floating size and shows an isolated native preview", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as typeof window & { __petPreviewCalls: typeof calls }).__petPreviewCalls = calls;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "show_completion_pet") return true;
        if (command === "take_completion_pet_action") return null;
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return args?.active === true;
        if (command === "agent_halo_mod_status") return ["", false];
        if (command === "display_state" || command === "reconcile_display") return { displays: [], preferredDisplayId: null, preferredDisplayName: null, selectedDisplayId: null, activeDisplayId: null, fallbackActive: false };
        return null;
      },
    };
  });
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("button", { name: "Setup" }).click();
  await page.getByRole("tab", { name: "Pet" }).click();
  const sizes = page.getByRole("radiogroup", { name: "Completion Pet size" });
  await expect(sizes.getByRole("radio", { name: "2×" })).toHaveAttribute("aria-checked", "true");
  await expect(sizes.getByRole("radio", { name: "2×" })).toHaveAttribute("tabindex", "0");
  await sizes.getByRole("radio", { name: "1.5×" }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("agent-halo.completion-pet-size"))).toBe("medium");
  await sizes.getByRole("radio", { name: "1.5×" }).press("ArrowLeft");
  await expect(sizes.getByRole("radio", { name: "1×" })).toBeFocused();
  await expect(sizes.getByRole("radio", { name: "1×" })).toHaveAttribute("aria-checked", "true");
  await sizes.getByRole("radio", { name: "1.5×" }).click();
  await page.getByRole("button", { name: "Show Completion Pet preview" }).click();
  await expect(page.getByText("Pet preview shown")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show Completion Pet preview" })).toHaveText(/Show again/);
  const show = await page.evaluate(() => (window as typeof window & { __petPreviewCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__petPreviewCalls.find((call) => call.command === "show_completion_pet"));
  expect(show?.args?.summon).toMatchObject({ pet: "ember-starling", petSize: "medium", visual: "ember-starling", preview: true, title: "Pet preview", actionLabel: "" });
  await sizes.getByRole("radio", { name: "2×" }).click();
  await expect(page.getByText("Settings changed · update preview")).toBeVisible();
  const update = page.getByRole("button", { name: "Update Completion Pet preview" });
  await expect(update).toHaveText(/Update Pet/);
  await update.click();
  await expect(page.getByRole("button", { name: "Show Completion Pet preview" })).toHaveText(/Show again/);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __petPreviewCalls: Array<{ command: string }> }).__petPreviewCalls.filter((call) => call.command === "show_completion_pet").length)).toBe(2);
  await sizes.getByRole("radio", { name: "1×" }).click();
  await expect(page.getByText("Settings changed · update preview")).toBeVisible();
  const updateEmber = page.getByRole("button", { name: "Update Completion Pet preview" });
  await expect(updateEmber).toHaveText(/Update Pet/);
  await updateEmber.click();
  const updatedEmberShow = await page.evaluate(() => (window as typeof window & { __petPreviewCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__petPreviewCalls.filter((call) => call.command === "show_completion_pet").pop());
  expect(updatedEmberShow?.args?.summon).toMatchObject({ petSize: "small", visual: "ember-starling", preview: true });
});

test("every ActivityKind maps to one bounded signal group", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const mappings = await page.evaluate(async () => {
    const { getHaloPetSignal } = await import("/src/features/session/HaloPet.tsx");
    const kinds = [
      "session", "thinking", "planning", "tool", "shell", "editing",
      "delegating", "visual", "memory", "asking", "skill", "goal",
      "compact", "model", "attention", "done", "error", "bridge",
    ] as const;
    return Object.fromEntries(kinds.map((kind) => [kind, getHaloPetSignal("working", kind)]));
  });
  expect(mappings).toEqual({
    session: "none",
    thinking: "thinking-model",
    planning: "planning-goal",
    tool: "shell-tool-skill",
    shell: "shell-tool-skill",
    editing: "editing",
    delegating: "delegating",
    visual: "visual",
    memory: "memory",
    asking: "attention-asking",
    skill: "shell-tool-skill",
    goal: "planning-goal",
    compact: "memory",
    model: "thinking-model",
    attention: "attention-asking",
    done: "done",
    error: "error",
    bridge: "none",
  });
});

test("status precedence hides stale signals and preserves truthful terminal signals", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const { getHaloPetSignal } = await import("/src/features/session/HaloPet.tsx");
    return {
      idleShell: getHaloPetSignal("idle", "shell"),
      inactiveError: getHaloPetSignal("inactive", "error"),
      attentionShell: getHaloPetSignal("attention", "shell"),
      doneShell: getHaloPetSignal("done", "shell"),
      errorThinking: getHaloPetSignal("error", "thinking"),
    };
  });
  expect(result).toEqual({
    idleShell: "none",
    inactiveError: "none",
    attentionShell: "attention-asking",
    doneShell: "done",
    errorThinking: "error",
  });
});

test("production roster manifest preserves every body and shared signal hash", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const manifest = await (await fetch("/mascots/agent-halo-roster/manifest.json")).json() as {
      humanApproved: boolean;
      productionApproved: boolean;
      mainMascot: string;
      mainPet: string;
      defaultMascot: string;
      defaultPet: string;
      assignment: { status: string; storageKey: string; projectHashing: boolean; colorRandomization: boolean };
      signal: { idleIncluded: boolean; status: string };
      files: Record<string, string>;
    };
    const entries = Object.entries(manifest.files);
    const files = await Promise.all(entries.map(async ([path, expectedHash]) => {
      const response = await fetch(`/mascots/agent-halo-roster/${path}`);
      const bytes = await response.arrayBuffer();
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      return { path, size: [bitmap.width, bitmap.height], hashMatches: digest === expectedHash };
    }));
    return {
      humanApproved: manifest.humanApproved,
      productionApproved: manifest.productionApproved,
      mainMascot: manifest.mainMascot,
      mainPet: manifest.mainPet,
      defaultMascot: manifest.defaultMascot,
      defaultPet: manifest.defaultPet,
      assignment: manifest.assignment,
      signalStatus: manifest.signal.status,
      idleIncluded: manifest.signal.idleIncluded,
      files,
    };
  });
  expect(result.humanApproved).toBe(true);
  expect(result.productionApproved).toBe(false);
  expect(result.mainMascot).toBe("ember-starling");
  expect(result.mainPet).toBe("ember-starling");
  expect(result.defaultMascot).toBe("ember-starling");
  expect(result.defaultPet).toBe("ember-starling");
  expect(result.assignment).toMatchObject({ status: "user-selected-global", storageKey: "agent-halo.pet", projectHashing: false, colorRandomization: false });
  expect(result.signalStatus).toBe("integration-candidate-gemini-v4-bold");
  expect(result.idleIncluded).toBe(false);
  expect(result.files).toHaveLength(90);
  expect(result.files.every((file) => file.hashMatches)).toBe(true);
  expect(result.files.filter((file) => file.path.startsWith("signals/") && ["thinking-model", "attention-asking", "done"].some((name) => file.path.endsWith(`${name}.png`))).every((file) => file.size[0] === 80 && file.size[1] === 20)).toBe(true);
  expect(result.files.filter((file) => file.path.startsWith("signals/") && !["thinking-model", "attention-asking", "done"].some((name) => file.path.endsWith(`${name}.png`))).every((file) => file.size[0] === 60 && file.size[1] === 20)).toBe(true);
  expect(result.files.find((file) => file.path.endsWith("/idle.png"))?.size).toEqual([72, 18]);
  expect(result.files.find((file) => file.path.endsWith("/working.png"))?.size).toEqual([72, 18]);
  expect(result.files.find((file) => file.path.endsWith("/attention.png"))?.size).toEqual([72, 18]);
  expect(result.files.find((file) => file.path.endsWith("/done.png"))?.size).toEqual([96, 18]);
  expect(result.files.find((file) => file.path.endsWith("/error.png"))?.size).toEqual([72, 18]);
});

test("idle and inactive keep the body but request no signal asset", async ({ page }) => {
  for (const scenario of ["idle", "inactive"] as const) {
    const signalRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/agent-halo-roster/signals/")) signalRequests.push(request.url());
    });
    await page.goto(`/?demo=1&demoScenario=${scenario}`);
    const pet = page.locator('.session-row .halo-pet[data-signal="none"]');
    await expect(pet).toBeVisible();
    await expect(pet.locator(".halo-pet-body")).toHaveCount(1);
    await expect(pet.locator(".halo-pet-signal")).toHaveCount(0);
    expect(signalRequests).toEqual([]);
  }
});

test("project pet maps attention, done, and error to distinct truthful states", async ({ page }) => {
  for (const scenario of ["attention", "done", "error"] as const) {
    await page.goto(`/?demo=1&demoScenario=${scenario}`);
    await page.locator(".session-row-main").click();
    const pet = page.locator(`.session-context-summary .halo-pet[data-state="${scenario}"]`);
    await expect(pet).toBeVisible();
    const selectedPet = await pet.getAttribute("data-pet");
    await expect(pet.locator(".halo-pet-body")).toHaveCSS("background-image", new RegExp(`/agent-halo-roster/body/${selectedPet}/${scenario}\\.webp`));
    if (scenario === "attention" || scenario === "error") {
      await expect(pet.locator(".halo-pet-body")).toHaveCSS("background-size", "108px 36px");
      await expect(pet.locator(".halo-pet-body")).toHaveCSS("animation-name", `halo-pet-${scenario}`);
    }
    const signal = scenario === "attention" ? "attention-asking" : scenario;
    await expect(pet).toHaveAttribute("data-signal", signal);
    await expect(pet.locator(".halo-pet-signal")).toHaveCSS("background-image", new RegExp(`/agent-halo-roster/signals/${signal}\\.png`));
    await expect(pet.locator(".halo-pet-signal")).toHaveCSS("width", "20px");
    await expect(pet.locator(".halo-pet-signal")).toHaveCSS("height", "20px");
    await expect(pet.locator(".halo-pet-signal")).toHaveCSS("background-size", scenario === "error" ? "60px 20px" : "80px 20px");
  }
});

test("done settles on the final frame while reduced motion stays static", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=done");
  await page.locator(".session-row-main").click();
  const donePet = page.locator('.session-context-summary .halo-pet[data-state="done"]');
  await expect(donePet.locator(".halo-pet-body")).toHaveCSS("background-position", "-108px 0px");
  await expect(donePet.locator(".halo-pet-signal")).toHaveCSS("background-position", "-60px 0px");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?demo=1&demoScenario=done");
  await page.locator(".session-row-main").click();
  const reducedDonePet = page.locator('.session-context-summary .halo-pet[data-state="done"]');
  await expect(reducedDonePet.locator(".halo-pet-body")).toHaveCSS("animation-name", "none");
  await expect(reducedDonePet.locator(".halo-pet-body")).toHaveCSS("background-position", "-108px 0px");
  await expect(reducedDonePet.locator(".halo-pet-signal")).toHaveCSS("animation-name", "none");
  await expect(reducedDonePet.locator(".halo-pet-signal")).toHaveCSS("background-position", "-60px 0px");

  await page.goto("/?demo=1&demoScenario=long-llm");
  const reducedPet = page.locator(".session-row .halo-pet");
  await expect(reducedPet.locator(".halo-pet-body")).toHaveCSS("animation-name", "none");
  await expect(reducedPet.locator(".halo-pet-signal")).toHaveCSS("animation-name", "none");
});
