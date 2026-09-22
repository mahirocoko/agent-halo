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
  await expect(page.getByTestId("runtime-board")).toBeVisible();
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
  await expect(page.getByTestId("services-board")).toBeVisible();
  await expect(servicesPanel).toBeVisible();
  await expect(servicesTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("1 ended hidden")).toHaveCount(0);
  await expect(servicesPanel.locator(".runtime-primary-count")).toContainText("6local listeners");
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

test("strongly evidenced web frontends use filled monochrome service marks", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");
  await page.getByRole("tab", { name: "Services", exact: true }).click();
  const serviceRows = page.getByRole("tabpanel", { name: "Services" }).locator(".runtime-service-row");
  await expect(serviceRows).toHaveCount(6);

  const marks = await serviceRows.evaluateAll((rows) => rows.map((row) => {
    const style = getComputedStyle(row.querySelector<HTMLElement>(".runtime-service-mark")!);
    return {
      webFrontend: row.getAttribute("data-web-frontend"),
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
    };
  }));
  const webFrontends = marks.filter((mark) => mark.webFrontend === "true");
  const otherServices = marks.filter((mark) => mark.webFrontend === "false");
  expect(webFrontends).toHaveLength(2);
  expect(webFrontends.every((mark) => mark.backgroundColor === "rgb(17, 17, 17)")).toBe(true);
  expect(otherServices.every((mark) => mark.backgroundColor === "rgba(0, 0, 0, 0)" && mark.borderColor === "rgb(17, 17, 17)")).toBe(true);
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
    nestedScroller: [...panel.querySelectorAll<HTMLElement>(".runtime-service-details")].some((element) => ["auto", "scroll"].includes(getComputedStyle(element).overflowY)),
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.nestedScroller).toBe(false);
});

test("Runtime and Services share canonical roving tabs and dedicated detail scrollers", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");
  const runtime = page.getByRole("tab", { name: "Runtime", exact: true });
  const services = page.getByRole("tab", { name: "Services", exact: true });
  await runtime.click();
  await expect(page.getByTestId("runtime-board")).toBeVisible();
  await runtime.focus();
  await page.keyboard.press("ArrowRight");
  await expect(services).toBeFocused();
  await expect(services).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("services-board")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "Sessions", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(services).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(runtime).toBeFocused();
  await expect(page.getByTestId("runtime-board")).toBeVisible();

  const detail = page.locator("[data-testid='runtime-board'] [data-monitor-card='detail']");
  await detail.evaluate((scroller) => {
    scroller.style.maxHeight = "120px";
    scroller.scrollTop = 80;
  });
  const scrollState = await detail.evaluate((scroller) => ({
    before: scroller.scrollTop,
    overflowY: getComputedStyle(scroller).overflowY,
    nestedAuto: [...scroller.querySelectorAll<HTMLElement>("*")].some((element) => ["auto", "scroll"].includes(getComputedStyle(element).overflowY)),
  }));
  expect(scrollState).toEqual({ before: 80, overflowY: "auto", nestedAuto: false });

  await services.click();
  const servicesDetail = page.locator("[data-testid='services-board'] [data-monitor-card='detail']");
  await expect(servicesDetail).toBeVisible();
  await expect.poll(() => servicesDetail.evaluate((scroller) => scroller.scrollTop)).toBe(0);
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

test("runtime pressure marks and shared status labels use monochrome structure", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");
  await page.getByRole("tab", { name: "Runtime" }).click();
  await expect(page.getByTestId("runtime-board")).toBeVisible();
  const paint = await page.locator(".runtime-row").first().evaluate((row) => {
    const mark = row.querySelector<HTMLElement>(".runtime-pressure-mark");
    const label = row.querySelector<HTMLElement>(".runtime-pressure-label");
    if (!mark || !label) throw new Error("Runtime pressure anatomy is unavailable");
    const cases = [
      ["normal", "success"],
      ["elevated", "warning"],
      ["high", "warning"],
      ["critical", "danger"],
      ["unavailable", "neutral"],
    ] as const;
    return cases.map(([pressure, tone]) => {
      row.setAttribute("data-pressure", pressure);
      label.setAttribute("data-surface-status-tone", tone);
      const markStyle = getComputedStyle(mark);
      const labelStyle = getComputedStyle(label);
      return {
        pressure,
        markBackground: markStyle.backgroundColor,
        markBorderStyle: markStyle.borderStyle,
        markRadius: markStyle.borderRadius,
        markTransform: markStyle.transform,
        labelBackground: labelStyle.backgroundColor,
        labelInk: labelStyle.color,
        labelBorderStyle: labelStyle.borderStyle,
        labelShadow: labelStyle.boxShadow,
      };
    });
  });

  expect(paint[0]).toMatchObject({ markBackground: "rgb(17, 17, 17)", labelBackground: "rgb(17, 17, 17)", labelInk: "rgb(255, 255, 255)" });
  expect(paint[1]).toMatchObject({ markBackground: "rgba(0, 0, 0, 0)", markBorderStyle: "solid", labelBackground: "rgb(255, 255, 255)", labelInk: "rgb(17, 17, 17)" });
  expect(paint[2]).toMatchObject({ markBackground: "rgb(17, 17, 17)", markRadius: "1px", labelBackground: "rgb(255, 255, 255)" });
  expect(paint[3]).toMatchObject({ markBackground: "rgb(17, 17, 17)", markRadius: "1px", labelBackground: "rgb(17, 17, 17)", labelInk: "rgb(255, 255, 255)" });
  expect(paint[3].markTransform).not.toBe("none");
  expect(paint[3].labelShadow).toContain("rgb(255, 255, 255)");
  expect(paint[4]).toMatchObject({ markBackground: "rgba(0, 0, 0, 0)", markBorderStyle: "dashed", labelInk: "rgb(17, 17, 17)", labelBorderStyle: "dashed" });
});

test("runtime list stays readable at narrow width and reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?demo=1&demoScenario=multi");
  await page.getByRole("tab", { name: "Runtime" }).click();

  const panel = page.getByRole("tabpanel", { name: "Runtime" });
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("runtime-board")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh Runtime" })).toBeVisible();
  const row = page.locator(".runtime-row").first();
  const overviewHeader = page.locator(".runtime-overview-head");
  await expect(row).toContainText("Letta");
  await expect(row).toContainText("Subprocesses");
  const [panelBox, rowBox, overviewHeaderBox] = await Promise.all([panel.boundingBox(), row.boundingBox(), overviewHeader.boundingBox()]);
  expect(panelBox).not.toBeNull();
  expect(rowBox).not.toBeNull();
  expect(overviewHeaderBox).not.toBeNull();
  expect(rowBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
  expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
  expect(overviewHeaderBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
  expect(overviewHeaderBox!.x + overviewHeaderBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
  expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole("tab", { name: "Services", exact: true }).click();
  const servicesPanel = page.getByRole("tabpanel", { name: "Services" });
  const serviceRow = servicesPanel.locator(".runtime-service-row").first();
  const serviceHeading = servicesPanel.locator(".runtime-detail-heading");
  const openService = page.getByRole("button", { name: "Open Haabiz UI on port 5173" });
  await expect(openService).toBeVisible();
  const [servicesBox, serviceRowBox, serviceHeadingBox, openServiceBox] = await Promise.all([
    servicesPanel.boundingBox(),
    serviceRow.boundingBox(),
    serviceHeading.boundingBox(),
    openService.boundingBox(),
  ]);
  expect(servicesBox).not.toBeNull();
  expect(serviceRowBox).not.toBeNull();
  expect(serviceHeadingBox).not.toBeNull();
  expect(openServiceBox).not.toBeNull();
  expect(serviceRowBox!.x).toBeGreaterThanOrEqual(servicesBox!.x);
  expect(serviceRowBox!.x + serviceRowBox!.width).toBeLessThanOrEqual(servicesBox!.x + servicesBox!.width + 1);
  expect(serviceHeadingBox!.x + serviceHeadingBox!.width).toBeLessThanOrEqual(servicesBox!.x + servicesBox!.width + 1);
  expect(servicesBox!.x + servicesBox!.width - (openServiceBox!.x + openServiceBox!.width)).toBeGreaterThanOrEqual(8);
  expect(await servicesPanel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.locator(".sheet-header").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test("Runtime and Services preserve their accepted two-card material tones", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");

  const cardPaint = (board: string) => page.locator(`${board} .monitor-card`).evaluateAll((cards) => cards.map((card) => ({
    classes: card.className,
    backgroundColor: getComputedStyle(card).backgroundColor,
    color: getComputedStyle(card).color,
    opacity: getComputedStyle(card).opacity,
  })));

  await page.getByRole("tab", { name: "Runtime", exact: true }).click();
  await expect(page.getByTestId("runtime-board")).toBeVisible();
  expect(await cardPaint("[data-testid='runtime-board']")).toEqual([
    expect.objectContaining({ classes: expect.stringContaining("halo-surface-slate"), backgroundColor: "rgb(113, 127, 142)", color: "rgb(17, 17, 17)", opacity: "1" }),
    expect.objectContaining({ classes: expect.stringContaining("halo-surface-navy"), backgroundColor: "rgb(113, 127, 142)", color: "rgb(17, 17, 17)", opacity: "1" }),
  ]);

  await page.getByRole("tab", { name: "Services", exact: true }).click();
  await expect(page.getByTestId("services-board")).toBeVisible();
  expect(await cardPaint("[data-testid='services-board']")).toEqual([
    expect.objectContaining({ classes: expect.stringContaining("halo-surface-slate"), backgroundColor: "rgb(113, 127, 142)", color: "rgb(17, 17, 17)", opacity: "1" }),
    expect.objectContaining({ classes: expect.stringContaining("halo-surface-teal"), backgroundColor: "rgb(111, 136, 136)", color: "rgb(17, 17, 17)", opacity: "1" }),
  ]);
});
