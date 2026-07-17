import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("agent-halo-runtime-test-ready")) return;
    window.localStorage.clear();
    window.sessionStorage.setItem("agent-halo-runtime-test-ready", "true");
  });
});

test("runtime tab separates Letta host pressure from child processes", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");
  await page.getByRole("tab", { name: "Runtime" }).click();

  await expect(page.getByRole("tabpanel", { name: "Runtime" })).toBeVisible();
  await expect(page.getByText("Local host and child-process pressure")).toBeVisible();
  await expect(page.locator(".runtime-row")).toHaveCount(3);
  await expect(page.locator(".runtime-row[data-pressure=critical]")).toHaveCount(2);
  await expect(page.locator(".runtime-row[data-pressure=unavailable]")).toHaveCount(1);
  await expect(page.getByText("1 ended hidden")).toBeVisible();
  await expect(page.locator(".runtime-ended-count")).toHaveAttribute("role", "status");
  await expect(page.locator(".runtime-row").first()).toContainText("Letta");
  await expect(page.locator(".runtime-row").first()).toContainText("Subprocesses");
  await expect(page.locator(".runtime-pressure-label").first()).toBeVisible();
  await expect(page.locator(".runtime-row").first()).toContainText("PID");
  await expect(page.getByText("Read-only · 100% CPU equals one logical core · no process controls")).toBeVisible();

  await page.locator(".runtime-row[data-pressure=unavailable]").getByRole("button").click();
  await expect(page.locator(".runtime-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Refresh runtime metrics" }).click();
  await expect(page.locator(".runtime-row")).toHaveCount(3);
  await expect(page.getByText("1 ended hidden")).toBeVisible();
  const endedBeforeReload = await page.evaluate(() => window.localStorage.getItem("agent-halo.runtime-ended-identities"));

  await page.waitForTimeout(20);
  await page.reload();
  await page.getByRole("tab", { name: "Runtime" }).click();
  await expect(page.locator(".runtime-row")).toHaveCount(3);
  await expect(page.getByText("1 ended hidden")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("agent-halo.runtime-ended-identities"))).toBe(endedBeforeReload);
});

test("runtime ended identities are strongly keyed and bounded", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const model = await import("/src/features/runtime/model.ts");
    const persistence = await import("/src/features/runtime/persistence.ts");
    const target = {
      conversationId: "local-conv-runtime",
      runtimeEventId: "event-runtime",
      processId: 4242,
      sourceStartedAtMs: 100,
      cwd: "/tmp/runtime",
      project: "runtime",
      workspace: "runtime",
      sessionStatus: "inactive" as const,
      lastActivityAt: new Date().toISOString(),
      relatedConversationCount: 1,
      mappingStatus: "exact" as const,
    };
    const entries = Array.from({ length: 600 }, (_, index) => ({
      ...target,
      conversationId: `local-conv-runtime-${index}`,
      processId: 5_000 + index,
      sourceStartedAtMs: 1_000 + index,
    }));
    const merged = persistence.mergeRuntimeEndedIdentities(new Map(), entries, entries.slice(0, 512), Date.now());
    const referencedTarget = entries[0];
    const referencedKey = model.runtimeTargetKey(referencedTarget);
    const existing = new Map(entries.slice(0, 512).map((entry, index) => [model.runtimeTargetKey(entry), index + 1]));
    const extraEnded = { ...target, conversationId: "local-conv-extra", processId: 9_999, sourceStartedAtMs: 9_999 };
    const retained = persistence.mergeRuntimeEndedIdentities(existing, [extraEnded], entries.slice(0, 512), Date.now());
    const distinctPidReuseTargets = model.buildRuntimeUsageTargets({
      sessions: [
        { conversationId: "old-process", workspacePath: "/tmp/runtime", project: "runtime", workspace: "runtime", status: "inactive", lastActivityAt: "2026-07-17T00:00:00.000Z" },
        { conversationId: "new-process", workspacePath: "/tmp/runtime", project: "runtime", workspace: "runtime", status: "working", lastActivityAt: "2026-07-17T00:01:00.000Z" },
      ] as never,
      registry: {
        "old-process": [{ id: "old-event", cwd: "/tmp/runtime", runtime: { sourceKind: "lettaHost", sourcePid: 77, sourcePpid: 1, sourceStartedAtMs: 100 } }],
        "new-process": [{ id: "new-event", cwd: "/tmp/runtime", runtime: { sourceKind: "lettaHost", sourcePid: 77, sourcePpid: 1, sourceStartedAtMs: 200 } }],
      } as never,
    }).length;
    const staleView = model.buildRuntimeSessionViews([{ ...target, sourceStartedAtMs: 10_000 }], [{
      conversationId: target.conversationId,
      processId: target.processId,
      targetSourceStartedAtMs: 1_000,
      processStartTimeMs: null,
      cwd: target.cwd,
      sampledAtMs: Date.now(),
      status: "ok",
      error: null,
      host: { physicalFootprintBytes: 10, residentSizeBytes: 10, cpuPercent: 1 },
      children: { processCount: 0, physicalFootprintBytes: 0, residentSizeBytes: 0, cpuPercent: 0, topProcesses: [] },
    }])[0];
    return {
      nativeLimit: model.RUNTIME_NATIVE_TARGET_LIMIT,
      historyLimit: model.RUNTIME_HISTORY_TARGET_LIMIT,
      boundedSize: merged.size,
      selectedSize: model.selectRuntimeSamplingTargets(entries, new Map()).length,
      originalKey: model.runtimeTargetKey(target),
      restartedKey: model.runtimeTargetKey({ ...target, sourceStartedAtMs: 101 }),
      missingTerminal: model.isTerminalRuntimeStatus("missing"),
      reusedTerminal: model.isTerminalRuntimeStatus("pidReused"),
      mismatchTerminal: model.isTerminalRuntimeStatus("identityMismatch"),
      staleSnapshotIgnored: staleView.snapshot === null && staleView.pressure === "unavailable",
      referencedTombstoneRetained: retained.has(referencedKey),
      distinctPidReuseTargets,
    };
  });
  expect(result).toMatchObject({ nativeLimit: 64, historyLimit: 512, boundedSize: 512, selectedSize: 64, missingTerminal: true, reusedTerminal: true, mismatchTerminal: false, staleSnapshotIgnored: true, referencedTombstoneRetained: true, distinctPidReuseTargets: 2 });
  expect(result.restartedKey).not.toBe(result.originalKey);
});

test("runtime pressure colors distinguish healthy, elevated, high, critical, and unavailable states", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");
  await page.getByRole("tab", { name: "Runtime" }).click();
  const colors = await page.locator(".runtime-row").first().evaluate((row) => {
    const mark = row.querySelector<HTMLElement>(".runtime-pressure-mark");
    const label = row.querySelector<HTMLElement>(".runtime-pressure-label");
    if (!mark || !label) throw new Error("Runtime pressure anatomy is unavailable");
    return ["normal", "elevated", "high", "critical", "unavailable"].map((pressure) => {
      row.setAttribute("data-pressure", pressure);
      return {
        pressure,
        mark: getComputedStyle(mark).backgroundColor,
        label: getComputedStyle(label).color,
        borderStyle: getComputedStyle(label).borderStyle,
      };
    });
  });
  expect(colors).toEqual([
    { pressure: "normal", mark: "rgb(74, 222, 128)", label: "rgb(74, 222, 128)", borderStyle: "solid" },
    { pressure: "elevated", mark: "rgba(0, 0, 0, 0)", label: "rgb(160, 160, 168)", borderStyle: "solid" },
    { pressure: "high", mark: "rgb(255, 178, 61)", label: "rgb(255, 178, 61)", borderStyle: "solid" },
    { pressure: "critical", mark: "rgb(255, 107, 102)", label: "rgb(255, 107, 102)", borderStyle: "solid" },
    { pressure: "unavailable", mark: "rgba(0, 0, 0, 0)", label: "rgb(160, 160, 168)", borderStyle: "dashed" },
  ]);
});

test("runtime list stays readable at narrow width and reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?demo=1&demoScenario=multi");
  await page.getByRole("tab", { name: "Runtime" }).click();

  const panel = page.getByRole("tabpanel", { name: "Runtime" });
  await expect(panel).toBeVisible();
  await expect(page.locator(".runtime-toolbar .is-spinning")).toHaveCount(0);
  const row = page.locator(".runtime-row").first();
  await expect(row).toContainText("Letta");
  await expect(row).toContainText("Subprocesses");
  const [panelBox, rowBox, toolbarBox] = await Promise.all([panel.boundingBox(), row.boundingBox(), page.locator(".runtime-toolbar").boundingBox()]);
  expect(panelBox).not.toBeNull();
  expect(rowBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  expect(rowBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
  expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
  expect(toolbarBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
  expect(toolbarBox!.x + toolbarBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
});
