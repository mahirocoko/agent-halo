import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const openUsage = async (page: Page) => {
  await page.getByRole("tab", { name: "Usage" }).click();
};

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
  await openUsage(page);
  await expect(page.getByText("58% left")).toBeVisible();
  await expect(page.getByText("Rate Limit Resets")).toBeVisible();
  await expect(page.getByText("1 available")).toBeVisible();
  await expect(page.getByText("$0.40 · 10 credits")).toBeVisible();
  await expect(page.getByRole("region", { name: "Codex usage history" })).toBeVisible();
  await expect(page.getByText("1.2M tokens")).toBeVisible();
  await expect(page.getByText("Model mix")).toBeVisible();
  await expect(page.getByRole("img", { name: /Past 30 days 12\.4M tokens/ })).toBeVisible();
  const refreshGeometry = await page.getByRole("button", { name: "Refresh usage" }).evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return { width: rect.width, height: rect.height, radius: getComputedStyle(button).borderRadius, shape: button.dataset.surfaceControlShape };
  });
  expect(refreshGeometry).toEqual({ width: 28, height: 28, radius: "50%", shape: "circle" });
  const monochromePaint = await page.evaluate(() => ({
    providerIcon: getComputedStyle(document.querySelector<HTMLElement>(".usage-provider-title .usage-provider-icon")!).backgroundColor,
    onlineDot: getComputedStyle(document.querySelector<HTMLElement>(".usage-side-dot")!).backgroundColor,
    trendBars: [...document.querySelectorAll<HTMLElement>(".usage-trend-bar")].map((bar) => getComputedStyle(bar).backgroundColor),
  }));
  expect(monochromePaint.providerIcon).toBe("rgb(17, 17, 17)");
  expect(monochromePaint.onlineDot).toBe("rgb(94, 168, 118)");
  expect(new Set(monochromePaint.trendBars)).toEqual(new Set(["rgb(17, 17, 17)"]));
  await page.getByText("Daily detail · 1 days").click();
  await expect(page.getByText("960K tokens")).toBeVisible();

  await page.getByRole("button", { name: "Refresh usage" }).click();

  await expect(page.locator(".usage-freshness[data-stale='true']")).toContainText("Outdated");
  await expect(page.getByText("58% left")).toBeVisible();
  await expect(page.getByText("Codex usage is rate limited. Try again shortly.")).toBeVisible();
});

test("Usage meters communicate remaining quota with monochrome structure and copy", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "notch_metrics") return [184, 36];
        if (command === "set_keep_awake") return false;
        if (command === "set_panel_open") return true;
        if (command === "codex_usage") {
          return {
            providerId: "codex",
            displayName: "Codex",
            plan: "Pro",
            fetchedAt: "2026-08-13T06:00:00Z",
            lines: [
              { type: "progress", label: "Available quota", used: 10, limit: 100 },
              { type: "progress", label: "Low quota", used: 60, limit: 100 },
              { type: "progress", label: "Nearly empty quota", used: 85, limit: 100 },
              { type: "progress", label: "Empty quota", used: 100, limit: 100 },
            ],
          };
        }
        throw new Error(`${command} unavailable`);
      },
    };
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open Agent Halo" }).click();
  await openUsage(page);

  const meters = page.locator(".usage-meter");
  await expect(meters).toHaveCount(4);
  await expect(meters.nth(0)).toHaveAttribute("data-level", "ok");
  await expect(meters.nth(0)).toContainText("Available");
  await expect(meters.nth(1)).toHaveAttribute("data-level", "warning");
  await expect(meters.nth(1)).toContainText("Running low");
  await expect(meters.nth(2)).toHaveAttribute("data-level", "danger");
  await expect(meters.nth(2)).toContainText("Nearly exhausted");
  await expect(meters.nth(3)).toHaveAttribute("data-level", "danger");
  await expect(meters.nth(3)).toContainText("Exhausted");

  await expect(meters.nth(0).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "90");
  await expect(meters.nth(1).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  await expect(meters.nth(2).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "15");
  await expect(meters.nth(3).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

  const fillPaint = await meters.locator(".usage-meter-fill").evaluateAll((fills) =>
    fills.map((fill) => {
      const style = getComputedStyle(fill);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
      };
    }),
  );
  expect(fillPaint[0]).toMatchObject({ backgroundColor: "rgb(17, 17, 17)", backgroundImage: "none" });
  expect(fillPaint[1].backgroundImage).toContain("rgb(17, 17, 17)");
  expect(fillPaint[2]).toMatchObject({ backgroundColor: "rgb(17, 17, 17)", borderRadius: "1px" });
  expect(fillPaint[2].boxShadow).toContain("rgb(255, 255, 255)");
  expect(fillPaint[3]).toEqual(fillPaint[2]);

  const statusPaint = await meters.locator(".usage-meter-status").evaluateAll((statuses) =>
    statuses.map((status) => {
      const style = getComputedStyle(status);
      return {
        background: style.backgroundColor,
        color: style.color,
        borderColor: style.borderColor,
        boxShadow: style.boxShadow,
      };
    }),
  );
  expect(statusPaint[0]).toMatchObject({ background: "rgb(17, 17, 17)", color: "rgb(255, 255, 255)" });
  expect(statusPaint[1]).toMatchObject({ background: "rgb(255, 255, 255)", color: "rgb(17, 17, 17)", borderColor: "rgb(17, 17, 17)" });
  for (const danger of statusPaint.slice(2)) {
    expect(danger).toMatchObject({ background: "rgb(17, 17, 17)", color: "rgb(255, 255, 255)" });
    expect(danger.boxShadow).toContain("rgb(255, 255, 255)");
  }

  const dotPaint = await meters.locator(".usage-status-dot").evaluateAll((dots) =>
    dots.map((dot) => getComputedStyle(dot).backgroundColor),
  );
  expect(dotPaint[0]).toBe("rgb(94, 168, 118)");
  expect(dotPaint[1]).toBe("rgb(17, 17, 17)");
  expect(dotPaint[2]).toBe("rgb(199, 90, 90)");
  expect(dotPaint[3]).toBe("rgb(199, 90, 90)");

  const usageTabs = page.getByRole("tablist", { name: "Usage providers" });
  await usageTabs.getByRole("tab", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "Used" }).click();
  await usageTabs.getByRole("tab", { name: "Codex" }).click();

  await expect(meters.nth(0)).toHaveAttribute("data-level", "ok");
  await expect(meters.nth(0)).toContainText("Available");
  await expect(meters.nth(1)).toHaveAttribute("data-level", "warning");
  await expect(meters.nth(1)).toContainText("Running low");
  await expect(meters.nth(2)).toHaveAttribute("data-level", "danger");
  await expect(meters.nth(2)).toContainText("Nearly exhausted");
  await expect(meters.nth(3)).toContainText("Exhausted");
  await expect(meters.nth(0).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "10");
  await expect(meters.nth(1).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
  await expect(meters.nth(2).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "85");
  await expect(meters.nth(3).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
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
  await openUsage(page);
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
  await openUsage(page);
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
  await openUsage(page);
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
  await openUsage(page);

  await expect(page.getByText("58% left")).toBeVisible();
  await expect(page.locator(".usage-freshness[data-stale='true']")).toContainText("Outdated");
});
