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
  await expect(page.getByText("Keep display awake")).toBeVisible();
  await expect(page.getByText("Off · display follows macOS idle settings")).toBeVisible();

  await page.getByRole("button", { name: "Enable keep display awake" }).click();
  await expect(page.getByText("Desktop runtime required")).toBeVisible();
  await page.reload();
  await page.getByTitle("Setup").click();
  await expect(page.getByRole("button", { name: "Disable keep display awake" })).toBeVisible();
  await page.getByRole("button", { name: "Disable keep display awake" }).click();

  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("Native controls need Tauri runtime")).toBeVisible();

  await page.getByRole("button", { name: "Install" }).click();
  await expect(page.getByText("Open with pnpm desktop:dev")).toBeVisible();
});
