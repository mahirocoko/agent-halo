import { expect, test } from "@playwright/test";

test("Usage keeps Codex values visible and labels them outdated after a refresh failure", async ({ page }) => {
  await page.addInitScript(() => {
    let codexCalls = 0;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return false;
        if (command === "set_panel_open") return true;
        if (command === "codex_usage") {
          codexCalls += 1;
          if (codexCalls > 1) throw new Error("Codex usage is rate limited. Try again shortly.");
          return {
            providerId: "codex",
            displayName: "Codex",
            plan: "Pro 20x",
            fetchedAt: "2026-07-25T12:00:00Z",
            lines: [
              { type: "progress", label: "Session", used: 42, limit: 100, resetsAt: "2026-07-25T14:00:00Z" },
              { type: "progress", label: "Weekly", used: 11, limit: 100, resetsAt: "2026-07-30T12:00:00Z" },
              { type: "text", label: "Rate Limit Resets", value: "1 available" },
              { type: "text", label: "Credits", value: "$0.40 · 10 credits" },
              { type: "text", label: "Today", value: "1.2M tokens" },
              { type: "text", label: "Yesterday", value: "840K tokens" },
              { type: "text", label: "Latest Token Log", value: "7/25" },
              { type: "text", label: "Last 30 Days", value: "12.4M tokens" },
              { type: "text", label: "Daily 7/24", value: "960K tokens" },
              { type: "text", label: "gpt-5.1-codex", value: "62%" },
              { type: "text", label: "gpt-5.1", value: "28%" },
              { type: "barChart", label: "Usage Trend", points: [
                { label: "7/23", value: 720000, valueLabel: "720K tokens" },
                { label: "7/24", value: 960000, valueLabel: "960K tokens" },
                { label: "7/25", value: 1200000, valueLabel: "1.2M tokens" },
              ], note: "Estimated from local Codex logs for this home." },
            ],
          };
        }
        throw new Error(`${command} unavailable`);
      },
    };
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open Agent Halo" }).click();
  await expect(page.getByRole("region", { name: "Agent Halo panel" })).toBeVisible();
  await page.getByRole("tab", { name: "Usage" }).click();
  await expect(page.getByText("58% left")).toBeVisible();
  await expect(page.getByText("Rate Limit Resets")).toBeVisible();
  await expect(page.getByText("1 available")).toBeVisible();
  await expect(page.getByText("$0.40 · 10 credits")).toBeVisible();
  await expect(page.getByRole("region", { name: "Codex usage history" })).toBeVisible();
  await expect(page.getByText("1.2M tokens")).toBeVisible();
  await expect(page.getByText("Model mix")).toBeVisible();
  await expect(page.getByRole("img", { name: /Past 30 days 12\.4M tokens/ })).toBeVisible();
  await page.getByText("Daily detail · 1 days").click();
  await expect(page.getByText("960K tokens")).toBeVisible();

  await page.getByRole("button", { name: "Refresh usage" }).click();

  await expect(page.locator(".usage-freshness[data-stale='true']")).toContainText("Outdated");
  await expect(page.getByText("58% left")).toBeVisible();
  await expect(page.getByText("Codex usage is rate limited. Try again shortly.")).toBeVisible();
});

test("Usage marks a native cached Status response as outdated instead of online", async ({ page }) => {
  await page.addInitScript(() => {
    let claudeCalls = 0;
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return false;
        if (command === "set_panel_open") return true;
        if (command === "claude_usage") {
          claudeCalls += 1;
          const lines = [
            { type: "progress", label: "Session", used: 25, limit: 100, resetsAt: "2026-07-25T14:00:00Z" },
            { type: "progress", label: "Weekly", used: 11, limit: 100, resetsAt: "2026-07-30T12:00:00Z" },
          ];
          if (claudeCalls > 1) {
            lines.push({ type: "text", label: "Status", value: "Live usage rate limited; showing last good values." });
          }
          return {
            providerId: "claude",
            displayName: "Claude Code",
            plan: "Max",
            fetchedAt: "2026-07-25T12:00:00Z",
            lines,
          };
        }
        throw new Error(`${command} unavailable`);
      },
    };
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open Agent Halo" }).click();
  await page.getByRole("tab", { name: "Usage" }).click();
  await page.getByRole("tab", { name: "Claude Code Online" }).click();
  await expect(page.getByText("75% left")).toBeVisible();

  await page.getByRole("button", { name: "Refresh usage" }).click();

  await expect(page.locator(".usage-freshness[data-stale='true']")).toContainText("Outdated");
  await expect(page.getByText("75% left")).toBeVisible();
  await expect(page.getByText("Live usage rate limited; showing last good values.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Claude Code Outdated" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Claude Code Online" })).toHaveCount(0);
});

test("Usage does not label a status-only provider response as outdated", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return false;
        if (command === "set_panel_open") return true;
        if (command === "claude_usage") {
          return {
            providerId: "claude",
            displayName: "Claude Code",
            fetchedAt: "2026-07-25T12:00:00Z",
            lines: [{ type: "text", label: "Status", value: "Claude Code usage unavailable." }],
          };
        }
        throw new Error(`${command} unavailable`);
      },
    };
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open Agent Halo" }).click();
  await page.getByRole("tab", { name: "Usage" }).click();
  await page.getByRole("tab", { name: "Claude Code" }).click();

  await expect(page.getByText("Claude Code usage unavailable.")).toBeVisible();
  await expect(page.locator(".usage-freshness")).toHaveCount(0);
});

test("Usage keeps a valid empty Antigravity summary online as no quota data", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return false;
        if (command === "set_panel_open") return true;
        if (command === "agy_usage") {
          return {
            providerId: "agy",
            displayName: "Antigravity",
            plan: "Pro",
            fetchedAt: "2026-07-25T12:00:00Z",
            lines: [],
          };
        }
        throw new Error(`${command} unavailable`);
      },
    };
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open Agent Halo" }).click();
  await page.getByRole("tab", { name: "Usage" }).click();
  await page.getByRole("tab", { name: "Antigravity Online" }).click();

  await expect(page.getByText("No quota data from current source")).toBeVisible();
  await expect(page.locator(".usage-freshness")).toContainText("Updated");
});

test("Usage hydrates a persisted last-good snapshot before a reload refresh completes", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("agent-halo.usage-snapshots.v1", JSON.stringify({
      codex: {
        providerId: "codex",
        fetchedAt: "2026-07-25T12:00:00Z",
        plan: "Pro",
        lines: [{ type: "progress", label: "Session", used: 42, limit: 100 }],
      },
    }));
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return false;
        if (command === "set_panel_open") return true;
        throw new Error(`${command} unavailable`);
      },
    };
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open Agent Halo" }).click();
  await page.getByRole("tab", { name: "Usage" }).click();

  await expect(page.getByText("58% left")).toBeVisible();
  await expect(page.locator(".usage-freshness[data-stale='true']")).toContainText("Outdated");
});
