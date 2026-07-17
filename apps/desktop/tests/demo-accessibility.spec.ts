import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("collapsed notch opens from the keyboard and moves focus into the panel", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=done");
  await page.getByRole("button", { name: "Close" }).click();

  const surface = page.getByRole("button", { name: "Open Agent Halo" });
  await expect(surface).toBeVisible();
  await surface.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("region", { name: "Agent Halo panel" })).toBeVisible();
  const sessionsTab = page.getByRole("tab", { name: "Sessions" });
  await expect(sessionsTab).toBeFocused();
  await expect(sessionsTab).toHaveAttribute("aria-selected", "true");
});

test("session context receives focus and Escape restores the originating row", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");

  const sessionRow = page.getByRole("button", { name: "Open agent-halo session details" }).first();
  await sessionRow.focus();
  await page.keyboard.press("Enter");

  const context = page.locator(".session-context-summary");
  await expect(context).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open agent-halo session details" }).first()).toBeFocused();
});

test("pointer interaction still allows hover close after keyboard navigation", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");
  const surface = page.getByRole("region", { name: "Agent Halo panel" });
  const sessionsTab = page.getByRole("tab", { name: "Sessions" });

  await sessionsTab.focus();
  await page.keyboard.press("Home");
  await expect(surface).toBeVisible();

  await sessionsTab.click();
  await page.mouse.move(700, 700);
  await expect(page.getByRole("button", { name: "Open Agent Halo" })).toBeVisible();
});

test("main section tabs provide roving keyboard navigation and panel relationships", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");

  const sessionsTab = page.getByRole("tab", { name: "Sessions" });
  await sessionsTab.focus();
  await page.keyboard.press("ArrowRight");

  const pomodoroTab = page.getByRole("tab", { name: "Pomodoro" });
  await expect(pomodoroTab).toBeFocused();
  await expect(pomodoroTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Pomodoro" })).toBeVisible();

  await page.keyboard.press("ArrowRight");

  const usageTab = page.getByRole("tab", { name: "Usage" });
  await expect(usageTab).toBeFocused();
  await expect(usageTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Usage" })).toBeVisible();

  await page.keyboard.press("ArrowRight");

  const runtimeTab = page.getByRole("tab", { name: "Runtime" });
  await expect(runtimeTab).toBeFocused();
  await expect(runtimeTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Runtime" })).toBeVisible();

  await usageTab.click();

  const codexTab = page.getByRole("tab", { name: "Codex" });
  await codexTab.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("tab", { name: "Antigravity" })).toBeFocused();

  await page.getByRole("tab", { name: "Settings" }).click();
  const selectedRadio = page.getByRole("radio", { checked: true }).first();
  await expect(selectedRadio).toBeVisible();
  await selectedRadio.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { checked: true }).first()).toBeFocused();
});

test("reduced motion disables panel, status, loading, and pet animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?demo=1&demoScenario=multi");

  await expect(page.locator(".notch-wrap")).toHaveCSS("transition-duration", "0s");
  await expect(page.locator(".halo-surface")).toHaveCSS("transition-duration", "0s");
  await expect(page.locator(".sheet-inner")).toHaveCSS("transition-duration", "0s");
  await expect(page.locator(".glyph-pulse").first()).toHaveCSS("animation-name", "none");
  await expect(page.locator(".halo-pet-body").first()).toHaveCSS("animation-name", "none");
  await expect(page.locator(".halo-pet-signal").first()).toHaveCSS("animation-name", "none");
});

test("Setup sections use vertical roving tabs and labelled panels", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("button", { name: "Setup" }).click();
  const connection = page.getByRole("tab", { name: "Connection" });
  await connection.focus();
  await page.keyboard.press("ArrowDown");
  const pet = page.getByRole("tab", { name: "Pet" });
  await expect(pet).toBeFocused();
  await expect(pet).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Pet" })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Display" })).toBeFocused();
});

test("narrow Setup switches to horizontal tab semantics", async ({ page }) => {
  await page.setViewportSize({ width: 280, height: 440 });
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("button", { name: "Setup" }).click();
  await expect(page.getByRole("tablist", { name: "Setup sections" })).toHaveAttribute("aria-orientation", "horizontal");
  const connection = page.getByRole("tab", { name: "Connection" });
  await connection.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Pet" })).toBeFocused();
});
