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
  await expect(servicesPanel.getByRole("button", { name: "Stop process…" })).toHaveCount(0);
  await servicesPanel.getByRole("button", { name: "Expand Haabiz UI service details on port 5173" }).click();
  await expect(haabizService).toContainText("catalog");
  await expect(haabizService).toContainText("Started by Letta · admin-template · wH:p1");
  await expect(haabizService).toContainText("Memory");
  await expect(haabizService).toContainText("Parent");
  await expect(haabizService).toContainText("Working directory");
  await expect(haabizService.getByRole("button", { name: "Stop process…" })).toBeVisible();
  await expect(morrowService).toContainText("4173 · bun");
  await expect(pythonService).toContainText("8000");
  await expect(servicesPanel.locator(".runtime-service-open")).toHaveCount(4);
  await expect(page.getByText("Web evidence first · exact Letta ancestry · Stop requires confirmation")).toBeVisible();
  const [servicesBox, openBox] = await Promise.all([
    servicesPanel.boundingBox(),
    servicesPanel.locator(".runtime-service-open").first().boundingBox(),
  ]);
  expect(servicesBox).not.toBeNull();
  expect(openBox).not.toBeNull();
  expect(openBox!.width).toBeGreaterThanOrEqual(24);
  expect(servicesBox!.x + servicesBox!.width - (openBox!.x + openBox!.width)).toBeGreaterThanOrEqual(8);

  await runtimeTab.click();
  await expect(runtimePanel.locator(".runtime-row[data-pressure=critical]")).toHaveCount(2);
  await expect(runtimePanel.locator(".runtime-row[data-pressure=unavailable]")).toHaveCount(1);
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
  const okColor = await page.locator("[data-testid='services-board']").evaluate((board) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--done)";
    board.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  expect(marks.filter((mark) => mark.webFrontend === "true")).toHaveLength(2);
  expect(okColor).not.toBe("rgb(74, 222, 128)");
  expect(marks.filter((mark) => mark.webFrontend === "true").every((mark) => mark.backgroundColor === okColor)).toBe(true);
  expect(marks.filter((mark) => mark.webFrontend === "false").every((mark) => mark.backgroundColor !== okColor)).toBe(true);
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

test("Services uses guarded Stop then Force kill controls for current-user listeners", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");
  await page.getByRole("tab", { name: "Services", exact: true }).click();
  const servicesPanel = page.getByRole("tabpanel", { name: "Services" });
  const disclosure = servicesPanel.getByRole("button", { name: "Expand Haabiz UI service details on port 5173" });
  await disclosure.click();

  const stop = servicesPanel.getByRole("button", { name: "Stop process…" });
  await stop.click();
  const cancelStop = servicesPanel.getByRole("button", { name: "Cancel" });
  await expect(cancelStop).toBeFocused();
  await expect(servicesPanel.getByText("This ends every listener owned by this process.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(stop).toBeVisible();
  await expect(servicesPanel).toBeVisible();

  await stop.click();
  await servicesPanel.getByRole("button", { name: "Stop process", exact: true }).click();
  await expect(servicesPanel.getByText("Process did not stop.")).toBeVisible();
  const force = servicesPanel.getByRole("button", { name: "Force kill…" });
  await force.click();
  const cancelForce = servicesPanel.getByRole("button", { name: "Cancel" });
  await expect(cancelForce).toBeFocused();
  await expect(servicesPanel.getByText("Unsaved work may be lost.")).toBeVisible();
  await servicesPanel.getByRole("button", { name: "Force kill", exact: true }).click();
  await expect(servicesPanel.locator(".runtime-service-row")).toHaveCount(5);
  await expect(servicesPanel.getByText("Haabiz UI")).toHaveCount(0);
});

test("protected Services disclose details without process controls", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");
  await page.getByRole("tab", { name: "Services", exact: true }).click();
  const servicesPanel = page.getByRole("tabpanel", { name: "Services" });
  await servicesPanel.getByRole("button", { name: "Expand bun service details on port 47621" }).click();
  await expect(servicesPanel.getByText("Agent Halo bridge is protected")).toBeVisible();
  await expect(servicesPanel.getByRole("button", { name: "Stop process…" })).toHaveCount(0);
});

test("Services owner protection includes cwd-less hosts and stays bounded", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=idle");
  const result = await page.evaluate(async () => {
    const model = await import("/src/features/runtime/model.ts");
    const sessions = Array.from({ length: 600 }, (_, index) => ({
      conversationId: `cwd-less-${index}`,
      project: `project-${index}`,
      workspace: `workspace-${index}`,
      workspacePath: null,
      status: "inactive" as const,
      lastActivityAt: new Date(Date.UTC(2026, 7, 10, 0, 0, index)).toISOString(),
    }));
    const registry = Object.fromEntries(sessions.map((session, index) => [session.conversationId, [{
      id: `event-${index}`,
      cwd: null,
      runtime: { sourceKind: "lettaHost", sourcePid: 10_000 + index, sourcePpid: 1, sourceStartedAtMs: 1_000_000 + index },
    }]]));
    const targets = model.buildLocalServiceOwnerTargets({ sessions: sessions as never, registry: registry as never });
    return {
      count: targets.length,
      containsNewest: targets.some((target) => target.processId === 10_599),
      containsCwdLess: targets.some((target) => target.processId === 10_000),
    };
  });
  expect(result).toEqual({ count: 512, containsNewest: true, containsCwdLess: false });
});

test("expanded Services detail survives polling and stays inside a narrow panel", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/?demo=1&demoScenario=multi");
  await page.getByRole("tab", { name: "Services", exact: true }).click();
  const servicesPanel = page.getByRole("tabpanel", { name: "Services" });
  const disclosure = servicesPanel.getByRole("button", { name: "Expand Haabiz UI service details on port 5173" });
  await disclosure.click();
  await page.waitForTimeout(5_200);
  await expect(servicesPanel.getByRole("button", { name: "Collapse Haabiz UI service details on port 5173" })).toHaveAttribute("aria-expanded", "true");
  await expect(servicesPanel.getByText("/Users/mahiro/ghq/github.com/haabiz/admin-template/apps/catalog")).toBeVisible();
  const geometry = await servicesPanel.evaluate((panel) => ({
    clientWidth: panel.clientWidth,
    scrollWidth: panel.scrollWidth,
    nestedScroller: [...panel.querySelectorAll<HTMLElement>(".runtime-panel, .runtime-service-details")].some((element) => ["auto", "scroll"].includes(getComputedStyle(element).overflowY)),
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.nestedScroller).toBe(false);
});

test("Runtime and Services share canonical roving tabs, one board scroller, and reset user scroll", async ({ page }) => {
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
    const board = document.querySelector<HTMLElement>("[data-testid='runtime-board']")!;
    const sheet = document.querySelector<HTMLElement>("#main-panel-runtime")!;
    const scroller = board.querySelector<HTMLElement>("[data-scroll-owner='inner']")!;
    board.style.maxHeight = "120px";
    const panel = document.querySelector<HTMLElement>(".runtime-panel")!;
    panel.style.minHeight = "320px";
    scroller.scrollTop = 80;
    return {
      before: scroller.scrollTop,
      boardOverflow: getComputedStyle(board).overflowY,
      scrollerOverflow: getComputedStyle(scroller).overflowY,
      sheetOverflow: getComputedStyle(sheet).overflowY,
      panelOverflow: getComputedStyle(panel).overflowY,
      toolbarPosition: getComputedStyle(document.querySelector<HTMLElement>(".runtime-toolbar")!).position,
    };
  });
  expect(scrollState).toMatchObject({ before: 80, boardOverflow: "hidden", scrollerOverflow: "auto", sheetOverflow: "hidden", panelOverflow: "visible", toolbarPosition: "sticky" });
  await services.click();
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>("[data-testid='services-board'] [data-scroll-owner='inner']")!.scrollTop)).toBe(0);
});

test("done-session footer actions stay owned by Sessions instead of Runtime or Services", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=done");
  const footerClose = () => page.locator(".sheet-footer").getByRole("button", { name: "Close", exact: true });
  await expect(footerClose()).toBeVisible();
  await page.getByRole("tab", { name: "Runtime", exact: true }).click();
  await expect(footerClose()).toHaveCount(0);
  await page.getByRole("tab", { name: "Services", exact: true }).click();
  await expect(footerClose()).toHaveCount(0);
  await page.getByRole("tab", { name: "Sessions", exact: true }).click();
  await expect(footerClose()).toBeVisible();
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
    { pressure: "normal", mark: "rgb(21, 94, 60)", label: "rgb(21, 94, 60)", borderStyle: "solid" },
    { pressure: "elevated", mark: "rgba(0, 0, 0, 0)", label: "rgb(46, 59, 71)", borderStyle: "solid" },
    { pressure: "high", mark: "rgb(113, 66, 5)", label: "rgb(113, 66, 5)", borderStyle: "solid" },
    { pressure: "critical", mark: "rgb(134, 37, 41)", label: "rgb(134, 37, 41)", borderStyle: "solid" },
    { pressure: "unavailable", mark: "rgba(0, 0, 0, 0)", label: "rgb(46, 59, 71)", borderStyle: "dashed" },
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

test("Runtime and Services boards apply cohesive muted paper tonal paint", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");

  const evaluatePaint = async (selector: string) => {
    return page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        opacity: cs.opacity,
      };
    }, selector);
  };

  await page.getByRole("tab", { name: "Runtime", exact: true }).click();
  await expect(page.locator(".runtime-board .runtime-panel")).toBeVisible();
  const runtimeBoardPaint = await evaluatePaint(".runtime-board");
  expect(runtimeBoardPaint?.backgroundColor).toBe("rgb(113, 127, 142)");
  expect(runtimeBoardPaint?.opacity).toBe("1");
  const runtimePanelPaint = await evaluatePaint(".runtime-panel");
  expect(runtimePanelPaint?.color).toBe("rgb(23, 33, 43)");
  const runtimeToolbarPaint = await evaluatePaint(".runtime-toolbar");
  expect(runtimeToolbarPaint?.backgroundColor).toBe("rgb(113, 127, 142)");

  await page.getByRole("tab", { name: "Services", exact: true }).click();
  await expect(page.locator(".services-board .runtime-panel")).toBeVisible();
  const servicesBoardPaint = await evaluatePaint(".services-board");
  expect(servicesBoardPaint?.backgroundColor).toBe("rgb(111, 136, 136)");
  expect(servicesBoardPaint?.opacity).toBe("1");
  const servicesPanelPaint = await evaluatePaint(".runtime-panel");
  expect(servicesPanelPaint?.color).toBe("rgb(23, 38, 38)");
  const servicesToolbarPaint = await evaluatePaint(".runtime-toolbar");
  expect(servicesToolbarPaint?.backgroundColor).toBe("rgb(111, 136, 136)");
});
