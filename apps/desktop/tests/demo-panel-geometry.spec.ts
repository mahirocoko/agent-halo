import { expect, test } from "@playwright/test";

const WIDTH_RANGES = {
  sessions: [1020, 1060],
  "session-detail": [1000, 1040],
  pomodoro: [1000, 1040],
  usage: [1100, 1140],
  runtime: [1080, 1120],
  services: [1060, 1100],
  setup: [960, 1000],
} as const;

const paint = async (page: import("@playwright/test").Page, selector: string) => page.locator(selector).evaluate((element) => {
  const style = getComputedStyle(element);
  return {
    backgroundColor: style.backgroundColor,
    color: style.color,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    borderRadius: style.borderRadius,
    borderBottomWidth: style.borderBottomWidth,
  };
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("Sessions renders three borderless cards, two separators, and four complete recent events", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/?demo=1&demoScenario=multi");

  const cards = page.locator(".sessions-card[data-card]");
  const separators = page.getByRole("separator");
  await expect(cards).toHaveCount(3);
  await expect(separators).toHaveCount(2);
  for (const card of await cards.all()) await expect(card).toBeVisible();
  for (const separator of await separators.all()) await expect(separator).toBeVisible();

  const cardGeometry = await cards.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width };
  }));
  expect(cardGeometry[1].left - cardGeometry[0].right).toBeCloseTo(12, 0);
  expect(cardGeometry[2].left - cardGeometry[1].right).toBeCloseTo(12, 0);
  const cardWidth = cardGeometry.reduce((total, card) => total + card.width, 0);
  expect(cardGeometry[0].width / cardWidth).toBeCloseTo(0.39, 2);
  expect(cardGeometry[1].width / cardWidth).toBeCloseTo(0.41, 2);
  expect(cardGeometry[2].width / cardWidth).toBeCloseTo(0.2, 2);

  const scrollGeometry = await page.locator(".sessions-card .halo-inner-scroll").evaluateAll((nodes) => nodes.map((node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const cardRect = node.parentElement!.getBoundingClientRect();
    return {
      position: style.position,
      inset: [style.top, style.right, style.bottom, style.left],
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      gutter: style.scrollbarGutter,
      fillsCard: Math.abs(rect.width - cardRect.width) <= 1 && Math.abs(rect.height - cardRect.height) <= 1,
    };
  }));
  expect(scrollGeometry).toHaveLength(3);
  for (const scroller of scrollGeometry) {
    expect(scroller.position).toBe("absolute");
    expect(scroller.inset).toEqual(["0px", "0px", "0px", "0px"]);
    expect(scroller.padding).toEqual(["12px", "12px", "12px", "12px"]);
    expect(scroller.gutter).toBe("auto");
    expect(scroller.fillsCard).toBe(true);
  }

  const groupGeometry = await page.locator(".session-group-main").first().evaluate((group) => {
    const pet = group.querySelector<HTMLElement>(".session-pet")?.getBoundingClientRect();
    const label = group.querySelector<HTMLElement>(".session-label")?.getBoundingClientRect();
    if (!pet || !label) throw new Error("missing grouped session pet or label");
    return {
      petWidth: pet.width,
      petLabelGap: label.left - pet.right,
    };
  });
  expect(groupGeometry.petWidth).toBeCloseTo(66, 0);
  expect(groupGeometry.petLabelGap).toBeGreaterThanOrEqual(7);

  const events = page.locator("[data-scroll-card='recent'] .event-row");
  await expect(events).toHaveCount(4);
  for (const event of await events.all()) {
    await expect(event).toBeVisible();
    for (const field of [".event-time", ".event-type", ".event-detail"]) {
      const value = event.locator(field);
      await expect(value).toBeVisible();
      expect((await value.textContent())?.trim()).toBeTruthy();
    }
  }

  const borders = await page.locator(".sessions-card[data-card], .sessions-card .session-row").evaluateAll((nodes) => nodes.map((node) => {
    const style = getComputedStyle(node);
    return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
  }));
  expect(borders.length).toBeGreaterThan(3);
  expect(borders.every((widths) => widths.every((width) => width === "0px"))).toBe(true);
});

test("Sessions uses dark paper ink for row details, badges, and semantic status", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/?demo=1&demoScenario=multi");
  await expect(page.locator(".sessions-card-active .session-row").first()).toBeVisible();
  await expect(page.locator(".sessions-card-completed .session-row.session-group")).toBeVisible();

  const paint = await page.evaluate(() => {
    const activeCard = document.querySelector<HTMLElement>(".sessions-card-active");
    const completedCard = document.querySelector<HTMLElement>(".sessions-card-completed");
    const activeRow = activeCard?.querySelector<HTMLElement>(".session-row");
    const completedRow = completedCard?.querySelector<HTMLElement>(".session-row.session-group");
    if (!activeCard || !completedCard || !activeRow || !completedRow) throw new Error("missing Sessions ink hierarchy fixtures");

    const resolveColor = (owner: HTMLElement, value: string) => {
      const probe = document.createElement("span");
      probe.style.color = value;
      owner.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const resolveBackground = (owner: HTMLElement, value: string) => {
      const probe = document.createElement("span");
      probe.style.background = value;
      owner.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    };
    const element = (owner: ParentNode, selector: string) => owner.querySelector<HTMLElement>(selector)!;
    const style = (owner: ParentNode, selector: string) => getComputedStyle(element(owner, selector));

    const project = style(activeRow, ".session-project");
    const activity = style(activeRow, ".session-activity");
    const folder = style(activeRow, ".session-folder");
    const model = style(activeRow, ".session-model");
    const age = style(activeRow, ".session-age");
    const working = style(activeRow, ".status-text-working");
    const count = style(completedRow, ".session-group-count");
    const done = style(completedRow, ".status-text-done");

    return {
      expected: {
        activeInk: resolveColor(activeCard, "var(--surface-ink)"),
        activeInk2: resolveColor(activeCard, "var(--surface-ink-2)"),
        activeInk3: resolveColor(activeCard, "var(--surface-ink-3)"),
        completedInk: resolveColor(completedCard, "var(--surface-ink)"),
        completedFill2: resolveBackground(completedCard, "var(--surface-fill-2)"),
      },
      actual: {
        project: project.color,
        activity: activity.color,
        folder: folder.color,
        folderWeight: folder.fontWeight,
        model: model.color,
        modelBackground: model.backgroundColor,
        ageBackground: age.backgroundColor,
        working: working.color,
        workingBackground: working.backgroundColor,
        count: count.color,
        countBackground: count.backgroundColor,
        done: done.color,
        doneBackground: done.backgroundColor,
        opacities: [project.opacity, activity.opacity, folder.opacity, model.opacity, age.opacity, count.opacity, done.opacity],
      },
    };
  });

  expect(paint.actual.project).toBe(paint.expected.activeInk);
  expect(paint.actual.activity).toBe(paint.expected.activeInk2);
  expect(paint.actual.folder).toBe(paint.expected.activeInk3);
  expect(Number(paint.actual.folderWeight)).toBeGreaterThanOrEqual(500);
  expect(paint.actual.model).toBe(paint.expected.activeInk2);
  expect(paint.actual.modelBackground).not.toContain("255, 255, 255");
  expect(paint.actual.ageBackground).not.toContain("255, 255, 255");
  expect(paint.actual.modelBackground).not.toBe(paint.actual.ageBackground);
  expect(paint.actual.working).toBe("rgb(255, 255, 255)");
  expect(paint.actual.workingBackground).toBe("rgb(21, 93, 252)");
  expect(paint.actual.count).toBe(paint.expected.completedInk);
  expect(paint.actual.countBackground).toBe(paint.expected.completedFill2);
  expect(paint.actual.done).toBe("rgb(17, 17, 17)");
  expect(paint.actual.doneBackground).toBe("rgb(22, 196, 86)");
  expect(paint.actual.opacities.every((opacity) => opacity === "1")).toBe(true);
});

test("Sessions separators resize adjacent cards by pointer and keyboard without changing tray geometry", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });

  const measure = () => page.locator("[data-testid='sessions-tray']").evaluate((tray) => {
    const cards = [...tray.querySelectorAll<HTMLElement>(".sessions-card[data-card]")];
    const dividers = [...tray.querySelectorAll<HTMLElement>(".sessions-divider")];
    return {
      widths: cards.map((card) => card.getBoundingClientRect().width),
      total: [...cards, ...dividers].reduce((sum, node) => sum + node.getBoundingClientRect().width, 0),
    };
  });

  const cases = [
    { divider: 0, delta: -240, prepareDelta: 0, grows: 1, shrinks: 0, stable: 2 },
    { divider: 0, delta: 240, prepareDelta: 0, grows: 0, shrinks: 1, stable: 2 },
    { divider: 1, delta: -240, prepareDelta: 0, grows: 2, shrinks: 1, stable: 0 },
    { divider: 1, delta: 240, prepareDelta: -160, grows: 1, shrinks: 2, stable: 0 },
  ] as const;

  for (const scenario of cases) {
    await page.goto("/?demo=1&demoScenario=multi");
    const dragDivider = async (delta: number) => {
      const divider = page.getByRole("separator").nth(scenario.divider);
      const box = await divider.boundingBox();
      if (!box) throw new Error(`missing divider ${scenario.divider} geometry`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 8 });
      await page.mouse.up();
    };
    if (scenario.prepareDelta !== 0) await dragDivider(scenario.prepareDelta);
    const before = await measure();
    await dragDivider(scenario.delta);
    const after = await measure();

    expect(after.widths[scenario.grows]).toBeGreaterThan(before.widths[scenario.grows] + 50);
    expect(after.widths[scenario.shrinks]).toBeLessThan(before.widths[scenario.shrinks] - 50);
    expect(after.widths[scenario.shrinks]).toBeCloseTo(190, 0);
    expect(after.widths[scenario.stable]).toBeCloseTo(before.widths[scenario.stable], 0);
    expect(after.total).toBeCloseTo(before.total, 0);
    expect(after.widths.every((width) => width >= 189.5)).toBe(true);
  }

  await page.goto("/?demo=1&demoScenario=multi");
  for (const [index, key] of [[0, "ArrowRight"], [1, "ArrowLeft"]] as const) {
    const separator = page.getByRole("separator").nth(index);
    await separator.focus();
    await expect(separator).toBeFocused();
    const before = await measure();
    const beforeValue = Number(await separator.getAttribute("aria-valuenow"));
    await separator.press(key);
    const after = await measure();
    const afterValue = Number(await separator.getAttribute("aria-valuenow"));
    const ownedCard = index;
    expect(after.widths[ownedCard]).not.toBeCloseTo(before.widths[ownedCard], 0);
    expect(afterValue).not.toBe(beforeValue);
    expect(afterValue).toBeCloseTo(after.widths[ownedCard], 0);
  }
});

test("compact Sessions stacks cards, disables separators, and scrolls to complete recent activity", async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 440 });
  await page.goto("/?demo=1&demoScenario=multi");

  const tray = page.getByTestId("sessions-tray");
  const separators = page.locator("[role='separator']");
  await expect(separators).toHaveCount(2);
  for (const separator of await separators.all()) {
    await expect(separator).toBeHidden();
    expect(await separator.evaluate((node) => getComputedStyle(node).display)).toBe("none");
  }

  const compactGeometry = await tray.evaluate((node) => {
    const cards = [...node.querySelectorAll<HTMLElement>(".sessions-card[data-card]")];
    const rects = cards.map((card) => card.getBoundingClientRect());
    const scrollers = cards.map((card) => getComputedStyle(card.querySelector<HTMLElement>(".halo-inner-scroll")!));
    return {
      order: cards.map((card) => card.dataset.card),
      tops: rects.map((rect) => rect.top),
      overflowY: getComputedStyle(node).overflowY,
      horizontalOverflow: node.scrollWidth > node.clientWidth + 1,
      scrollers: scrollers.map((style) => ({
        position: style.position,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      })),
    };
  });
  expect(compactGeometry.order).toEqual(["active", "completed", "recent"]);
  expect(compactGeometry.tops[0]).toBeLessThan(compactGeometry.tops[1]);
  expect(compactGeometry.tops[1]).toBeLessThan(compactGeometry.tops[2]);
  expect(compactGeometry.overflowY).toBe("auto");
  expect(compactGeometry.horizontalOverflow).toBe(false);
  for (const scroller of compactGeometry.scrollers) {
    expect(scroller.position).toBe("relative");
    expect(scroller.padding).toEqual(["12px", "12px", "12px", "12px"]);
  }

  const trayBox = await tray.boundingBox();
  if (!trayBox) throw new Error("missing compact Sessions tray geometry");
  await page.mouse.move(trayBox.x + trayBox.width / 2, trayBox.y + trayBox.height / 2);
  await page.mouse.wheel(0, 1600);
  await expect.poll(() => tray.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByTestId("sessions-card-recent")).toBeVisible();
  const events = page.locator("[data-scroll-card='recent'] .event-row");
  await expect(events).toHaveCount(4);
  for (const event of await events.all()) await expect(event).toBeVisible();
  await expect.poll(async () => events.last().evaluate((event) => {
    const trayNode = event.closest<HTMLElement>(".sessions-tray");
    if (!trayNode) return false;
    const trayRect = trayNode.getBoundingClientRect();
    const eventRect = event.getBoundingClientRect();
    return eventRect.top >= trayRect.top && eventRect.bottom <= trayRect.bottom;
  })).toBe(true);
  expect(await page.locator(".halo-surface").evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

test("panel width is owned by the current top-level view and clamps at 320", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/?demo=1&demoScenario=multi");

  const readWidth = () => page.locator(".halo-surface").evaluate((surface) => ({
    view: surface.getAttribute("data-panel-view"),
    width: Number(surface.getAttribute("data-panel-width")),
    cssWidth: Number.parseFloat(getComputedStyle(surface).width),
  }));

  const sessions = await readWidth();
  expect(sessions.view).toBe("sessions");
  expect(sessions.width).toBeGreaterThanOrEqual(WIDTH_RANGES.sessions[0]);
  expect(sessions.width).toBeLessThanOrEqual(WIDTH_RANGES.sessions[1]);
  expect(sessions.cssWidth).toBeCloseTo(sessions.width, 0);

  const sessionsHeader = await page.evaluate(() => {
    const rail = document.querySelector(".header-tabs-rail");
    const label = document.querySelector(".header-tab-discrete .tab-label");
    return {
      railOverflow: rail ? rail.scrollWidth > rail.clientWidth + 1 : true,
      labelsVisible: label ? getComputedStyle(label).display !== "none" : false,
    };
  });
  expect(sessionsHeader).toEqual({ railOverflow: false, labelsVisible: true });

  await page.getByRole("tab", { name: "Sessions" }).focus();
  await page.keyboard.press("ArrowRight");
  const focused = await readWidth();
  expect(focused.view).toBe("pomodoro");
  expect(focused.width).toBeGreaterThanOrEqual(WIDTH_RANGES.pomodoro[0]);
  expect(focused.width).toBeLessThanOrEqual(WIDTH_RANGES.pomodoro[1]);

  await page.getByRole("tab", { name: "Focus" }).click();
  const focus = await readWidth();
  expect(focus.view).toBe("pomodoro");
  expect(focus.width).toBeGreaterThanOrEqual(WIDTH_RANGES.pomodoro[0]);
  expect(focus.width).toBeLessThanOrEqual(WIDTH_RANGES.pomodoro[1]);

  await page.getByRole("tab", { name: "Usage" }).click();
  expect(await readWidth()).toMatchObject({ view: "usage" });
  const usage = await readWidth();
  expect(usage.width).toBeGreaterThanOrEqual(WIDTH_RANGES.usage[0]);
  expect(usage.width).toBeLessThanOrEqual(WIDTH_RANGES.usage[1]);
  const usageHeader = await page.evaluate(() => {
    const rail = document.querySelector(".header-tabs-rail");
    const label = document.querySelector(".header-tab-discrete .tab-label");
    return {
      railOverflow: rail ? rail.scrollWidth > rail.clientWidth + 1 : true,
      labelsVisible: label ? getComputedStyle(label).display !== "none" : false,
    };
  });
  expect(usageHeader).toEqual({ railOverflow: false, labelsVisible: true });

  await page.getByRole("tab", { name: "Runtime" }).click();
  const runtime = await readWidth();
  expect(runtime.view).toBe("runtime");
  expect(runtime.width).toBeGreaterThanOrEqual(WIDTH_RANGES.runtime[0]);
  expect(runtime.width).toBeLessThanOrEqual(WIDTH_RANGES.runtime[1]);

  await page.getByRole("tab", { name: "Services" }).click();
  const services = await readWidth();
  expect(services.view).toBe("services");
  expect(services.width).toBeGreaterThanOrEqual(WIDTH_RANGES.services[0]);
  expect(services.width).toBeLessThanOrEqual(WIDTH_RANGES.services[1]);

  await page.getByRole("button", { name: "Setup" }).click();
  const setup = await readWidth();
  expect(setup.view).toBe("setup");
  expect(setup.width).toBeGreaterThanOrEqual(WIDTH_RANGES.setup[0]);
  expect(setup.width).toBeLessThanOrEqual(WIDTH_RANGES.setup[1]);

  await page.getByRole("button", { name: /Back/ }).click();
  await page.getByRole("tab", { name: "Sessions" }).click();
  await page.getByRole("button", { name: "Open agent-halo session details" }).first().click();
  const detail = await readWidth();
  expect(detail.view).toBe("session-detail");
  expect(detail.width).toBeGreaterThanOrEqual(WIDTH_RANGES["session-detail"][0]);
  expect(detail.width).toBeLessThanOrEqual(WIDTH_RANGES["session-detail"][1]);

  await page.setViewportSize({ width: 320, height: 700 });
  await expect.poll(async () => (await readWidth()).width).toBe(320);
  expect(await page.locator(".halo-surface").evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

test("wide Focus uses three independent cards, 12px gutters, and a fully visible default Pomodoro", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/?demo=1&demoScenario=idle");
  await page.getByRole("tab", { name: "Focus" }).click();
  await expect.poll(() => page.locator(".halo-surface").evaluate((surface) => Number.parseFloat(getComputedStyle(surface).height))).toBe(500);

  const geometry = await page.getByTestId("focus-tools-tray").evaluate((tray) => {
    const cards = [...tray.querySelectorAll<HTMLElement>(".focus-tool-card")];
    const cardRects = cards.map((card) => card.getBoundingClientRect());
    const scrollers = cards.map((card) => card.querySelector<HTMLElement>("[data-scroll-owner='inner']")!);
    const trayWidth = tray.getBoundingClientRect().width;
    return {
      panelHeight: Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>(".halo-surface")!).height),
      ratios: cardRects.map((rect) => rect.width / (trayWidth - 24)),
      gaps: [cardRects[1].left - cardRects[0].right, cardRects[2].left - cardRects[1].right],
      scrollers: scrollers.map((scroller) => {
        const style = getComputedStyle(scroller);
        return {
          position: style.position,
          inset: [style.top, style.right, style.bottom, style.left],
          padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
          gutter: style.scrollbarGutter,
        };
      }),
      pomodoroOverflow: scrollers[0].scrollHeight > scrollers[0].clientHeight,
      horizontalOverflow: tray.scrollWidth > tray.clientWidth + 1,
    };
  });

  expect(geometry.panelHeight).toBe(500);
  expect(geometry.ratios[0]).toBeCloseTo(0.4, 1);
  expect(geometry.ratios[1]).toBeCloseTo(0.32, 1);
  expect(geometry.ratios[2]).toBeCloseTo(0.28, 1);
  expect(geometry.gaps).toEqual([12, 12]);
  expect(geometry.pomodoroOverflow).toBe(false);
  expect(geometry.horizontalOverflow).toBe(false);
  for (const scroller of geometry.scrollers) {
    expect(scroller.position).toBe("absolute");
    expect(scroller.inset).toEqual(["0px", "0px", "0px", "0px"]);
    expect(scroller.padding).toEqual(["12px", "12px", "12px", "12px"]);
    expect(scroller.gutter).toBe("auto");
  }
});

test("colored boards own vertical scrolling and keep complete material edges", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/?demo=1&demoScenario=multi");
  await page.waitForTimeout(200);

  const inspect = async (boardSelector: string) => page.evaluate((selector) => {
    const board = document.querySelector<HTMLElement>(selector);
    const sheet = document.querySelector<HTMLElement>(".sheet-body");
    const inner = document.querySelector<HTMLElement>(".sheet-inner");
    const scroller = board?.querySelector<HTMLElement>("[data-scroll-owner='inner']");
    if (!board || !sheet || !inner || !scroller) throw new Error(`missing ${selector} or scroller`);
    scroller.style.maxHeight = "100px";
    const boardBox = board.getBoundingClientRect();
    const sheetBox = sheet.getBoundingClientRect();
    scroller.scrollTop = 48;
    return {
      boardOverflowY: getComputedStyle(board).overflowY,
      scrollerOverflowY: getComputedStyle(scroller).overflowY,
      sheetOverflowY: getComputedStyle(sheet).overflowY,
      nestedAuto: [...scroller.querySelectorAll<HTMLElement>("*")]
        .some((element) => ["auto", "scroll"].includes(getComputedStyle(element).overflowY)),
      scrollerScrollTop: scroller.scrollTop,
      scrollerCanScroll: scroller.scrollHeight > scroller.clientHeight,
      completeEdges:
        boardBox.top >= sheetBox.top - 1 &&
        boardBox.bottom <= sheetBox.bottom + 1 &&
        getComputedStyle(board).borderBottomLeftRadius !== "0px" &&
        getComputedStyle(board).backgroundColor !== "rgba(0, 0, 0, 0)",
      horizontalOverflow: board.scrollWidth > board.clientWidth + 1,
    };
  }, boardSelector);

  const sessions = await inspect("[data-testid='sessions-board']");
  expect(sessions).toMatchObject({
    boardOverflowY: "hidden",
    scrollerOverflowY: "auto",
    sheetOverflowY: "hidden",
    nestedAuto: false,
    completeEdges: true,
    horizontalOverflow: false,
  });
  expect(sessions.scrollerScrollTop).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Usage" }).click();
  await page.waitForTimeout(200);
  const usage = await inspect("[data-testid='usage-board']");
  expect(usage.boardOverflowY).toBe("hidden");
  expect(usage.scrollerOverflowY).toBe("auto");
  expect(usage.sheetOverflowY).toBe("hidden");
  expect(usage.nestedAuto).toBe(false);
  expect(usage.completeEdges).toBe(true);

  await page.getByRole("tab", { name: "Runtime" }).click();
  await page.waitForTimeout(200);
  const runtime = await inspect("[data-testid='runtime-board']");
  expect(runtime.boardOverflowY).toBe("hidden");
  expect(runtime.scrollerOverflowY).toBe("auto");
  expect(runtime.nestedAuto).toBe(false);
  expect(await page.locator(".runtime-toolbar").evaluate((node) => getComputedStyle(node).position)).toBe("sticky");

  await page.getByRole("tab", { name: "Services" }).click();
  await expect.poll(() => page.locator("[data-testid='services-board'] [data-scroll-owner='inner']").evaluate((scroller) => scroller.scrollTop)).toBe(0);

  await page.getByRole("button", { name: "Setup" }).click();
  await page.waitForTimeout(200);
  const setup = await inspect("[data-testid='settings-board']");
  expect(setup.boardOverflowY).toBe("hidden");
  expect(setup.scrollerOverflowY).toBe("auto");
  expect(setup.nestedAuto).toBe(false);
  expect(setup.completeEdges).toBe(true);
});

test("runtime view preserves active tab and scroll position when closed and reopened", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");
  await page.addStyleTag({ content: "[data-testid='runtime-board'] [data-scroll-owner='inner'] { max-height: 120px !important; }" });
  await page.getByRole("tab", { name: "Runtime" }).click();
  const scroller = page.locator("[data-testid='runtime-board'] [data-scroll-owner='inner']");
  await expect(scroller).toBeVisible();
  await expect(page.locator(".runtime-row").first()).toBeVisible();
  await scroller.evaluate((element) => {
    element.scrollTop = 48;
  });
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(48);

  await page.keyboard.press("Escape");
  await expect(page.locator(".halo-surface")).toHaveAttribute("data-state", "closed");

  await page.locator(".halo-surface").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".halo-surface")).toHaveAttribute("data-state", "open");
  expect(await page.locator(".halo-surface").getAttribute("data-panel-view")).toBe("runtime");
  await expect.poll(async () => scroller.evaluate((element) => element.scrollTop)).toBe(48);
});

test("navigating from usage to setup and back restores active tab and prior scroll position", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");
  await page.getByRole("tab", { name: "Usage" }).click();
  const usageScroller = page.locator("[data-testid='usage-board'] [data-scroll-owner='inner']");
  await expect(usageScroller).toBeVisible();
  await usageScroller.evaluate((element) => {
    element.style.maxHeight = "120px";
    element.scrollTop = 56;
  });
  expect(await usageScroller.evaluate((element) => element.scrollTop)).toBe(56);

  await page.getByRole("button", { name: "Setup" }).click();
  await expect(page.locator("[data-testid='settings-board']")).toBeVisible();
  expect(await page.locator(".halo-surface").getAttribute("data-panel-view")).toBe("setup");

  await page.getByRole("button", { name: /Back/ }).click();
  await expect(page.locator("[data-testid='usage-board']")).toBeVisible();
  expect(await page.locator(".halo-surface").getAttribute("data-panel-view")).toBe("usage");
  await expect.poll(async () => usageScroller.evaluate((element) => element.scrollTop)).toBe(56);
});

test("surface personalities stay distinct and drop the legacy orange recipe", async ({ page }) => {
  await page.goto("/?demo=1&demoScenario=multi");

  await page.getByRole("tab", { name: "Sessions" }).click();
  const sessions = await paint(page, "[data-testid='sessions-board']");
  expect(sessions.backgroundColor).toBe("rgb(142, 165, 148)");

  await page.getByRole("tab", { name: "Focus" }).click();
  const focus = await paint(page, ".focus-tool-card-pomodoro");
  expect(focus.backgroundColor).toBe("rgb(140, 135, 161)");
  expect((await paint(page, ".focus-tool-card-stopwatch")).backgroundColor).toBe("rgb(142, 165, 148)");
  expect((await paint(page, ".focus-tool-card-move")).backgroundColor).toBe("rgb(163, 158, 106)");
  const start = await page.locator(".pomodoro-panel").getByRole("button", { name: "Start" }).evaluate((button) => getComputedStyle(button).backgroundColor);
  expect(start).not.toBe("rgb(255, 157, 61)");
  expect(start).toBe("rgb(39, 31, 56)");

  await page.getByRole("tab", { name: "Usage" }).click();
  expect((await paint(page, "[data-testid='usage-board']")).backgroundColor).toBe("rgb(163, 158, 106)");

  await page.getByRole("tab", { name: "Runtime" }).click();
  const runtime = await paint(page, "[data-testid='runtime-board']");
  expect(runtime.backgroundColor).toBe("rgb(113, 127, 142)");

  await page.getByRole("tab", { name: "Services" }).click();
  const services = await paint(page, "[data-testid='services-board']");
  expect(services.backgroundColor).toBe("rgb(111, 136, 136)");
  expect(services.backgroundColor).not.toBe(runtime.backgroundColor);

  await page.getByRole("button", { name: "Setup" }).click();
  expect((await paint(page, "[data-testid='settings-board']")).backgroundColor).toBe("rgb(155, 150, 131)");

  const orangeHits = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.documentElement.append(probe);
    const rootAccent = getComputedStyle(probe).color;
    probe.remove();
    return rootAccent;
  });
  expect(orangeHits).toBe("rgb(126, 184, 212)");
});
