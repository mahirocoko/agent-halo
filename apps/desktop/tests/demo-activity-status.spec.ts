import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("needs-input activity stays visible until the flow continues", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=attention");

  await expect(page.locator(".overlay-root")).toHaveAttribute("data-status", "attention");
  await expect(page.locator(".pill-detail")).toHaveText("Question");
  await expect(page.locator('.session-row[data-status="attention"]')).toBeVisible();
});

test("done activity collapses after its ambient signal window while the row remains", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=done");

  await expect(page.locator(".overlay-root")).toHaveAttribute("data-status", "closed");
  await expect(page.locator(".pill-detail")).toHaveText("Done");
  await expect(page.locator('.session-row[data-status="done"]')).toBeVisible();

  await expect(page.locator(".overlay-root")).toHaveAttribute("data-live", "false", { timeout: 10_000 });
  await expect(page.locator('.session-row[data-status="done"]')).toBeVisible();
});

test("old unfinished activity becomes inactive and does not occupy the notch", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=inactive");

  await expect(page.locator(".overlay-root")).toHaveAttribute("data-live", "false");
  await expect(page.locator('.session-row[data-status="inactive"]')).toBeVisible();
  await expect(page.getByText("Still?")).toHaveCount(0);
});

test("browser demo ignores persisted native runtime tombstones", async ({ page }) => {
  await page.addInitScript(() => {
    const conversationId = "local-conv-demo-active";
    const identityHash = [...conversationId].reduce(
      (sum, character) => sum + character.charCodeAt(0),
      0,
    ) % 1_000;
    const processId = 41_000 + identityHash;
    const sourceStartedAtMs = 1_700_000_000_000 + identityHash * 1_000;
    window.localStorage.setItem("agent-halo.runtime-ended-identities", JSON.stringify({
      schemaVersion: 1,
      entries: [{
        key: `${processId}:${sourceStartedAtMs}:${conversationId}`,
        endedAt: Date.now(),
      }],
    }));
  });

  await page.goto("/?demo=1&demoScenario=multi");

  const endedRow = page.locator('.session-row:has([data-session-id="local-conv-demo-active"])');
  await expect(endedRow).toHaveAttribute("data-status", "working");
  await expect(endedRow.getByText("Working")).toBeVisible();
});

test("runtime reconciliation preserves every active conversation sharing one process", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");

  const result = await page.evaluate(async () => {
    const runtime = await import("/src/features/runtime/model.ts");
    const baseSession = {
      project: "mods",
      workspace: "~/mods",
      workspacePath: "/tmp/mods",
      detail: "task output",
      activityKind: "shell" as const,
      model: "gpt-5.6-luna",
      lastActivityAt: new Date().toISOString(),
      herdrTarget: null,
    };
    const sessions = [
      { ...baseSession, conversationId: "working-a", status: "working" as const },
      { ...baseSession, conversationId: "working-b", status: "working" as const },
      { ...baseSession, conversationId: "done-c", status: "done" as const },
    ];
    const event = (conversationId: string) => ({
      version: 2 as const,
      id: `event-${conversationId}`,
      type: "tool_start" as const,
      timestamp: new Date().toISOString(),
      agentId: `agent-${conversationId}`,
      conversationId,
      cwd: "/tmp/mods",
      runtime: {
        sourcePid: 42_000,
        sourcePpid: 1,
        sourceStartedAtMs: 1_700_000_000_000,
        sourceKind: "lettaHost",
      },
      data: { toolCallId: `call-${conversationId}`, toolName: "TaskOutput", argKeys: [] },
    });
    const registry = Object.fromEntries(sessions.map((session) => [session.conversationId, [event(session.conversationId)]]));
    const targets = runtime.buildRuntimeLivenessTargets({ sessions, registry });
    const reconciled = runtime.reconcileEndedRuntimeSessions(
      sessions,
      new Set(["working-a", "working-b", "done-c"]),
    );
    return {
      targetIds: targets.map((target: { conversationId: string }) => target.conversationId),
      statuses: Object.fromEntries(reconciled.map((session: { conversationId: string; status: string }) => [session.conversationId, session.status])),
    };
  });

  expect(result.targetIds).toEqual(["working-a", "working-b"]);
  expect(result.statuses).toEqual({
    "working-a": "inactive",
    "working-b": "inactive",
    "done-c": "done",
  });
});

test("active liveness targets take priority over Runtime history at the safety cap", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");

  const selected = await page.evaluate(async () => {
    const runtime = await import("/src/features/runtime/model.ts");
    const target = (prefix: string, index: number) => ({
      conversationId: `${prefix}-${index}`,
      runtimeEventId: `${prefix}-event-${index}`,
      processId: (prefix === "live" ? 50_000 : 60_000) + index,
      sourceStartedAtMs: 1_700_000_000_000 + index,
      cwd: "/tmp/mods",
      project: "mods",
      workspace: "~/mods",
      herdrPaneId: null,
      sessionStatus: prefix === "live" ? "working" as const : "inactive" as const,
      lastActivityAt: new Date(Date.now() - index).toISOString(),
      relatedConversationCount: 1,
      mappingStatus: "exact" as const,
    });
    const live = Array.from({ length: 64 }, (_, index) => target("live", index));
    const history = Array.from({ length: 64 }, (_, index) => target("history", index));
    return runtime.selectRuntimeMonitorTargets(history, live, true, true)
      .map((item: { conversationId: string }) => item.conversationId);
  });

  expect(selected).toHaveLength(64);
  expect(selected.every((conversationId) => conversationId.startsWith("live-"))).toBe(true);
});
