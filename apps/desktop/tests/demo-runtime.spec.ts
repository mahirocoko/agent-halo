import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("agent-halo-runtime-test-ready")) return;
    window.localStorage.clear();
    window.sessionStorage.setItem("agent-halo-runtime-test-ready", "true");
  });
});

test("Runtime and Services use separate canonical top-level tabs", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");
  const runtimeTab = page.getByRole("tab", { name: "Runtime", exact: true });
  const servicesTab = page.getByRole("tab", { name: "Services", exact: true });
  await runtimeTab.click();

  const runtimePanel = page.getByRole("tabpanel", { name: "Runtime" });
  await expect(runtimePanel).toBeVisible();
  await expect(runtimeTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Processes", exact: true })).toHaveCount(0);
  await expect(runtimePanel.locator(".runtime-row")).toHaveCount(3);
  await expect(runtimePanel.locator(".runtime-row[data-pressure=critical]")).toHaveCount(2);
  await expect(runtimePanel.locator(".runtime-row[data-pressure=unavailable]")).toHaveCount(1);
  await expect(page.getByText("1 ended hidden")).toBeVisible();
  await expect(page.locator(".runtime-ended-count")).toHaveAttribute("role", "status");
  await expect(runtimePanel.locator(".runtime-row").first()).toContainText("Letta");
  await expect(runtimePanel.locator(".runtime-row").first()).toContainText("Subprocesses");
  await expect(page.locator(".runtime-pressure-label").first()).toBeVisible();
  await expect(runtimePanel.locator(".runtime-row").first()).toContainText("PID");
  await expect(page.getByText("Read-only · 100% CPU equals one logical core · no process controls")).toBeVisible();

  await servicesTab.click();
  const servicesPanel = page.getByRole("tabpanel", { name: "Services" });
  await expect(servicesPanel).toBeVisible();
  await expect(servicesTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("1 ended hidden")).toHaveCount(0);
  await expect(page.getByText("6 local listeners")).toBeVisible();
  await expect(servicesPanel.locator(".runtime-service-row")).toHaveCount(6);
  await expect(servicesPanel.locator('[data-service-group="web-frontends"]')).toContainText("Detected web frontends");
  await expect(servicesPanel.locator('[data-service-group="web-frontends"] .runtime-service-row')).toHaveCount(2);
  await expect(servicesPanel.locator('[data-service-group="letta-services"]')).toContainText("Letta services");
  await expect(servicesPanel.locator('[data-service-group="letta-services"] .runtime-service-row')).toHaveCount(2);
  await expect(servicesPanel.locator('[data-service-group="other"]')).toContainText("Other listeners");
  await expect(servicesPanel.locator('[data-service-group="other"] .runtime-service-row')).toHaveCount(2);
  const haabizService = servicesPanel.locator('.runtime-service-row[data-web-frontend="true"]').filter({ hasText: "Haabiz UI" });
  const morrowService = servicesPanel.locator('.runtime-service-row[data-web-frontend="true"]').filter({ hasText: "MORROW — ONE" });
  const pythonService = servicesPanel.locator('.runtime-service-row[data-web-frontend="false"]').filter({ hasText: "Python" });
  await expect(haabizService).toContainText("5173 · node");
  await expect(haabizService).toContainText("catalog");
  await expect(haabizService).toContainText("Started by Letta · admin-template · wH:p1");
  await expect(morrowService).toContainText("4173 · bun");
  await expect(morrowService).toContainText("Started by Letta · mahirocoko · wB:pH");
  await expect(pythonService).toContainText("8000");
  await expect(pythonService).toContainText("Started by Letta · mahirocoko · wB:pH");
  await expect(servicesPanel.locator(".runtime-service-open")).toHaveCount(4);
  await expect(page.getByText("Read-only · web evidence first, then exact Letta ancestry · no service controls")).toBeVisible();
  const [servicesBox, openBox] = await Promise.all([
    servicesPanel.boundingBox(),
    servicesPanel.locator(".runtime-service-open").first().boundingBox(),
  ]);
  expect(servicesBox).not.toBeNull();
  expect(openBox).not.toBeNull();
  expect(openBox!.width).toBeGreaterThanOrEqual(24);
  expect(servicesBox!.x + servicesBox!.width - (openBox!.x + openBox!.width)).toBeGreaterThanOrEqual(8);

  await runtimeTab.click();
  await runtimePanel.locator(".runtime-row[data-pressure=unavailable]").getByRole("button").click();
  await expect(runtimePanel.locator(".runtime-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Refresh Runtime" }).click();
  await expect(runtimePanel.locator(".runtime-row")).toHaveCount(3);
  await expect(page.getByText("1 ended hidden")).toBeVisible();
  const endedBeforeReload = await page.evaluate(() => window.localStorage.getItem("agent-halo.runtime-ended-identities"));

  await page.waitForTimeout(20);
  await page.reload();
  await page.getByRole("tab", { name: "Runtime", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Runtime" }).locator(".runtime-row")).toHaveCount(3);
  await expect(page.getByText("1 ended hidden")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("agent-halo.runtime-ended-identities"))).toBe(endedBeforeReload);
});

test("only strongly evidenced web frontends use the green local-service dot", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");
  await page.getByRole("tab", { name: "Services", exact: true }).click();
  const serviceRows = page.getByRole("tabpanel", { name: "Services" }).locator(".runtime-service-row");
  await expect(serviceRows).toHaveCount(6);

  const marks = await serviceRows.evaluateAll((rows) => rows.map((row) => ({
    webFrontend: row.getAttribute("data-web-frontend"),
    backgroundColor: getComputedStyle(row.querySelector<HTMLElement>(".runtime-service-mark")!).backgroundColor,
  })));
  expect(marks.filter((mark) => mark.webFrontend === "true")).toHaveLength(2);
  expect(marks.filter((mark) => mark.webFrontend === "true").every((mark) => mark.backgroundColor === "rgb(74, 222, 128)")).toBe(true);
  expect(marks.filter((mark) => mark.webFrontend === "false").every((mark) => mark.backgroundColor !== "rgb(74, 222, 128)")).toBe(true);
});

test("detected HTTP services expose a keyboard-reachable browser action", async ({ page }) => {
  page.on("popup", (popup) => void popup.close());
  await page.goto("/?demo=1&demoScenario=multi");
  await page.getByRole("tab", { name: "Services", exact: true }).click();

  const openService = page.getByRole("button", { name: "Open Haabiz UI on port 5173" });
  await openService.focus();
  await expect(openService).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(openService).toBeFocused();

  const openPython = page.getByRole("button", { name: "Open Python on port 8000" });
  await openPython.focus();
  await expect(openPython).toBeFocused();
});

test("Runtime and Services share canonical roving tabs, one outer scroller, and reset user scroll", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");
  const runtime = page.getByRole("tab", { name: "Runtime", exact: true });
  const services = page.getByRole("tab", { name: "Services", exact: true });
  await runtime.click();
  await runtime.focus();
  await page.keyboard.press("ArrowRight");
  await expect(services).toBeFocused();
  await expect(services).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "Sessions", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(services).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(runtime).toBeFocused();

  const scrollState = await page.evaluate(() => {
    const outer = document.querySelector<HTMLElement>("#main-panel-runtime")!;
    outer.style.maxHeight = "120px";
    outer.scrollTop = 80;
    const panel = document.querySelector<HTMLElement>(".runtime-panel")!;
    return {
      before: outer.scrollTop,
      outerOverflow: getComputedStyle(outer).overflowY,
      panelOverflow: getComputedStyle(panel).overflowY,
      toolbarPosition: getComputedStyle(document.querySelector<HTMLElement>(".runtime-toolbar")!).position,
    };
  });
  expect(scrollState).toMatchObject({ before: 80, outerOverflow: "auto", panelOverflow: "visible", toolbarPosition: "sticky" });
  await services.click();
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>("#main-panel-services")!.scrollTop)).toBe(0);
});

test("done-session footer actions stay owned by Sessions instead of Runtime or Services", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=done");
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
  await page.getByRole("tab", { name: "Runtime", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Services", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Sessions", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
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
  expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole("tab", { name: "Services", exact: true }).click();
  const servicesPanel = page.getByRole("tabpanel", { name: "Services" });
  const serviceRow = servicesPanel.locator(".runtime-service-row").first();
  const serviceToolbar = servicesPanel.locator(".runtime-toolbar");
  const openService = page.getByRole("button", { name: "Open Haabiz UI on port 5173" });
  await expect(openService).toBeVisible();
  const [servicesBox, serviceRowBox, serviceToolbarBox, openServiceBox] = await Promise.all([
    servicesPanel.boundingBox(),
    serviceRow.boundingBox(),
    serviceToolbar.boundingBox(),
    openService.boundingBox(),
  ]);
  expect(servicesBox).not.toBeNull();
  expect(serviceRowBox).not.toBeNull();
  expect(serviceToolbarBox).not.toBeNull();
  expect(openServiceBox).not.toBeNull();
  expect(serviceRowBox!.x).toBeGreaterThanOrEqual(servicesBox!.x);
  expect(serviceRowBox!.x + serviceRowBox!.width).toBeLessThanOrEqual(servicesBox!.x + servicesBox!.width + 1);
  expect(serviceToolbarBox!.x + serviceToolbarBox!.width).toBeLessThanOrEqual(servicesBox!.x + servicesBox!.width + 1);
  expect(servicesBox!.x + servicesBox!.width - (openServiceBox!.x + openServiceBox!.width)).toBeGreaterThanOrEqual(8);
  expect(await servicesPanel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.locator(".sheet-header").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});
