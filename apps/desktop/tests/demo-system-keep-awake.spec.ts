import { expect, type Page, test } from '@playwright/test'

const openDisplay = async (page: Page) => {
  await page.getByRole('button', { name: 'Setup', exact: true }).click()
  await page.getByRole('tab', { name: 'Display', exact: true }).click()
}
const row = (page: Page, kind: 'display' | 'system') =>
  page.locator('.setup-row').filter({ has: page.getByText(`Keep ${kind} awake`, { exact: true }) })
const group = (page: Page, kind: 'display' | 'system') =>
  page.getByRole('radiogroup', { name: `Keep ${kind} awake mode`, exact: true })

const mockNative = async (page: Page) => {
  await page.addInitScript(() => {
    ;(window as any).__awakeCalls = []
    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: { active?: boolean }) => {
        if (command === 'notch_metrics') return [184, 36]
        if (!['set_keep_awake', 'set_system_keep_awake'].includes(command)) return null
        ;(window as any).__awakeCalls.push({ command, active: args?.active === true })
        return args?.active === true
      },
    }
  })
}

test('system defaults Agent independently of legacy display; malformed fails Off', async ({ page }) => {
  await page.goto('/?demo=1&demoScenario=idle')
  const result = await page.evaluate(async () => {
    const { readSystemKeepAwakeMode, readKeepAwakeMode, shouldKeepSystemAwake } = await import(
      '/src/features/keep-awake/preferences.ts'
    )
    const key = 'agent-halo.system-keep-awake-mode'
    localStorage.removeItem(key)
    localStorage.removeItem('agent-halo.keep-awake-mode')
    localStorage.setItem('agent-halo.keep-awake-while-working', 'true')
    const fresh = readSystemKeepAwakeMode()
    const display = readKeepAwakeMode()
    localStorage.setItem(key, 'invalid')
    const malformed = readSystemKeepAwakeMode()
    localStorage.setItem(key, 'off')
    return {
      fresh,
      display,
      malformed,
      explicitOff: readSystemKeepAwakeMode(),
      matrix: ['on', 'agent', 'off'].map((mode) => [
        shouldKeepSystemAwake(mode, false),
        shouldKeepSystemAwake(mode, true),
      ]),
    }
  })
  expect(result).toEqual({
    fresh: 'agent',
    display: 'agent',
    malformed: 'off',
    explicitOff: 'off',
    matrix: [
      [true, true],
      [false, true],
      [false, false],
    ],
  })
})

for (const kind of ['display', 'system'] as const) {
  test(`${kind} A → B → Setup unmount/remount → B persists without changing the other mode`, async ({ page }) => {
    await mockNative(page)
    await page.goto('/?demo=1&demoScenario=idle')
    await openDisplay(page)
    const other = kind === 'display' ? 'system' : 'display'
    await expect(
      group(page, other).getByRole('radio', { name: other === 'display' ? 'Off' : 'Agent', exact: true }),
    ).toBeChecked()
    await group(page, kind).getByText('On', { exact: true }).click()
    await expect(row(page, kind).getByText('On · Active', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
    await expect(page.getByTestId('settings-board')).toHaveCount(0)
    await openDisplay(page)
    await expect(group(page, kind).getByRole('radio', { name: 'On', exact: true })).toBeChecked()
    await expect(
      group(page, other).getByRole('radio', { name: other === 'display' ? 'Off' : 'Agent', exact: true }),
    ).toBeChecked()
    await page.reload()
    await openDisplay(page)
    await expect(group(page, kind).getByRole('radio', { name: 'On', exact: true })).toBeChecked()
    await group(page, kind).getByText('Agent', { exact: true }).click()
    await expect(row(page, kind).getByText('Agent · Standby', { exact: true })).toBeVisible()
    await group(page, kind).getByText('Off', { exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(
          (command) => (window as any).__awakeCalls.filter((call: any) => call.command === command).at(-1)?.active,
          kind === 'display' ? 'set_keep_awake' : 'set_system_keep_awake',
        ),
      )
      .toBe(false)
  })
}

for (const scenario of ['long-llm', 'attention', 'idle']) {
  test(`system Agent policy is independent with display Off: ${scenario}`, async ({ page }) => {
    await mockNative(page)
    await page.goto(`/?demo=1&demoScenario=${scenario}`)
    await openDisplay(page)
    await expect(
      row(page, 'system').getByText(scenario === 'long-llm' ? 'Agent · Active' : 'Agent · Standby', { exact: true }),
    ).toBeVisible()
    await expect(group(page, 'display').getByRole('radio', { name: 'Off', exact: true })).toBeChecked()
    await group(page, 'system').getByText('Off', { exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).__awakeCalls.filter((call: any) => call.command === 'set_system_keep_awake').at(-1)?.active,
        ),
      )
      .toBe(false)
  })
}

test('system native radios retain keyboard behavior and do not change display', async ({ page }) => {
  await page.goto('/?demo=1&demoScenario=idle')
  await openDisplay(page)
  const agent = group(page, 'system').getByRole('radio', { name: 'Agent', exact: true })
  await agent.focus()
  await agent.press('ArrowLeft')
  await expect(group(page, 'system').getByRole('radio', { name: 'On', exact: true })).toBeChecked()
  await expect(group(page, 'system').locator('input:checked')).toHaveCount(1)
  await expect(group(page, 'display').getByRole('radio', { name: 'Off', exact: true })).toBeChecked()
  await expect(row(page, 'system').getByText('Desktop runtime required')).toBeVisible()
})

test('system exhausted release failure remains visible with Off; display stays Active', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agent-halo.keep-awake-mode', 'on')
    localStorage.setItem('agent-halo.system-keep-awake-mode', 'on')
    ;(window as any).__releaseAttempts = 0
    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: { active?: boolean }) => {
        if (command === 'notch_metrics') return [184, 36]
        if (command === 'set_keep_awake') return args?.active === true
        if (command !== 'set_system_keep_awake') return null
        if (!args?.active) {
          ;(window as any).__releaseAttempts += 1
          throw new Error('synthetic system release failure')
        }
        return true
      },
    }
  })
  await page.goto('/?demo=1&demoScenario=idle')
  await openDisplay(page)
  await expect(row(page, 'system').getByText('On · Active', { exact: true })).toBeVisible()
  await group(page, 'system').getByText('Off', { exact: true }).click()
  await expect(
    row(page, 'system').getByText('Unavailable · synthetic system release failure', { exact: true }),
  ).toBeVisible()
  await expect(row(page, 'display').getByText('On · Active', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__releaseAttempts)).toBe(3)
})

test('system queue serializes slow acquire then release; stale success cannot claim Active', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__systemCalls = []
    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: { active?: boolean }) => {
        if (command === 'notch_metrics') return [184, 36]
        if (command === 'set_keep_awake') return args?.active === true
        if (command !== 'set_system_keep_awake') return null
        ;(window as any).__systemCalls.push(args?.active === true)
        if (args?.active)
          return new Promise((resolve) => {
            ;(window as any).__finishAcquire = () => resolve(true)
          })
        return false
      },
    }
  })
  await page.goto('/?demo=1&demoScenario=idle')
  await openDisplay(page)
  await group(page, 'system').getByText('On', { exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishAcquire)).toBe('function')
  await group(page, 'system').getByText('Agent', { exact: true }).click()
  // The release is queued, not sent concurrently with the pending acquisition.
  expect(await page.evaluate(() => (window as any).__systemCalls)).toEqual([false, true])
  await page.evaluate(() => (window as any).__finishAcquire())
  await expect.poll(() => page.evaluate(() => (window as any).__systemCalls)).toEqual([false, true, false])
  await expect(row(page, 'system').getByText('Agent · Standby', { exact: true })).toBeVisible()
})

test('system retries transient confirmation mismatch before reporting Active', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__systemAttempts = 0
    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: { active?: boolean }) => {
        if (command === 'notch_metrics') return [184, 36]
        if (command === 'set_keep_awake') return args?.active === true
        if (command !== 'set_system_keep_awake') return null
        if (!args?.active) return false
        ;(window as any).__systemAttempts += 1
        return (window as any).__systemAttempts > 1
      },
    }
  })
  await page.goto('/?demo=1&demoScenario=idle')
  await openDisplay(page)
  await group(page, 'system').getByText('On', { exact: true }).click()
  await expect(row(page, 'system').getByText('On · Standby', { exact: true })).toBeVisible()
  await expect(row(page, 'system').getByText('On · Active', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__systemAttempts)).toBe(2)
})
