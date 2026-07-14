import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("Soft Cube uses deterministic body form and a semantic thinking signal", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=long-llm");

  const pet = page.locator('.session-row .halo-soft-cube[data-state="working"][data-signal="thinking-model"]');
  await expect(pet).toHaveCount(1);
  const initialForm = await pet.getAttribute("data-form");
  expect(["core", "cat-corner", "sprout"]).toContain(initialForm);
  await expect(pet.locator(".halo-soft-cube-body")).toHaveCSS("background-size", "64px 24px");
  const signal = pet.locator(".halo-soft-cube-signal");
  await expect(signal).toHaveCSS("background-size", "24px 12px");
  await expect(signal).toHaveCSS("left", "26px");
  await expect(signal).toHaveCSS("top", "6px");
  await expect(signal).toHaveCSS("width", "12px");
  await expect(signal).toHaveCSS("height", "12px");

  const dimensions = await pet.evaluate(async (element) => {
    const body = getComputedStyle(element.querySelector(".halo-soft-cube-body")!).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    const signal = getComputedStyle(element.querySelector(".halo-soft-cube-signal")!).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    const read = async (url: string | undefined) => {
      if (!url) return null;
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      return [bitmap.width, bitmap.height];
    };
    return { body: await read(body), signal: await read(signal) };
  });
  expect(dimensions).toEqual({ body: [32, 12], signal: [24, 12] });

  await page.reload();
  await expect(page.locator(".session-row .halo-soft-cube")).toHaveAttribute("data-form", initialForm ?? "");
});

test("every ActivityKind maps to one bounded signal group", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const mappings = await page.evaluate(async () => {
    const { getHaloPetSignal } = await import("/src/features/session/HaloSoftCube.tsx");
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
    const { getHaloPetSignal } = await import("/src/features/session/HaloSoftCube.tsx");
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

test("production signal manifest hashes ten enlarged binary strips at the expected dimensions", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const manifest = await (await fetch("/mascots/halo-soft-cube/manifest.json")).json() as {
      productionApproved: boolean;
      signal: { idleIncluded: boolean; status: string };
      files: Record<string, string>;
    };
    const entries = Object.entries(manifest.files).filter(([path]) => path.startsWith("signals/"));
    const files = await Promise.all(entries.map(async ([path, expectedHash]) => {
      const response = await fetch(`/mascots/halo-soft-cube/${path}`);
      const bytes = await response.arrayBuffer();
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      return { path, size: [bitmap.width, bitmap.height], hashMatches: digest === expectedHash };
    }));
    return {
      productionApproved: manifest.productionApproved,
      signalStatus: manifest.signal.status,
      idleIncluded: manifest.signal.idleIncluded,
      files,
    };
  });
  expect(result.productionApproved).toBe(true);
  expect(result.signalStatus).toBe("production-approved");
  expect(result.idleIncluded).toBe(false);
  expect(result.files).toHaveLength(10);
  expect(result.files.every((file) => file.hashMatches)).toBe(true);
  expect(result.files.every((file) => file.size[0] === 24 && file.size[1] === 12)).toBe(true);
});

test("idle and inactive keep the body but request no signal asset", async ({ page }) => {
  for (const scenario of ["idle", "inactive"] as const) {
    const signalRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/halo-soft-cube/signals/")) signalRequests.push(request.url());
    });
    await page.goto(`/?demo=1&demoScenario=${scenario}`);
    const pet = page.locator('.session-row .halo-soft-cube[data-signal="none"]');
    await expect(pet).toBeVisible();
    await expect(pet.locator(".halo-soft-cube-body")).toHaveCount(1);
    await expect(pet.locator(".halo-soft-cube-signal")).toHaveCount(0);
    expect(signalRequests).toEqual([]);
  }
});

test("Soft Cube maps attention, done, and error to distinct truthful states", async ({ page }) => {
  for (const scenario of ["attention", "done", "error"] as const) {
    await page.goto(`/?demo=1&demoScenario=${scenario}`);
    await page.locator(".session-row-main").click();
    const pet = page.locator(`.session-context-summary .halo-soft-cube[data-state="${scenario}"]`);
    await expect(pet).toBeVisible();
    await expect(pet.locator(".halo-soft-cube-body")).toHaveCSS("background-image", new RegExp(`/halo-soft-cube/body/.+/${scenario}\\.png`));
    const signal = scenario === "attention" ? "attention-asking" : scenario;
    await expect(pet).toHaveAttribute("data-signal", signal);
    await expect(pet.locator(".halo-soft-cube-signal")).toHaveCSS("background-image", new RegExp(`/halo-soft-cube/signals/${signal}\\.png`));
  }
});

test("done settles on the final frame while reduced motion stays static", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=done");
  await page.locator(".session-row-main").click();
  const donePet = page.locator('.session-context-summary .halo-soft-cube[data-state="done"]');
  await expect(donePet.locator(".halo-soft-cube-body")).toHaveCSS("background-position", "-32px 0px");
  await expect(donePet.locator(".halo-soft-cube-signal")).toHaveCSS("background-position", "-12px 0px");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?demo=1&demoScenario=long-llm");
  const reducedPet = page.locator(".session-row .halo-soft-cube");
  await expect(reducedPet.locator(".halo-soft-cube-body")).toHaveCSS("animation-name", "none");
  await expect(reducedPet.locator(".halo-soft-cube-signal")).toHaveCSS("animation-name", "none");
});
