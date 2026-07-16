import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("every surface uses the Scorpion default with no random palette", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=long-llm");

  const pet = page.locator('.session-row .halo-mascot[data-state="working"][data-signal="thinking-model"]');
  await expect(pet).toHaveCount(1);
  const initialMascot = await pet.getAttribute("data-mascot");
  const roster = ["pot", "crawler", "bat", "jelly", "cat", "crt", "cactus", "nautilus", "turtle", "lantern", "kettle", "dragonfly", "giraffe", "scorpion", "squid"];
  expect(roster).toContain(initialMascot);
  expect(initialMascot).toBe("scorpion");
  expect(await pet.getAttribute("data-palette")).toBeNull();
  await expect(pet.locator(".halo-mascot-body")).toHaveCSS("background-size", "144px 36px");
  const signal = pet.locator(".halo-mascot-signal");
  await expect(signal).toHaveCSS("background-size", "64px 16px");
  await expect(signal).toHaveCSS("left", "48px");
  await expect(signal).toHaveCSS("top", "10px");
  await expect(signal).toHaveCSS("width", "16px");
  await expect(signal).toHaveCSS("height", "16px");

  const dimensions = await pet.evaluate(async (element) => {
    const body = getComputedStyle(element.querySelector(".halo-mascot-body")!).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    const signal = getComputedStyle(element.querySelector(".halo-mascot-signal")!).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    const read = async (url: string | undefined) => {
      if (!url) return null;
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      return [bitmap.width, bitmap.height];
    };
    return { body: await read(body), signal: await read(signal) };
  });
  expect(dimensions).toEqual({ body: [72, 18], signal: [48, 12] });

  const ambientPet = page.locator(".activity-mascot.halo-mascot");
  await expect(ambientPet).toHaveCSS("width", "56px");
  await expect(ambientPet).toHaveCSS("height", "30px");
  await expect(ambientPet.locator(".halo-mascot-body")).toHaveCSS("width", "40px");
  await expect(ambientPet.locator(".halo-mascot-body")).toHaveCSS("height", "30px");
  await expect(ambientPet.locator(".halo-mascot-signal")).toHaveCSS("left", "40px");
  await expect(ambientPet.locator(".halo-mascot-signal")).toHaveCSS("top", "7px");

  await page.reload();
  await expect(page.locator(".session-row .halo-mascot")).toHaveAttribute("data-mascot", initialMascot ?? "");
});

test("mascot normalization defaults invalid or missing values to Scorpion", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const { getHaloMascotName, HALO_MASCOT_ROSTER } = await import("/src/features/session/HaloMascot.tsx");
    return {
      fallback: getHaloMascotName(null),
      invalid: getHaloMascotName("/Users/mahiro/Git/one"),
      selected: getHaloMascotName("crt"),
      roster: [...HALO_MASCOT_ROSTER],
    };
  });
  expect(result.fallback).toBe("scorpion");
  expect(result.invalid).toBe("scorpion");
  expect(result.selected).toBe("crt");
  expect(result.roster).toHaveLength(15);
});

test("setup selects one global mascot and persists the preference", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=long-llm");
  await expect(page.locator(".session-row .halo-mascot")).toHaveAttribute("data-mascot", "scorpion");

  await page.getByRole("button", { name: "Setup" }).click();
  const mascotRow = page.locator(".mascot-setting-row");
  await mascotRow.getByRole("button", { name: /Choose/ }).click();
  const picker = page.getByRole("radiogroup", { name: "Mascot" });
  const radios = picker.getByRole("radio");
  await expect(radios).toHaveCount(15);
  const scorpionOption = picker.getByRole("radio", { name: "Scorpion" });
  await expect(scorpionOption).toHaveAttribute("aria-checked", "true");
  await expect(scorpionOption).toBeFocused();
  expect(await radios.evaluateAll((options) => options.filter((option) => option.tabIndex === 0).length)).toBe(1);

  await scorpionOption.press("ArrowRight");
  const squidOption = picker.getByRole("radio", { name: "Squid" });
  await expect(squidOption).toHaveAttribute("aria-checked", "true");
  await expect(squidOption).toBeFocused();
  await squidOption.press("Escape");
  await expect(mascotRow.getByRole("button", { name: /Choose/ })).toBeFocused();

  await mascotRow.getByRole("button", { name: /Choose/ }).click();
  await picker.getByRole("radio", { name: "CRT" }).click();
  await page.getByRole("button", { name: "Back to sessions" }).click();
  await expect(page.locator(".session-row .halo-mascot")).toHaveAttribute("data-mascot", "crt");
  await expect(page.locator(".activity-mascot.halo-mascot")).toHaveAttribute("data-mascot", "crt");
  await page.locator(".session-row-main").click();
  await expect(page.locator(".session-context-summary .halo-mascot")).toHaveAttribute("data-mascot", "crt");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("agent-halo.mascot"))).toBe("crt");
  const stored = await page.evaluate(async () => (await import("/src/features/session/mascotPreference.ts")).readHaloMascotPreference());
  expect(stored).toBe("crt");
});

test("every ActivityKind maps to one bounded signal group", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const mappings = await page.evaluate(async () => {
    const { getHaloMascotSignal } = await import("/src/features/session/HaloMascot.tsx");
    const kinds = [
      "session", "thinking", "planning", "tool", "shell", "editing",
      "delegating", "visual", "memory", "asking", "skill", "goal",
      "compact", "model", "attention", "done", "error", "bridge",
    ] as const;
    return Object.fromEntries(kinds.map((kind) => [kind, getHaloMascotSignal("working", kind)]));
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
    const { getHaloMascotSignal } = await import("/src/features/session/HaloMascot.tsx");
    return {
      idleShell: getHaloMascotSignal("idle", "shell"),
      inactiveError: getHaloMascotSignal("inactive", "error"),
      attentionShell: getHaloMascotSignal("attention", "shell"),
      doneShell: getHaloMascotSignal("done", "shell"),
      errorThinking: getHaloMascotSignal("error", "thinking"),
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
      defaultMascot: string;
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
      defaultMascot: manifest.defaultMascot,
      assignment: manifest.assignment,
      signalStatus: manifest.signal.status,
      idleIncluded: manifest.signal.idleIncluded,
      files,
    };
  });
  expect(result.humanApproved).toBe(true);
  expect(result.productionApproved).toBe(false);
  expect(result.mainMascot).toBe("scorpion");
  expect(result.defaultMascot).toBe("scorpion");
  expect(result.assignment).toMatchObject({ status: "user-selected-global", storageKey: "agent-halo.mascot", projectHashing: false, colorRandomization: false });
  expect(result.signalStatus).toBe("integration-candidate-gemini-v3");
  expect(result.idleIncluded).toBe(false);
  expect(result.files).toHaveLength(85);
  expect(result.files.every((file) => file.hashMatches)).toBe(true);
  expect(result.files.filter((file) => file.path.startsWith("signals/") && ["thinking-model", "attention-asking", "done"].some((name) => file.path.endsWith(`${name}.png`))).every((file) => file.size[0] === 48 && file.size[1] === 12)).toBe(true);
  expect(result.files.filter((file) => file.path.startsWith("signals/") && !["thinking-model", "attention-asking", "done"].some((name) => file.path.endsWith(`${name}.png`))).every((file) => file.size[0] === 36 && file.size[1] === 12)).toBe(true);
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
    const pet = page.locator('.session-row .halo-mascot[data-signal="none"]');
    await expect(pet).toBeVisible();
    await expect(pet.locator(".halo-mascot-body")).toHaveCount(1);
    await expect(pet.locator(".halo-mascot-signal")).toHaveCount(0);
    expect(signalRequests).toEqual([]);
  }
});

test("project mascot maps attention, done, and error to distinct truthful states", async ({ page }) => {
  for (const scenario of ["attention", "done", "error"] as const) {
    await page.goto(`/?demo=1&demoScenario=${scenario}`);
    await page.locator(".session-row-main").click();
    const pet = page.locator(`.session-context-summary .halo-mascot[data-state="${scenario}"]`);
    await expect(pet).toBeVisible();
    const mascot = await pet.getAttribute("data-mascot");
    await expect(pet.locator(".halo-mascot-body")).toHaveCSS("background-image", new RegExp(`/agent-halo-roster/body/${mascot}/${scenario}\\.png`));
    if (scenario === "attention" || scenario === "error") {
      await expect(pet.locator(".halo-mascot-body")).toHaveCSS("background-size", "144px 36px");
      await expect(pet.locator(".halo-mascot-body")).toHaveCSS("animation-name", `halo-mascot-${scenario}`);
    }
    const signal = scenario === "attention" ? "attention-asking" : scenario;
    await expect(pet).toHaveAttribute("data-signal", signal);
    await expect(pet.locator(".halo-mascot-signal")).toHaveCSS("background-image", new RegExp(`/agent-halo-roster/signals/${signal}\\.png`));
    await expect(pet.locator(".halo-mascot-signal")).toHaveCSS("width", "16px");
    await expect(pet.locator(".halo-mascot-signal")).toHaveCSS("height", "16px");
    await expect(pet.locator(".halo-mascot-signal")).toHaveCSS("background-size", scenario === "error" ? "48px 16px" : "64px 16px");
  }
});

test("done settles on the final frame while reduced motion stays static", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=done");
  await page.locator(".session-row-main").click();
  const donePet = page.locator('.session-context-summary .halo-mascot[data-state="done"]');
  await expect(donePet.locator(".halo-mascot-body")).toHaveCSS("background-position", "-144px 0px");
  await expect(donePet.locator(".halo-mascot-signal")).toHaveCSS("background-position", "-48px 0px");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?demo=1&demoScenario=done");
  await page.locator(".session-row-main").click();
  const reducedDonePet = page.locator('.session-context-summary .halo-mascot[data-state="done"]');
  await expect(reducedDonePet.locator(".halo-mascot-body")).toHaveCSS("animation-name", "none");
  await expect(reducedDonePet.locator(".halo-mascot-body")).toHaveCSS("background-position", "-144px 0px");
  await expect(reducedDonePet.locator(".halo-mascot-signal")).toHaveCSS("animation-name", "none");
  await expect(reducedDonePet.locator(".halo-mascot-signal")).toHaveCSS("background-position", "-48px 0px");

  await page.goto("/?demo=1&demoScenario=long-llm");
  const reducedPet = page.locator(".session-row .halo-mascot");
  await expect(reducedPet.locator(".halo-mascot-body")).toHaveCSS("animation-name", "none");
  await expect(reducedPet.locator(".halo-mascot-signal")).toHaveCSS("animation-name", "none");
});
