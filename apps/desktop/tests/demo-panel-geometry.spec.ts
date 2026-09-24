import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('board surface tones retain material bases and share monochrome semantic tokens with canonical dot tokens', async () => {
  const styleDir = 'apps/desktop/src/styles'
  const owners = [
    'notchowl-board.css',
    'panel-status.css',
    'shared-controls.css',
    'sessions-context.css',
    'pomodoro.css',
    'stopwatch.css',
  ]
  const sources = await Promise.all(owners.map((name) => readFile(`${styleDir}/${name}`, 'utf8')))
  const board = sources[0]

  for (const [tone, base] of Object.entries({
    mint: '#8ea594',
    lavender: '#8c87a1',
    sand: '#a39e6a',
    parchment: '#9b9683',
    slate: '#717f8e',
    navy: '#717f8e',
    teal: '#6f8888',
  })) {
    const block = board.match(new RegExp(`\\.halo-surface-${tone}(?:,| \\{)[\\s\\S]*?\\}`))?.[0] ?? ''
    expect(block).toContain(`--surface-base: ${base}`)
    expect(block).not.toMatch(/--surface-(?:ink|line|fill|accent|ok|warn|danger|dot)/)
  }

  const surfaceBlock = board.match(/\.halo-tab-surface \{[\s\S]*?\}/)?.[0] ?? ''
  expect(surfaceBlock).toMatch(/--surface-ink: #111;[\s\S]*--surface-accent: #111;[\s\S]*--surface-accent-ink: #fff;/)
  expect(surfaceBlock).not.toMatch(/--surface-dot/)

  const panelStatus = sources[1]
  const sheetInnerBlock = panelStatus.match(/\.sheet-inner\s*\{[\s\S]*?\}/)?.[0] ?? ''
  expect(sheetInnerBlock).toContain('--surface-dot-positive: #5ea876;')
  expect(sheetInnerBlock).toContain('--surface-dot-negative: #c75a5a;')
  expect(panelStatus).toMatch(/\.status-error\s*\{[\s\S]*?background:\s*var\(--surface-dot-negative\);/)

  const usageCss = await readFile(`${styleDir}/usage.css`, 'utf8')
  expect(usageCss).toMatch(/\.usage-side-dot\s*\{[\s\S]*?background:\s*var\(--surface-dot-positive\);/)
  expect(usageCss).toMatch(
    /\.usage-meter\[data-level="ok"\]\s+\.usage-status-dot[\s\S]*?background:\s*var\(--surface-dot-positive\);/,
  )
  expect(usageCss).toMatch(
    /\.usage-meter\[data-level="danger"\]\s+\.usage-status-dot[\s\S]*?background:\s*var\(--surface-dot-negative\);/,
  )

  expect(sources.join('\n')).not.toMatch(/#155dfc|#ff9500|#16c456|#ff3849|var\(--surface-(?:ok|warn|danger)/i)
})

const WIDTH_RANGES = {
  sessions: [1020, 1060],
  'session-detail': [1020, 1060],
  pomodoro: [1020, 1060],
  usage: [1020, 1060],
  runtime: [1020, 1060],
  services: [1020, 1060],
  setup: [1020, 1060],
} as const

const paint = async (page: import('@playwright/test').Page, selector: string) =>
  page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      borderRadius: style.borderRadius,
      borderBottomWidth: style.borderBottomWidth,
    }
  })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

test('Sessions renders three borderless cards, two separators, and four complete recent events', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.goto('/?demo=1&demoScenario=multi')

  const cards = page.locator('.sessions-card[data-card]')
  const separators = page.getByRole('separator')
  await expect(cards).toHaveCount(3)
  await expect(separators).toHaveCount(2)
  for (const card of await cards.all()) await expect(card).toBeVisible()
  for (const separator of await separators.all()) await expect(separator).toBeVisible()

  const cardGeometry = await cards.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      return { left: rect.left, right: rect.right, width: rect.width }
    }),
  )
  expect(cardGeometry[1].left - cardGeometry[0].right).toBeCloseTo(12, 0)
  expect(cardGeometry[2].left - cardGeometry[1].right).toBeCloseTo(12, 0)
  const cardWidth = cardGeometry.reduce((total, card) => total + card.width, 0)
  expect(cardGeometry[0].width / cardWidth).toBeCloseTo(0.39, 2)
  expect(cardGeometry[1].width / cardWidth).toBeCloseTo(0.41, 2)
  expect(cardGeometry[2].width / cardWidth).toBeCloseTo(0.2, 2)

  const scrollGeometry = await page.locator('.sessions-card .halo-inner-scroll').evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      const cardRect = node.parentElement!.getBoundingClientRect()
      return {
        position: style.position,
        inset: [style.top, style.right, style.bottom, style.left],
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        gutter: style.scrollbarGutter,
        fillsCard: Math.abs(rect.width - cardRect.width) <= 1 && Math.abs(rect.height - cardRect.height) <= 1,
      }
    }),
  )
  expect(scrollGeometry).toHaveLength(3)
  for (const scroller of scrollGeometry) {
    expect(scroller.position).toBe('absolute')
    expect(scroller.inset).toEqual(['0px', '0px', '0px', '0px'])
    expect(scroller.padding).toEqual(['12px', '12px', '12px', '12px'])
    expect(scroller.gutter).toBe('auto')
    expect(scroller.fillsCard).toBe(true)
  }

  const groupGeometry = await page
    .locator('.session-group-main')
    .first()
    .evaluate((group) => {
      const pet = group.querySelector<HTMLElement>('.session-pet')?.getBoundingClientRect()
      const label = group.querySelector<HTMLElement>('.session-label')?.getBoundingClientRect()
      if (!pet || !label) throw new Error('missing grouped session pet or label')
      return {
        petWidth: pet.width,
        petLabelGap: label.left - pet.right,
      }
    })
  expect(groupGeometry.petWidth).toBeCloseTo(66, 0)
  expect(groupGeometry.petLabelGap).toBeGreaterThanOrEqual(7)

  const events = page.locator("[data-scroll-card='recent'] .event-row")
  await expect(events).toHaveCount(4)
  for (const event of await events.all()) {
    await expect(event).toBeVisible()
    for (const field of ['.event-time', '.event-type', '.event-detail']) {
      const value = event.locator(field)
      await expect(value).toBeVisible()
      expect((await value.textContent())?.trim()).toBeTruthy()
    }
  }

  const borders = await page.locator('.sessions-card[data-card], .sessions-card .session-row').evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node)
      return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
    }),
  )
  expect(borders.length).toBeGreaterThan(3)
  expect(borders.every((widths) => widths.every((width) => width === '0px'))).toBe(true)
})

test('Sessions uses dark paper ink for row details, badges, and semantic status', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.goto('/?demo=1&demoScenario=multi')
  await expect(page.locator('.sessions-card-active .session-row').first()).toBeVisible()
  await expect(page.locator('.sessions-card-completed .session-row.session-group')).toBeVisible()

  const paint = await page.evaluate(() => {
    const activeCard = document.querySelector<HTMLElement>('.sessions-card-active')
    const completedCard = document.querySelector<HTMLElement>('.sessions-card-completed')
    const activeRow = activeCard?.querySelector<HTMLElement>('.session-row')
    const completedRow = completedCard?.querySelector<HTMLElement>('.session-row.session-group')
    if (!activeCard || !completedCard || !activeRow || !completedRow)
      throw new Error('missing Sessions ink hierarchy fixtures')

    const resolveColor = (owner: HTMLElement, value: string) => {
      const probe = document.createElement('span')
      probe.style.color = value
      owner.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    }
    const resolveBackground = (owner: HTMLElement, value: string) => {
      const probe = document.createElement('span')
      probe.style.background = value
      owner.append(probe)
      const color = getComputedStyle(probe).backgroundColor
      probe.remove()
      return color
    }
    const element = (owner: ParentNode, selector: string) => owner.querySelector<HTMLElement>(selector)!
    const style = (owner: ParentNode, selector: string) => getComputedStyle(element(owner, selector))

    const project = style(activeRow, '.session-project')
    const activity = style(activeRow, '.session-activity')
    const folder = style(activeRow, '.session-folder')
    const model = style(activeRow, '.session-model')
    const age = style(activeRow, '.session-age')
    const working = style(activeRow, '.status-text-working')
    const count = style(completedRow, '.session-group-count')
    const done = style(completedRow, '.status-text-done')

    return {
      expected: {
        activeInk: resolveColor(activeCard, 'var(--surface-ink)'),
        activeInk2: resolveColor(activeCard, 'var(--surface-ink-2)'),
        activeInk3: resolveColor(activeCard, 'var(--surface-ink-3)'),
        completedInk: resolveColor(completedCard, 'var(--surface-ink)'),
        completedFill2: resolveBackground(completedCard, 'var(--surface-fill-2)'),
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
        opacities: [
          project.opacity,
          activity.opacity,
          folder.opacity,
          model.opacity,
          age.opacity,
          count.opacity,
          done.opacity,
        ],
      },
    }
  })

  expect(paint.actual.project).toBe(paint.expected.activeInk)
  expect(paint.actual.activity).toBe(paint.expected.activeInk2)
  expect(paint.actual.folder).toBe(paint.expected.activeInk3)
  expect(Number(paint.actual.folderWeight)).toBeGreaterThanOrEqual(500)
  expect(paint.actual.model).toBe(paint.expected.activeInk2)
  expect(paint.actual.modelBackground).not.toContain('255, 255, 255')
  expect(paint.actual.ageBackground).not.toContain('255, 255, 255')
  expect(paint.actual.modelBackground).not.toBe(paint.actual.ageBackground)
  expect(paint.actual.working).toBe('rgb(255, 255, 255)')
  expect(paint.actual.workingBackground).toBe('rgb(17, 17, 17)')
  expect(paint.actual.count).toBe(paint.expected.completedInk)
  expect(paint.actual.countBackground).toBe(paint.expected.completedFill2)
  expect(paint.actual.done).toBe('rgb(17, 17, 17)')
  expect(paint.actual.doneBackground).toBe('rgb(255, 255, 255)')
  expect(paint.actual.opacities.every((opacity) => opacity === '1')).toBe(true)
})

test('Sessions separators resize adjacent cards by pointer and keyboard without changing tray geometry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 })

  const measure = () =>
    page.locator("[data-testid='sessions-tray']").evaluate((tray) => {
      const cards = [...tray.querySelectorAll<HTMLElement>('.sessions-card[data-card]')]
      const dividers = [...tray.querySelectorAll<HTMLElement>('.sessions-divider')]
      return {
        widths: cards.map((card) => card.getBoundingClientRect().width),
        total: [...cards, ...dividers].reduce((sum, node) => sum + node.getBoundingClientRect().width, 0),
      }
    })

  const cases = [
    { divider: 0, delta: -240, prepareDelta: 0, grows: 1, shrinks: 0, stable: 2 },
    { divider: 0, delta: 240, prepareDelta: 0, grows: 0, shrinks: 1, stable: 2 },
    { divider: 1, delta: -240, prepareDelta: 0, grows: 2, shrinks: 1, stable: 0 },
    { divider: 1, delta: 240, prepareDelta: -160, grows: 1, shrinks: 2, stable: 0 },
  ] as const

  for (const scenario of cases) {
    await page.goto('/?demo=1&demoScenario=multi')
    const dragDivider = async (delta: number) => {
      const divider = page.getByRole('separator').nth(scenario.divider)
      const box = await divider.boundingBox()
      if (!box) throw new Error(`missing divider ${scenario.divider} geometry`)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 8 })
      await page.mouse.up()
    }
    if (scenario.prepareDelta !== 0) await dragDivider(scenario.prepareDelta)
    const before = await measure()
    await dragDivider(scenario.delta)
    const after = await measure()

    expect(after.widths[scenario.grows]).toBeGreaterThan(before.widths[scenario.grows] + 50)
    expect(after.widths[scenario.shrinks]).toBeLessThan(before.widths[scenario.shrinks] - 50)
    expect(after.widths[scenario.shrinks]).toBeCloseTo(190, 0)
    expect(after.widths[scenario.stable]).toBeCloseTo(before.widths[scenario.stable], 0)
    expect(after.total).toBeCloseTo(before.total, 0)
    expect(after.widths.every((width) => width >= 189.5)).toBe(true)
  }

  await page.goto('/?demo=1&demoScenario=multi')
  for (const [index, key] of [
    [0, 'ArrowRight'],
    [1, 'ArrowLeft'],
  ] as const) {
    const separator = page.getByRole('separator').nth(index)
    await separator.focus()
    await expect(separator).toBeFocused()
    const before = await measure()
    const beforeValue = Number(await separator.getAttribute('aria-valuenow'))
    await separator.press(key)
    const after = await measure()
    const afterValue = Number(await separator.getAttribute('aria-valuenow'))
    const ownedCard = index
    expect(after.widths[ownedCard]).not.toBeCloseTo(before.widths[ownedCard], 0)
    expect(afterValue).not.toBe(beforeValue)
    expect(afterValue).toBeCloseTo(after.widths[ownedCard], 0)
  }
})

test('compact Sessions stacks cards, disables separators, and scrolls to complete recent activity', async ({
  page,
}) => {
  await page.setViewportSize({ width: 620, height: 440 })
  await page.goto('/?demo=1&demoScenario=multi')

  const tray = page.getByTestId('sessions-tray')
  const separators = page.locator("[role='separator']")
  await expect(separators).toHaveCount(2)
  for (const separator of await separators.all()) {
    await expect(separator).toBeHidden()
    expect(await separator.evaluate((node) => getComputedStyle(node).display)).toBe('none')
  }

  const compactGeometry = await tray.evaluate((node) => {
    const cards = [...node.querySelectorAll<HTMLElement>('.sessions-card[data-card]')]
    const rects = cards.map((card) => card.getBoundingClientRect())
    const scrollers = cards.map((card) => getComputedStyle(card.querySelector<HTMLElement>('.halo-inner-scroll')!))
    return {
      order: cards.map((card) => card.dataset.card),
      tops: rects.map((rect) => rect.top),
      overflowY: getComputedStyle(node).overflowY,
      horizontalOverflow: node.scrollWidth > node.clientWidth + 1,
      scrollers: scrollers.map((style) => ({
        position: style.position,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      })),
    }
  })
  expect(compactGeometry.order).toEqual(['active', 'completed', 'recent'])
  expect(compactGeometry.tops[0]).toBeLessThan(compactGeometry.tops[1])
  expect(compactGeometry.tops[1]).toBeLessThan(compactGeometry.tops[2])
  expect(compactGeometry.overflowY).toBe('auto')
  expect(compactGeometry.horizontalOverflow).toBe(false)
  for (const scroller of compactGeometry.scrollers) {
    expect(scroller.position).toBe('relative')
    expect(scroller.padding).toEqual(['12px', '12px', '12px', '12px'])
  }

  const trayBox = await tray.boundingBox()
  if (!trayBox) throw new Error('missing compact Sessions tray geometry')
  await page.mouse.move(trayBox.x + trayBox.width / 2, trayBox.y + trayBox.height / 2)
  await page.mouse.wheel(0, 1600)
  await expect.poll(() => tray.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  await expect(page.getByTestId('sessions-card-recent')).toBeVisible()
  const events = page.locator("[data-scroll-card='recent'] .event-row")
  await expect(events).toHaveCount(4)
  for (const event of await events.all()) await expect(event).toBeVisible()
  await expect
    .poll(async () =>
      events.last().evaluate((event) => {
        const trayNode = event.closest<HTMLElement>('.sessions-tray')
        if (!trayNode) return false
        const trayRect = trayNode.getBoundingClientRect()
        const eventRect = event.getBoundingClientRect()
        return eventRect.top >= trayRect.top && eventRect.bottom <= trayRect.bottom
      }),
    )
    .toBe(true)
  expect(await page.locator('.halo-surface').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
})

test('panel width stays at the Sessions default across views and clamps at 320', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/?demo=1&demoScenario=multi')

  const readWidth = () =>
    page.locator('.halo-surface').evaluate((surface) => ({
      view: surface.getAttribute('data-panel-view'),
      width: Number(surface.getAttribute('data-panel-width')),
      cssWidth: Number.parseFloat(getComputedStyle(surface).width),
    }))

  const sessions = await readWidth()
  expect(sessions.view).toBe('sessions')
  expect(sessions.width).toBeGreaterThanOrEqual(WIDTH_RANGES.sessions[0])
  expect(sessions.width).toBeLessThanOrEqual(WIDTH_RANGES.sessions[1])
  expect(sessions.cssWidth).toBeCloseTo(sessions.width, 0)

  const sessionsHeader = await page.evaluate(() => {
    const rail = document.querySelector('.header-tabs-rail')
    const label = document.querySelector('.header-tab-discrete .tab-label')
    return {
      railOverflow: rail ? rail.scrollWidth > rail.clientWidth + 1 : true,
      labelsVisible: label ? getComputedStyle(label).display !== 'none' : false,
    }
  })
  expect(sessionsHeader).toEqual({ railOverflow: false, labelsVisible: false })

  await page.getByRole('tab', { name: 'Sessions' }).focus()
  await page.keyboard.press('ArrowRight')
  const focused = await readWidth()
  expect(focused.view).toBe('pomodoro')
  expect(focused.width).toBeGreaterThanOrEqual(WIDTH_RANGES.pomodoro[0])
  expect(focused.width).toBeLessThanOrEqual(WIDTH_RANGES.pomodoro[1])

  await page.getByRole('tab', { name: 'Focus' }).click()
  const focus = await readWidth()
  expect(focus.view).toBe('pomodoro')
  expect(focus.width).toBeGreaterThanOrEqual(WIDTH_RANGES.pomodoro[0])
  expect(focus.width).toBeLessThanOrEqual(WIDTH_RANGES.pomodoro[1])

  await page.getByRole('tab', { name: 'Usage' }).click()
  expect(await readWidth()).toMatchObject({ view: 'usage' })
  const usage = await readWidth()
  expect(usage.width).toBeGreaterThanOrEqual(WIDTH_RANGES.usage[0])
  expect(usage.width).toBeLessThanOrEqual(WIDTH_RANGES.usage[1])
  const usageHeader = await page.evaluate(() => {
    const rail = document.querySelector('.header-tabs-rail')
    const label = document.querySelector('.header-tab-discrete .tab-label')
    return {
      railOverflow: rail ? rail.scrollWidth > rail.clientWidth + 1 : true,
      labelsVisible: label ? getComputedStyle(label).display !== 'none' : false,
    }
  })
  expect(usageHeader).toEqual({ railOverflow: false, labelsVisible: false })

  await page.getByRole('tab', { name: 'Runtime' }).click()
  const runtime = await readWidth()
  expect(runtime.view).toBe('runtime')
  expect(runtime.width).toBeGreaterThanOrEqual(WIDTH_RANGES.runtime[0])
  expect(runtime.width).toBeLessThanOrEqual(WIDTH_RANGES.runtime[1])

  await page.getByRole('tab', { name: 'Services' }).click()
  const services = await readWidth()
  expect(services.view).toBe('services')
  expect(services.width).toBeGreaterThanOrEqual(WIDTH_RANGES.services[0])
  expect(services.width).toBeLessThanOrEqual(WIDTH_RANGES.services[1])

  await page.getByRole('button', { name: 'Setup' }).click()
  const setup = await readWidth()
  expect(setup.view).toBe('setup')
  expect(setup.width).toBeGreaterThanOrEqual(WIDTH_RANGES.setup[0])
  expect(setup.width).toBeLessThanOrEqual(WIDTH_RANGES.setup[1])

  await page.getByRole('button', { name: /Back/ }).click()
  await page.getByRole('tab', { name: 'Sessions' }).click()
  await page.getByRole('button', { name: 'Open agent-halo session details' }).first().click()
  const detail = await readWidth()
  expect(detail.view).toBe('session-detail')
  expect(detail.width).toBeGreaterThanOrEqual(WIDTH_RANGES['session-detail'][0])
  expect(detail.width).toBeLessThanOrEqual(WIDTH_RANGES['session-detail'][1])

  await page.setViewportSize({ width: 320, height: 700 })
  await expect.poll(async () => (await readWidth()).width).toBe(320)
  expect(await page.locator('.halo-surface').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
})

test('wide Focus uses three independent cards, 12px gutters, and a fully visible default Pomodoro', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/?demo=1&demoScenario=idle')
  await page.getByRole('tab', { name: 'Focus' }).click()
  await expect
    .poll(() =>
      page.locator('.halo-surface').evaluate((surface) => Number.parseFloat(getComputedStyle(surface).height)),
    )
    .toBe(500)

  const geometry = await page.getByTestId('focus-tools-tray').evaluate((tray) => {
    const cards = [...tray.querySelectorAll<HTMLElement>('.focus-tool-card')]
    const cardRects = cards.map((card) => card.getBoundingClientRect())
    const scrollers = cards.map((card) => card.querySelector<HTMLElement>("[data-scroll-owner='inner']")!)
    const trayWidth = tray.getBoundingClientRect().width
    return {
      panelHeight: Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>('.halo-surface')!).height),
      ratios: cardRects.map((rect) => rect.width / (trayWidth - 24)),
      gaps: [cardRects[1].left - cardRects[0].right, cardRects[2].left - cardRects[1].right],
      scrollers: scrollers.map((scroller) => {
        const style = getComputedStyle(scroller)
        return {
          position: style.position,
          inset: [style.top, style.right, style.bottom, style.left],
          padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
          gutter: style.scrollbarGutter,
        }
      }),
      pomodoroOverflow: scrollers[0].scrollHeight > scrollers[0].clientHeight,
      horizontalOverflow: tray.scrollWidth > tray.clientWidth + 1,
    }
  })

  expect(geometry.panelHeight).toBe(500)
  expect(geometry.ratios[0]).toBeCloseTo(0.4, 1)
  expect(geometry.ratios[1]).toBeCloseTo(0.32, 1)
  expect(geometry.ratios[2]).toBeCloseTo(0.28, 1)
  expect(geometry.gaps).toEqual([12, 12])
  expect(geometry.pomodoroOverflow).toBe(false)
  expect(geometry.horizontalOverflow).toBe(false)
  for (const scroller of geometry.scrollers) {
    expect(scroller.position).toBe('absolute')
    expect(scroller.inset).toEqual(['0px', '0px', '0px', '0px'])
    expect(scroller.padding).toEqual(['12px', '12px', '12px', '12px'])
    expect(scroller.gutter).toBe('auto')
  }
})

test('every multi-card surface exposes the Sessions-style keyboard resize grip', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/?demo=1&demoScenario=multi')

  const assertResizable = async (selector: string, count: number) => {
    const dividers = page.locator(selector)
    await expect(dividers).toHaveCount(count)
    const divider = dividers.first()
    const before = await divider.getAttribute('aria-valuenow')
    await divider.focus()
    await page.keyboard.press('ArrowRight')
    await expect(divider).not.toHaveAttribute('aria-valuenow', before ?? '')
  }

  await page.getByRole('tab', { name: 'Focus' }).click()
  await assertResizable('.focus-tools-tray .card-resize-divider', 2)
  await page.getByRole('tab', { name: 'Usage' }).click()
  await assertResizable('.usage-tray .usage-divider', 3)
  await page.getByRole('tab', { name: 'Runtime' }).click()
  await assertResizable('.runtime-board .card-resize-divider', 1)
  await page.getByRole('tab', { name: 'Services' }).click()
  await assertResizable('.services-board .card-resize-divider', 1)
  await page.getByRole('button', { name: 'Setup' }).click()
  await assertResizable('.setup-tray .card-resize-divider', 1)
  await page.getByRole('button', { name: /Back/ }).click()
  await page.getByRole('tab', { name: 'Sessions' }).click()
  await assertResizable('.sessions-tray .sessions-divider', 2)
  await page.locator('.session-row-main').first().click()
  await assertResizable('.session-detail-tray .card-resize-divider', 1)
})

test('Usage renders one resizable card per provider with independent wide scrollers', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/?demo=1&demoScenario=multi')
  await page.getByRole('tab', { name: 'Usage' }).click()

  const geometry = await page.getByTestId('usage-tray').evaluate((tray) => {
    const cards = [...tray.querySelectorAll<HTMLElement>('.usage-card')]
    const rects = cards.map((card) => card.getBoundingClientRect())
    const scrollers = cards.map((card) => card.querySelector<HTMLElement>("[data-scroll-owner='inner']")!)
    const dividers = [...tray.querySelectorAll<HTMLElement>('.usage-divider')]
    return {
      cardCount: cards.length,
      paints: cards.map((card) => getComputedStyle(card).backgroundColor),
      gaps: rects.slice(1).map((rect, index) => rect.left - rects[index].right),
      widths: rects.map((rect) => rect.width),
      order: scrollers.map((scroller) => scroller.dataset.usageCard),
      dividerCount: dividers.length,
      horizontalOverflow: tray.scrollWidth > tray.clientWidth + 1,
      scrollers: scrollers.map((scroller) => {
        const style = getComputedStyle(scroller)
        return {
          position: style.position,
          inset: [style.top, style.right, style.bottom, style.left],
          padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
          gutter: style.scrollbarGutter,
        }
      }),
    }
  })

  expect(geometry.cardCount).toBe(4)
  expect(geometry.paints).toEqual([
    'rgb(142, 165, 148)',
    'rgb(140, 135, 161)',
    'rgb(163, 158, 106)',
    'rgb(155, 150, 131)',
  ])
  expect(geometry.gaps).toEqual([12, 12, 12])
  expect(geometry.widths.every((width) => width >= 190)).toBe(true)
  expect(geometry.dividerCount).toBe(3)
  expect(geometry.order).toEqual(['codex', 'agy', 'claude', 'cursor'])
  expect(geometry.horizontalOverflow).toBe(false)
  for (const scroller of geometry.scrollers) {
    expect(scroller.position).toBe('absolute')
    expect(scroller.inset).toEqual(['0px', '0px', '0px', '0px'])
    expect(scroller.padding).toEqual(['12px', '12px', '12px', '12px'])
    expect(scroller.gutter).toBe('auto')
  }
})

test('compact Usage stacks provider cards and gives scrolling to the tray', async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 440 })
  await page.goto('/?demo=1&demoScenario=multi')
  await page.getByRole('tab', { name: 'Usage' }).click()

  const tray = page.getByTestId('usage-tray')
  const geometry = await tray.evaluate((node) => {
    const cards = [...node.querySelectorAll<HTMLElement>('.usage-card')]
    const rects = cards.map((card) => card.getBoundingClientRect())
    const scrollers = cards.map((card) => card.querySelector<HTMLElement>("[data-scroll-owner='inner']")!)
    return {
      order: scrollers.map((scroller) => scroller.dataset.usageCard),
      tops: rects.map((rect) => rect.top),
      minHeights: cards.map((card) => getComputedStyle(card).minHeight),
      trayOverflowY: getComputedStyle(node).overflowY,
      horizontalOverflow: node.scrollWidth > node.clientWidth + 1,
      scrollers: scrollers.map((scroller) => ({
        position: getComputedStyle(scroller).position,
        overflowY: getComputedStyle(scroller).overflowY,
      })),
    }
  })

  expect(geometry.order).toEqual(['codex', 'agy', 'claude', 'cursor'])
  expect(geometry.tops[0]).toBeLessThan(geometry.tops[1])
  expect(geometry.minHeights.every((height) => height === '0px')).toBe(true)
  expect(geometry.trayOverflowY).toBe('auto')
  expect(geometry.horizontalOverflow).toBe(false)
  for (const scroller of geometry.scrollers) {
    expect(scroller.position).toBe('relative')
    expect(scroller.overflowY).toBe('visible')
  }

  const trayBox = await tray.boundingBox()
  if (!trayBox) throw new Error('missing compact Usage tray geometry')
  await page.mouse.move(trayBox.x + trayBox.width / 2, trayBox.y + trayBox.height / 2)
  await page.mouse.wheel(0, 800)
  await expect.poll(() => tray.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
})

test('wide Setup uses two material cards with a fixed detail heading and flat Pet controls', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/?demo=1&demoScenario=multi')
  await page.getByRole('button', { name: 'Setup' }).click()
  const tray = page.getByTestId('settings-board')
  await expect(tray).toHaveClass(/setup-tray/)
  await expect
    .poll(() => page.locator('.halo-surface').evaluate((node) => Number.parseFloat(getComputedStyle(node).height)))
    .toBe(500)

  const wide = await tray.evaluate((node) => {
    const cards = [...node.querySelectorAll<HTMLElement>('.setup-card')]
    const rects = cards.map((card) => card.getBoundingClientRect())
    const detail = node.querySelector<HTMLElement>('.setup-detail-card')!
    const heading = node.querySelector<HTMLElement>('.setup-detail-heading')!
    const body = node.querySelector<HTMLElement>("[data-setup-card='detail']")!
    const headingRect = heading.getBoundingClientRect()
    const bodyRect = body.getBoundingClientRect()
    return {
      cardCount: cards.length,
      paints: cards.map((card) => getComputedStyle(card).backgroundColor),
      gap: rects[1].left - rects[0].right,
      navigationWidth: rects[0].width,
      detailFlexible: rects[1].width > rects[0].width,
      detailRows: getComputedStyle(detail).gridTemplateRows,
      headingBodyGap: bodyRect.top - headingRect.bottom,
      detailOverflowY: getComputedStyle(body).overflowY,
      horizontalOverflow: node.scrollWidth > node.clientWidth + 1,
    }
  })
  expect(wide.cardCount).toBe(2)
  expect(wide.paints).toEqual(['rgb(113, 127, 142)', 'rgb(155, 150, 131)'])
  expect(wide.gap).toBeCloseTo(12, 0)
  expect(wide.navigationWidth).toBeGreaterThan(190)
  expect(wide.detailFlexible).toBe(true)
  expect(wide.detailRows).toContain('minmax(0px, 1fr)')
  expect(wide.headingBodyGap).toBeGreaterThanOrEqual(0)
  expect(wide.detailOverflowY).toBe('auto')
  expect(wide.horizontalOverflow).toBe(false)
  const passiveBorders = await page
    .locator('.setup-row.passive')
    .first()
    .evaluate((row) => {
      const style = getComputedStyle(row)
      return [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
        style.borderBottomStyle,
      ]
    })
  expect(passiveBorders).toEqual(['0px', '0px', '1px', '0px', 'solid'])

  await page.getByRole('tab', { name: 'Pet' }).click()
  const flat = await page.locator('.setup-detail-card').evaluate((node) => {
    const row = node.querySelector<HTMLElement>('.setup-row')!
    const motion = node.querySelector<HTMLElement>('.pet-motion-mapping')!
    const size = node.querySelector<HTMLElement>('.setup-size-options')!
    const preview = node.querySelector<HTMLElement>('.pet-current-preview > .pet-option-sprite')!
    const actions = node.querySelector<HTMLElement>('.setup-row-actions')!
    const copy = node.querySelector<HTMLElement>('.pet-setting-row .setup-copy')!
    const rowStyle = getComputedStyle(row)
    const actionRect = actions.getBoundingClientRect()
    const copyRect = copy.getBoundingClientRect()
    const borderWidths = (element: HTMLElement) => {
      const style = getComputedStyle(element)
      return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
    }
    return {
      rowBorders: borderWidths(row),
      rowRadius: rowStyle.borderRadius,
      motionBorders: borderWidths(motion),
      motionRadius: getComputedStyle(motion).borderRadius,
      sizeBorders: borderWidths(size),
      preview: preview.getBoundingClientRect().width,
      actionsClearCopy: actionRect.left >= copyRect.right - 1 || actionRect.top >= copyRect.bottom - 1,
      motionColumns: getComputedStyle(
        node.querySelector<HTMLElement>('.pet-motion-mapping-grid')!,
      ).gridTemplateColumns.split(' ').length,
      selectHeights: [...node.querySelectorAll<HTMLElement>('.pet-motion-row select')].map(
        (select) => select.getBoundingClientRect().height,
      ),
    }
  })
  expect(flat.rowBorders).toEqual(['0px', '0px', '1px', '0px'])
  expect(flat.rowRadius).toBe('0px')
  expect(flat.motionBorders).toEqual(['1px', '0px', '0px', '0px'])
  expect(flat.motionRadius).toBe('0px')
  expect(flat.sizeBorders).toEqual(['0px', '0px', '0px', '0px'])
  expect(flat.preview).toBeGreaterThanOrEqual(52)
  expect(flat.actionsClearCopy).toBe(true)
  expect(flat.motionColumns).toBe(3)
  expect(flat.selectHeights.every((height) => height >= 24)).toBe(true)

  const body = page.locator("[data-setup-card='detail']")
  await body.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await expect(page.locator('.pet-motion-row').last()).toBeInViewport()
})

test('compact Setup stacks a 90px navigation card over reachable detail content', async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 760 })
  await page.goto('/?demo=1&demoScenario=multi')
  await page.getByRole('button', { name: 'Setup' }).click()
  const tray = page.getByTestId('settings-board')
  await page.getByRole('tab', { name: 'Pet' }).click()

  const compact = await tray.evaluate((node) => {
    const navigation = node.querySelector<HTMLElement>('.setup-navigation-card')!
    const detail = node.querySelector<HTMLElement>('.setup-detail-card')!
    const detailBody = node.querySelector<HTMLElement>("[data-setup-card='detail']")!
    const trayRect = node.getBoundingClientRect()
    const cards = [navigation, detail].map((card) => card.getBoundingClientRect())
    const scrollers = [...node.querySelectorAll<HTMLElement>('[data-setup-card]')]
    const detailContentBottom = cards[1].top - trayRect.top + detail.scrollHeight
    return {
      order: scrollers.map((scroller) => scroller.dataset.setupCard),
      navigationHeight: cards[0].height,
      detailHeight: cards[1].height,
      detailScrollHeight: detail.scrollHeight,
      detailMinHeight: getComputedStyle(detail).minHeight,
      detailBodyHeight: detailBody.clientHeight,
      detailBodyScrollHeight: detailBody.scrollHeight,
      detailGridRows: getComputedStyle(detail).gridTemplateRows,
      trayHeight: node.clientHeight,
      trayScrollHeight: node.scrollHeight,
      trayIncludesDetailContent: node.scrollHeight + 1 >= detailContentBottom,
      cardContentFits: detail.scrollHeight <= detail.clientHeight + 1,
      detailBodyContentFits: detailBody.scrollHeight <= detailBody.clientHeight + 1,
      stacked: cards[0].top < cards[1].top,
      trayOverflowY: getComputedStyle(node).overflowY,
      horizontalOverflow: node.scrollWidth > node.clientWidth + 1,
      innerScrollers: scrollers.map((scroller) => ({
        position: getComputedStyle(scroller).position,
        overflowY: getComputedStyle(scroller).overflowY,
        nestedAuto: [...scroller.querySelectorAll<HTMLElement>('*')].some((element) =>
          ['auto', 'scroll'].includes(getComputedStyle(element).overflowY),
        ),
      })),
      motionColumns: getComputedStyle(
        node.querySelector<HTMLElement>('.pet-motion-mapping-grid')!,
      ).gridTemplateColumns.split(' ').length,
    }
  })
  expect(compact.order).toEqual(['navigation', 'detail'])
  expect(compact.navigationHeight).toBeCloseTo(90, 0)
  expect(compact.detailMinHeight).toBe('520px')
  expect(compact.detailGridRows).toBe('auto auto')
  expect(compact.cardContentFits).toBe(true)
  expect(compact.detailBodyContentFits).toBe(true)
  expect(compact.trayIncludesDetailContent).toBe(true)
  expect(compact.stacked).toBe(true)
  expect(compact.trayOverflowY).toBe('auto')
  expect(compact.horizontalOverflow).toBe(false)
  expect(compact.innerScrollers).toEqual([
    { position: 'relative', overflowY: 'visible', nestedAuto: false },
    { position: 'relative', overflowY: 'visible', nestedAuto: false },
  ])
  expect(compact.motionColumns).toBe(2)

  await tray.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await expect.poll(() => tray.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  const reachability = await tray.evaluate((node) => {
    const rows = [...node.querySelectorAll<HTMLElement>('.pet-motion-row')]
    const lastRow = rows.at(-1)!
    return {
      atMaxScroll: Math.abs(node.scrollTop - (node.scrollHeight - node.clientHeight)) <= 1,
      lastRowWithinTray: lastRow.getBoundingClientRect().bottom <= node.getBoundingClientRect().bottom + 1,
    }
  })
  expect(reachability.atMaxScroll).toBe(true)
  expect(reachability.lastRowWithinTray).toBe(true)
})

test('wide Runtime and Services keep fixed headings above their detail scrollers', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/?demo=1&demoScenario=multi')

  for (const view of ['Runtime', 'Services'] as const) {
    await page.getByRole('tab', { name: view, exact: true }).click()
    const board = page.getByTestId(`${view.toLowerCase()}-board`)
    await expect(board).toBeVisible()
    await expect
      .poll(() =>
        page.locator('.halo-surface').evaluate((surface) => Number.parseFloat(getComputedStyle(surface).height)),
      )
      .toBe(500)

    const geometry = await board.evaluate((tray) => {
      const cards = [...tray.querySelectorAll<HTMLElement>('.monitor-card')]
      const rects = cards.map((card) => card.getBoundingClientRect())
      const overview = tray.querySelector<HTMLElement>("[data-monitor-card='overview']")!
      const detail = tray.querySelector<HTMLElement>("[data-monitor-card='detail']")!
      const heading = tray.querySelector<HTMLElement>('.runtime-detail-heading')!
      const refresh = tray.querySelector<HTMLElement>("[data-surface-control-shape='circle']")!
      const styleOf = (element: HTMLElement) => getComputedStyle(element)
      const overviewStyle = styleOf(overview)
      const detailStyle = styleOf(detail)
      const headingBefore = heading.getBoundingClientRect()
      detail.scrollTop = detail.scrollHeight
      const headingAfter = heading.getBoundingClientRect()
      const detailRect = detail.getBoundingClientRect()
      const lastServiceRow = tray.querySelector<HTMLElement>('.runtime-service-row:last-child')
      const refreshRect = refresh.getBoundingClientRect()
      return {
        cardCount: cards.length,
        overviewWidth: rects[0].width,
        detailWidth: rects[1].width,
        gap: rects[1].left - rects[0].right,
        horizontalOverflow: tray.scrollWidth > tray.clientWidth + 1,
        overview: {
          position: overviewStyle.position,
          inset: [overviewStyle.top, overviewStyle.right, overviewStyle.bottom, overviewStyle.left],
          padding: [
            overviewStyle.paddingTop,
            overviewStyle.paddingRight,
            overviewStyle.paddingBottom,
            overviewStyle.paddingLeft,
          ],
          overflowY: overviewStyle.overflowY,
        },
        detail: {
          position: detailStyle.position,
          padding: [
            detailStyle.paddingTop,
            detailStyle.paddingRight,
            detailStyle.paddingBottom,
            detailStyle.paddingLeft,
          ],
          overflowY: detailStyle.overflowY,
          top: detailRect.top,
          scrollTop: detail.scrollTop,
          maxScrollTop: detail.scrollHeight - detail.clientHeight,
        },
        headingBottom: headingBefore.bottom,
        headingTopBefore: headingBefore.top,
        headingTopAfter: headingAfter.top,
        lastServiceReachable: !lastServiceRow || lastServiceRow.getBoundingClientRect().bottom <= detailRect.bottom + 1,
        refresh: { width: refreshRect.width, height: refreshRect.height, radius: styleOf(refresh).borderRadius },
      }
    })

    expect(geometry.cardCount).toBe(2)
    expect(geometry.overviewWidth).toBeGreaterThan(190)
    expect(geometry.detailWidth).toBeGreaterThan(190)
    expect(geometry.gap).toBeCloseTo(12, 0)
    expect(geometry.horizontalOverflow).toBe(false)
    expect(geometry.overview).toEqual({
      position: 'absolute',
      inset: ['0px', '0px', '0px', '0px'],
      padding: ['12px', '12px', '12px', '12px'],
      overflowY: 'auto',
    })
    expect(geometry.detail.position).toBe('relative')
    expect(geometry.detail.padding).toEqual(['6px', '12px', '12px', '12px'])
    expect(geometry.detail.overflowY).toBe('auto')
    expect(geometry.detail.top).toBeGreaterThanOrEqual(geometry.headingBottom - 1)
    expect(geometry.headingTopAfter).toBeCloseTo(geometry.headingTopBefore, 1)
    expect(geometry.detail.scrollTop).toBe(geometry.detail.maxScrollTop)
    expect(geometry.lastServiceReachable).toBe(true)
    expect(geometry.refresh.width).toBeCloseTo(28, 2)
    expect(geometry.refresh.height).toBeCloseTo(28, 2)
    expect(geometry.refresh.radius).toBe('50%')
  }
})

test('compact Runtime and Services stack 210px and 420px cards with tray scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 440 })
  await page.goto('/?demo=1&demoScenario=multi')

  for (const view of ['Runtime', 'Services'] as const) {
    await page.getByRole('tab', { name: view, exact: true }).click()
    const board = page.getByTestId(`${view.toLowerCase()}-board`)
    await expect(board).toBeVisible()
    const geometry = await board.evaluate((tray) => {
      const cards = [...tray.querySelectorAll<HTMLElement>('.monitor-card')]
      const rects = cards.map((card) => card.getBoundingClientRect())
      const scrollers = cards.map((card) => card.querySelector<HTMLElement>("[data-scroll-owner='inner']")!)
      return {
        order: scrollers.map((scroller) => scroller.dataset.monitorCard),
        tops: rects.map((rect) => rect.top),
        widths: rects.map((rect) => rect.width),
        trayWidth: tray.getBoundingClientRect().width,
        minHeights: cards.map((card) => getComputedStyle(card).minHeight),
        trayOverflowY: getComputedStyle(tray).overflowY,
        trayScrollable: tray.scrollHeight > tray.clientHeight,
        horizontalOverflow: tray.scrollWidth > tray.clientWidth + 1,
        cardsNotClipped: cards.every((card) => card.scrollHeight <= card.clientHeight + 1),
        scrollers: scrollers.map((scroller) => ({
          position: getComputedStyle(scroller).position,
          overflowY: getComputedStyle(scroller).overflowY,
          padding: [
            getComputedStyle(scroller).paddingTop,
            getComputedStyle(scroller).paddingRight,
            getComputedStyle(scroller).paddingBottom,
            getComputedStyle(scroller).paddingLeft,
          ],
          contentFits: scroller.scrollHeight <= scroller.clientHeight + 1,
          nestedAuto: [...scroller.querySelectorAll<HTMLElement>('*')].some((element) =>
            ['auto', 'scroll'].includes(getComputedStyle(element).overflowY),
          ),
        })),
      }
    })

    expect(geometry.order).toEqual(['overview', 'detail'])
    expect(geometry.tops[0]).toBeLessThan(geometry.tops[1])
    expect(geometry.minHeights).toEqual(['210px', '420px'])
    expect(geometry.widths.every((width) => Math.abs(width - geometry.trayWidth) <= 1)).toBe(true)
    expect(geometry.trayOverflowY).toBe('auto')
    expect(geometry.trayScrollable).toBe(true)
    expect(geometry.horizontalOverflow).toBe(false)
    expect(geometry.cardsNotClipped).toBe(true)
    expect(geometry.scrollers[0]).toEqual({
      position: 'relative',
      overflowY: 'visible',
      padding: ['12px', '12px', '12px', '12px'],
      contentFits: true,
      nestedAuto: false,
    })
    expect(geometry.scrollers[1]).toEqual({
      position: 'relative',
      overflowY: 'visible',
      padding: ['6px', '12px', '12px', '12px'],
      contentFits: true,
      nestedAuto: false,
    })

    await board.evaluate((tray) => {
      tray.scrollTop = tray.scrollHeight
    })
    await expect.poll(() => board.evaluate((tray) => tray.scrollTop)).toBeGreaterThan(0)
    const finalRow =
      view === 'Services' ? board.locator('.runtime-service-row').last() : board.locator('.runtime-row').last()
    await expect(finalRow).toBeVisible()
    expect(
      await finalRow.evaluate((row, boardTestId) => {
        const tray = document.querySelector<HTMLElement>(`[data-testid='${boardTestId}']`)!
        return row.getBoundingClientRect().bottom <= tray.getBoundingClientRect().bottom + 1
      }, `${view.toLowerCase()}-board`),
    ).toBe(true)
  }
})

test('colored boards own vertical scrolling and keep complete material edges', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.goto('/?demo=1&demoScenario=multi')
  await page.waitForTimeout(200)

  const inspect = async (boardSelector: string, scrollerSelector = "[data-scroll-owner='inner']") =>
    page.evaluate(
      ({ selector, target }) => {
        const board = document.querySelector<HTMLElement>(selector)
        const sheet = document.querySelector<HTMLElement>('.sheet-body')
        const inner = document.querySelector<HTMLElement>('.sheet-inner')
        const scroller = board?.querySelector<HTMLElement>(target)
        if (!board || !sheet || !inner || !scroller) throw new Error(`missing ${selector} or ${target}`)
        scroller.style.maxHeight = '100px'
        const boardBox = board.getBoundingClientRect()
        const sheetBox = sheet.getBoundingClientRect()
        scroller.scrollTop = 48
        return {
          boardOverflowY: getComputedStyle(board).overflowY,
          scrollerOverflowY: getComputedStyle(scroller).overflowY,
          sheetOverflowY: getComputedStyle(sheet).overflowY,
          nestedAuto: [...scroller.querySelectorAll<HTMLElement>('*')].some((element) =>
            ['auto', 'scroll'].includes(getComputedStyle(element).overflowY),
          ),
          scrollerScrollTop: scroller.scrollTop,
          scrollerCanScroll: scroller.scrollHeight > scroller.clientHeight,
          completeEdges:
            boardBox.top >= sheetBox.top - 1 &&
            boardBox.bottom <= sheetBox.bottom + 1 &&
            getComputedStyle(board).borderBottomLeftRadius !== '0px' &&
            getComputedStyle(board).backgroundColor !== 'rgba(0, 0, 0, 0)',
          horizontalOverflow: board.scrollWidth > board.clientWidth + 1,
        }
      },
      { selector: boardSelector, target: scrollerSelector },
    )

  const sessions = await inspect("[data-testid='sessions-board']")
  expect(sessions).toMatchObject({
    boardOverflowY: 'hidden',
    scrollerOverflowY: 'auto',
    sheetOverflowY: 'hidden',
    nestedAuto: false,
    completeEdges: true,
    horizontalOverflow: false,
  })
  expect(sessions.scrollerScrollTop).toBeGreaterThan(0)

  await page.getByRole('tab', { name: 'Runtime' }).click()
  await page.waitForTimeout(200)
  await expect(page.getByTestId('runtime-board')).toBeVisible()
  const runtime = await inspect("[data-testid='runtime-board']", "[data-monitor-card='detail']")
  expect(runtime.boardOverflowY).toBe('hidden')
  expect(runtime.scrollerOverflowY).toBe('auto')
  expect(runtime.nestedAuto).toBe(false)

  await page.getByRole('tab', { name: 'Services' }).click()
  const servicesDetail = page.locator("[data-testid='services-board'] [data-monitor-card='detail']")
  await expect(servicesDetail).toBeVisible()
  await expect.poll(() => servicesDetail.evaluate((scroller) => scroller.scrollTop)).toBe(0)

  await page.getByRole('button', { name: 'Setup' }).click()
  await page.waitForTimeout(200)
  const setup = await inspect("[data-testid='settings-board'] .setup-detail-card", "[data-setup-card='detail']")
  expect(setup.boardOverflowY).toBe('hidden')
  expect(setup.scrollerOverflowY).toBe('auto')
  expect(setup.nestedAuto).toBe(false)
  expect(setup.completeEdges).toBe(true)
})

for (const view of ['Runtime', 'Services'] as const) {
  test(`${view} preserves its detail scroll position when closed and reopened`, async ({ page }) => {
    const panelView = view.toLowerCase()
    const board = `[data-testid='${panelView}-board']`
    const scrollerSelector = `${board} [data-monitor-card='detail']`
    await page.goto('/?demo=1&demoScenario=multi')
    await page.addStyleTag({ content: `${scrollerSelector} { max-height: 120px !important; }` })
    await page.getByRole('tab', { name: view, exact: true }).click()
    const scroller = page.locator(scrollerSelector)
    await expect(scroller).toBeVisible()
    await scroller.evaluate((element) => {
      element.scrollTop = 48
    })
    expect(await scroller.evaluate((element) => element.scrollTop)).toBe(48)

    await page.keyboard.press('Escape')
    await expect(page.locator('.halo-surface')).toHaveAttribute('data-state', 'closed')

    await page.locator('.halo-surface').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.halo-surface')).toHaveAttribute('data-state', 'open')
    expect(await page.locator('.halo-surface').getAttribute('data-panel-view')).toBe(panelView)
    await expect.poll(async () => scroller.evaluate((element) => element.scrollTop)).toBe(48)
  })
}

test('navigating from usage to setup and back restores active tab and prior scroll position', async ({ page }) => {
  await page.goto('/?demo=1&demoScenario=multi')
  await page.addStyleTag({ content: "[data-usage-card='codex'] { max-height: 120px !important; }" })
  await page.getByRole('tab', { name: 'Usage' }).click()
  const usageScroller = page.locator("[data-usage-card='codex']")
  await expect(usageScroller).toBeVisible()
  await usageScroller.evaluate((element) => {
    element.scrollTop = 56
  })
  expect(await usageScroller.evaluate((element) => element.scrollTop)).toBe(56)

  await page.getByRole('button', { name: 'Setup' }).click()
  await expect(page.locator("[data-testid='settings-board']")).toBeVisible()
  expect(await page.locator('.halo-surface').getAttribute('data-panel-view')).toBe('setup')

  await page.getByRole('button', { name: /Back/ }).click()
  await expect(page.getByTestId('usage-tray')).toBeVisible()
  expect(await page.locator('.halo-surface').getAttribute('data-panel-view')).toBe('usage')
  await expect.poll(async () => usageScroller.evaluate((element) => element.scrollTop)).toBe(56)
})

test('surface personalities stay distinct and drop the legacy orange recipe', async ({ page }) => {
  await page.goto('/?demo=1&demoScenario=multi')

  await page.getByRole('tab', { name: 'Sessions' }).click()
  const sessions = await paint(page, "[data-testid='sessions-board']")
  expect(sessions.backgroundColor).toBe('rgb(142, 165, 148)')

  await page.getByRole('tab', { name: 'Focus' }).click()
  const focus = await paint(page, '.focus-tool-card-pomodoro')
  expect(focus.backgroundColor).toBe('rgb(140, 135, 161)')
  expect((await paint(page, '.focus-tool-card-stopwatch')).backgroundColor).toBe('rgb(142, 165, 148)')
  expect((await paint(page, '.focus-tool-card-move')).backgroundColor).toBe('rgb(163, 158, 106)')
  const start = await page
    .locator('.pomodoro-panel')
    .getByRole('button', { name: 'Start' })
    .evaluate((button) => getComputedStyle(button).backgroundColor)
  expect(start).not.toBe('rgb(255, 157, 61)')
  expect(start).toBe('rgb(17, 17, 17)')

  await page.getByRole('tab', { name: 'Usage' }).click()
  expect((await paint(page, '.usage-card-slot:nth-child(1) .usage-provider-surface')).backgroundColor).toBe(
    'rgb(142, 165, 148)',
  )
  expect((await paint(page, '.usage-card-slot:nth-child(3) .usage-provider-surface')).backgroundColor).toBe(
    'rgb(140, 135, 161)',
  )

  await page.getByRole('tab', { name: 'Runtime' }).click()
  const runtime = await paint(page, "[data-testid='runtime-board'] .monitor-detail-card")
  expect(runtime.backgroundColor).toBe('rgb(113, 127, 142)')

  await page.getByRole('tab', { name: 'Services' }).click()
  const services = await paint(page, "[data-testid='services-board'] .monitor-detail-card")
  expect(services.backgroundColor).toBe('rgb(111, 136, 136)')
  expect(services.backgroundColor).not.toBe(runtime.backgroundColor)

  await page.getByRole('button', { name: 'Setup' }).click()
  expect((await paint(page, '.setup-navigation-card')).backgroundColor).toBe('rgb(113, 127, 142)')
  expect((await paint(page, '.setup-detail-card')).backgroundColor).toBe('rgb(155, 150, 131)')

  const orangeHits = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--accent)'
    document.documentElement.append(probe)
    const rootAccent = getComputedStyle(probe).color
    probe.remove()
    return rootAccent
  })
  expect(orangeHits).toBe('rgb(126, 184, 212)')
})

test('wide Session Detail uses resizable mint overview and fixed-heading parchment activity card', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/?demo=1&demoScenario=multi')
  await page.locator('.session-row-main').first().click()
  const tray = page.getByTestId('session-detail-board')
  await expect(tray).toHaveClass(/session-detail-tray/)
  await expect
    .poll(() =>
      page.locator('.halo-surface').evaluate((surface) => Number.parseFloat(getComputedStyle(surface).height)),
    )
    .toBe(500)

  const geometry = await tray.evaluate((node) => {
    const cards = [...node.querySelectorAll<HTMLElement>('.session-detail-card')]
    const rects = cards.map((card) => card.getBoundingClientRect())
    const overview = node.querySelector<HTMLElement>("[data-session-detail-card='overview']")!
    const activity = node.querySelector<HTMLElement>("[data-session-detail-card='activity']")!
    const heading = node.querySelector<HTMLElement>('.session-detail-activity-heading')!
    const controls = node.querySelector<HTMLElement>('.session-detail-controls')!
    const finalRow = node.querySelector<HTMLElement>('.action-row:last-child')
    const headingBefore = heading.getBoundingClientRect()
    activity.scrollTop = activity.scrollHeight
    const activityRect = activity.getBoundingClientRect()
    const overviewRect = overview.getBoundingClientRect()
    return {
      cardCount: cards.length,
      paints: cards.map((card) => getComputedStyle(card).backgroundColor),
      overviewWidth: rects[0].width,
      gap: rects[1].left - rects[0].right,
      fullHeight: rects.every((rect) => Math.abs(rect.height - node.getBoundingClientRect().height) <= 1),
      overviewPadding: [
        getComputedStyle(overview).paddingTop,
        getComputedStyle(overview).paddingRight,
        getComputedStyle(overview).paddingBottom,
        getComputedStyle(overview).paddingLeft,
      ],
      headingStationary: Math.abs(heading.getBoundingClientRect().top - headingBefore.top) <= 1,
      activityStartsBelowHeading: activityRect.top >= headingBefore.bottom - 1,
      activityOverflow: getComputedStyle(activity).overflowY,
      controlsVisible: controls.getBoundingClientRect().bottom <= overviewRect.bottom + 1,
      finalRowReachable: !finalRow || finalRow.getBoundingClientRect().bottom <= activityRect.bottom + 1,
      horizontalOverflow: node.scrollWidth > node.clientWidth + 1,
    }
  })

  expect(geometry).toMatchObject({
    cardCount: 2,
    paints: ['rgb(142, 165, 148)', 'rgb(155, 150, 131)'],
    fullHeight: true,
    overviewPadding: ['12px', '12px', '12px', '12px'],
    headingStationary: true,
    activityStartsBelowHeading: true,
    activityOverflow: 'auto',
    controlsVisible: true,
    finalRowReachable: true,
    horizontalOverflow: false,
  })
  expect(geometry.overviewWidth).toBeGreaterThan(190)
  expect(geometry.gap).toBeCloseTo(12, 0)
})

test('Session Detail interior paint is monochrome and structurally encoded', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/?demo=1&demoScenario=multi')
  await page.locator('.session-row-main').first().click()

  const paintGuard = await page.getByTestId('session-detail-board').evaluate((tray) => {
    const summary = tray.querySelector<HTMLElement>('.session-context-summary')!
    const summaryStyle = getComputedStyle(summary)
    const rows = [...tray.querySelectorAll<HTMLElement>('.action-row')]
    const paints = [
      ...tray.querySelectorAll<HTMLElement>('.action-tool, .action-mark, .session-context-copy, .session-context-meta'),
    ].flatMap((element) => {
      const style = getComputedStyle(element)
      return [style.color, style.backgroundColor, style.borderColor]
    })
    const monochrome = (value: string) => {
      if (value === 'rgba(0, 0, 0, 0)') return true
      const channels = value
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number)
      return Boolean(channels && channels[0] === channels[1] && channels[1] === channels[2])
    }
    return {
      summaryBackground: summaryStyle.backgroundColor,
      summaryBorders: [
        summaryStyle.borderTopWidth,
        summaryStyle.borderRightWidth,
        summaryStyle.borderBottomWidth,
        summaryStyle.borderLeftWidth,
      ],
      rowBorders: rows.map((row) => {
        const style = getComputedStyle(row)
        return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
      }),
      allMonochrome: paints.every(monochrome),
    }
  })

  expect(paintGuard.summaryBackground).toBe('rgba(0, 0, 0, 0)')
  expect(paintGuard.summaryBorders).toEqual(['0px', '0px', '1px', '0px'])
  expect(
    paintGuard.rowBorders.every((borders) => JSON.stringify(borders) === JSON.stringify(['0px', '0px', '1px', '0px'])),
  ).toBe(true)
  expect(paintGuard.allMonochrome).toBe(true)
})

test('canonical dot status tokens introduce dusty green/red exclusively to approved dot selectors', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/?demo=1&demoScenario=error')

  const canonicalTokens = await page
    .locator('.sheet-inner')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        positive: style.getPropertyValue('--surface-dot-positive').trim(),
        negative: style.getPropertyValue('--surface-dot-negative').trim(),
      }
    })
  expect(canonicalTokens.positive).toBe('#5ea876')
  expect(canonicalTokens.negative).toBe('#c75a5a')

  await page.locator('.session-row-main').first().click()
  const errorDot = page.locator('.detail-header .status-dot.status-error')
  await expect(errorDot).toBeVisible()
  expect(await errorDot.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(199, 90, 90)')

  await page.getByRole('button', { name: 'Back to sessions' }).click()
  await page.getByRole('tab', { name: 'Usage' }).click()
  const navDots = await page.evaluate(() => {
    const selected = document.querySelector<HTMLElement>('.usage-card-status-dot')
    return {
      selected: selected ? getComputedStyle(selected).backgroundColor : null,
    }
  })
  expect(navDots.selected).toBe('rgb(94, 168, 118)')
})

for (const width of [620, 320]) {
  test(`compact Session Detail at ${width}px stacks intrinsically with tray-only scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 500 })
    await page.goto('/?demo=1&demoScenario=multi')
    await page.locator('.session-row-main').first().click()
    const tray = page.getByTestId('session-detail-board')
    const geometry = await tray.evaluate((node) => {
      const cards = [...node.querySelectorAll<HTMLElement>('.session-detail-card')]
      const rects = cards.map((card) => card.getBoundingClientRect())
      const scrollers = [...node.querySelectorAll<HTMLElement>("[data-scroll-owner='inner']")]
      const controls = [...node.querySelectorAll<HTMLElement>('.session-context-actions .surface-control')]
      return {
        order: scrollers.map((scroller) => scroller.dataset.sessionDetailCard),
        stacked: rects[0].top < rects[1].top,
        minHeights: cards.map((card) => getComputedStyle(card).minHeight),
        contentFits: cards.every((card) => card.scrollHeight <= card.clientHeight + 1),
        trayOverflowY: getComputedStyle(node).overflowY,
        trayScrollable: node.scrollHeight > node.clientHeight,
        horizontalOverflow: node.scrollWidth > node.clientWidth + 1,
        scrollers: scrollers.map((scroller) => ({
          position: getComputedStyle(scroller).position,
          overflowY: getComputedStyle(scroller).overflowY,
        })),
        controlsDoNotOverlap: controls.every((control, index) =>
          controls.slice(index + 1).every((other) => {
            const a = control.getBoundingClientRect()
            const b = other.getBoundingClientRect()
            return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
          }),
        ),
      }
    })

    expect(geometry.order).toEqual(['overview', 'activity'])
    expect(geometry.stacked).toBe(true)
    expect(Number.parseFloat(geometry.minHeights[0])).toBeGreaterThanOrEqual(300)
    expect(Number.parseFloat(geometry.minHeights[1])).toBeGreaterThanOrEqual(360)
    expect(geometry.contentFits).toBe(true)
    expect(geometry.trayOverflowY).toBe('auto')
    expect(geometry.trayScrollable).toBe(true)
    expect(geometry.horizontalOverflow).toBe(false)
    expect(geometry.controlsDoNotOverlap).toBe(true)
    expect(geometry.scrollers).toEqual([
      { position: 'relative', overflowY: 'visible' },
      { position: 'relative', overflowY: 'visible' },
    ])

    await tray.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await expect.poll(() => tray.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
    const reachability = await tray.evaluate((node) => {
      const lastRow = node.querySelector<HTMLElement>('.action-row:last-child')
      const back = node.querySelector<HTMLElement>('.session-context-return')!
      const trayRect = node.getBoundingClientRect()
      return {
        atMaxScroll: Math.abs(node.scrollTop - (node.scrollHeight - node.clientHeight)) <= 1,
        lastRowReachable: !lastRow || lastRow.getBoundingClientRect().bottom <= trayRect.bottom + 1,
        backPrecedesActivity:
          back.getBoundingClientRect().bottom <=
          node.querySelector<HTMLElement>('.session-detail-activity-card')!.getBoundingClientRect().top + 1,
      }
    })
    expect(reachability).toEqual({ atMaxScroll: true, lastRowReachable: true, backPrecedesActivity: true })
  })
}

test('visual polish regression: bridge dots, notice spacing, runtime clipping, usage icon, done/inactive badges, detail dividers', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 })

  // 1. Bridge dots in Setup
  await page.goto('/?demo=1&demoScenario=idle')
  await page.getByRole('button', { name: 'Setup' }).click()
  const setupDot = page.locator(".bridge-dot[data-connected='true']")
  await expect(setupDot).toBeVisible()
  expect(await setupDot.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(94, 168, 118)')

  // 2. Setup notice row margin
  await page.getByRole('button', { name: 'Check' }).click()
  const notice = page.locator('.setup-category-panel .notice-row')
  await expect(notice).toBeVisible()
  expect(await notice.evaluate((el) => getComputedStyle(el).marginTop)).toBe('8px')
  expect(await notice.evaluate((el) => getComputedStyle(el).marginBottom)).toBe('0px')

  // 3. Runtime & Services content begins below heading without clipping
  await page.getByRole('button', { name: 'Back to sessions' }).click()
  await page.getByRole('tab', { name: 'Runtime' }).click()
  const runtimeHeading = page.locator('.runtime-detail-heading')
  const runtimeScroll = page.locator('.runtime-board .monitor-detail-card .halo-inner-scroll')
  await expect(runtimeHeading).toBeVisible()
  await expect(runtimeScroll).toBeVisible()
  const [rhBox, rsBox] = await Promise.all([runtimeHeading.boundingBox(), runtimeScroll.boundingBox()])
  expect(rhBox).not.toBeNull()
  expect(rsBox).not.toBeNull()
  expect(rsBox!.y).toBeGreaterThanOrEqual(rhBox!.y + rhBox!.height - 1)
  expect(await runtimeScroll.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('6px')

  await page.getByRole('tab', { name: 'Services' }).click()
  const servicesHeading = page.locator('.services-board .runtime-detail-heading')
  const servicesScroll = page.locator('.services-board .monitor-detail-card .halo-inner-scroll')
  await expect(servicesHeading).toBeVisible()
  await expect(servicesScroll).toBeVisible()
  const [shBox, ssBox] = await Promise.all([servicesHeading.boundingBox(), servicesScroll.boundingBox()])
  expect(shBox).not.toBeNull()
  expect(ssBox).not.toBeNull()
  expect(ssBox!.y).toBeGreaterThanOrEqual(shBox!.y + shBox!.height - 1)
  expect(await servicesScroll.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('6px')

  // 4. Usage provider icons remain visible in the multi-card board
  await page.getByRole('tab', { name: 'Usage' }).click()
  await expect(page.locator('.usage-provider-surface .usage-provider-icon')).toHaveCount(4)

  // 5. Done and Inactive badges remain achromatic with <= 1px calm borders and pill radius
  await page.goto('/?demo=1&demoScenario=done')
  const doneBadge = page.locator('.session-inline-status.status-text-done')
  await expect(doneBadge).toBeVisible()
  const doneStyles = await doneBadge.evaluate((el) => {
    const cs = getComputedStyle(el)
    return {
      borderWidth: parseFloat(cs.borderWidth),
      borderRadius: parseFloat(cs.borderRadius),
      color: cs.color,
      bgColor: cs.backgroundColor,
    }
  })
  expect(doneStyles.borderWidth).toBeLessThanOrEqual(1)
  expect(doneStyles.borderRadius).toBeGreaterThanOrEqual(99)

  await page.goto('/?demo=1&demoScenario=inactive')
  const inactiveBadge = page.locator('.session-inline-status.status-text-inactive')
  await expect(inactiveBadge).toBeVisible()
  const inactiveStyles = await inactiveBadge.evaluate((el) => {
    const cs = getComputedStyle(el)
    return {
      borderWidth: parseFloat(cs.borderWidth),
      borderRadius: parseFloat(cs.borderRadius),
      color: cs.color,
      bgColor: cs.backgroundColor,
    }
  })
  expect(inactiveStyles.borderWidth).toBeLessThanOrEqual(1)
  expect(inactiveStyles.borderRadius).toBeGreaterThanOrEqual(99)

  // 6. Detail summary outline none, return count badge no border + pill radius, all three dividers resolve to identical color & width
  await page.locator('.session-row-main').first().click()
  const summary = page.locator('.session-context-summary')
  const returnCount = page.locator('.session-context-return-count')
  const activityHeading = page.locator('.session-detail-activity-heading')
  const actionRow = page.locator('.action-row').first()
  await expect(summary).toBeVisible()
  await expect(returnCount).toBeVisible()
  await expect(activityHeading).toBeVisible()
  await expect(actionRow).toBeVisible()

  const detailStyles = await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('.session-context-summary')!
    const rc = document.querySelector<HTMLElement>('.session-context-return-count')!
    const ah = document.querySelector<HTMLElement>('.session-detail-activity-heading')!
    const ar = document.querySelector<HTMLElement>('.action-row')!
    const scs = getComputedStyle(s)
    const rcs = getComputedStyle(rc)
    const ahs = getComputedStyle(ah)
    const ars = getComputedStyle(ar)

    return {
      summaryOutline: scs.outlineStyle,
      returnCountBorderWidth: parseFloat(rcs.borderWidth),
      returnCountRadius: parseFloat(rcs.borderRadius),
      returnCountFontSize: rcs.fontSize,
      dividers: [
        { width: scs.borderBottomWidth, color: scs.borderBottomColor },
        { width: ahs.borderBottomWidth, color: ahs.borderBottomColor },
        { width: ars.borderBottomWidth, color: ars.borderBottomColor },
      ],
    }
  })

  expect(detailStyles.summaryOutline).toBe('none')
  expect(detailStyles.returnCountBorderWidth).toBe(0)
  expect(detailStyles.returnCountRadius).toBeGreaterThanOrEqual(99)
  expect(detailStyles.returnCountFontSize).toBe('9px')
  expect(detailStyles.dividers[0]).toEqual(detailStyles.dividers[1])
  expect(detailStyles.dividers[1]).toEqual(detailStyles.dividers[2])
  expect(detailStyles.dividers[0].width).toBe('1px')
})
