import { expect, test } from '@playwright/test'

test('awake mode matrix and legacy migration fail closed', async ({ page }) => {
  await page.goto('/?demo=1&demoScenario=idle')
  const result = await page.evaluate(async () => {
    const { readKeepAwakeMode, shouldKeepDisplayAwake } = await import('/src/features/keep-awake/preferences.ts')
    const key = 'agent-halo.keep-awake-mode'
    localStorage.removeItem(key)
    localStorage.removeItem('agent-halo.keep-awake-while-working')
    const fresh = readKeepAwakeMode()
    localStorage.removeItem(key)
    localStorage.setItem('agent-halo.keep-awake-while-working', 'true')
    const migrated = readKeepAwakeMode()
    const persisted = localStorage.getItem(key)
    localStorage.setItem(key, 'invalid')
    const invalid = readKeepAwakeMode()
    localStorage.setItem(key, 'off')
    const explicitOff = readKeepAwakeMode()
    return {
      fresh,
      migrated,
      persisted,
      invalid,
      explicitOff,
      matrix: ['on', 'agent', 'off'].map((mode) => [
        shouldKeepDisplayAwake(mode, false),
        shouldKeepDisplayAwake(mode, true),
      ]),
    }
  })
  expect(result).toEqual({
    fresh: 'off',
    migrated: 'agent',
    persisted: 'agent',
    invalid: 'off',
    explicitOff: 'off',
    matrix: [
      [true, true],
      [false, true],
      [false, false],
    ],
  })
})

test('On holds even when idle; Agent releases; mode survives panel remount and reload', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: boolean[] = []
    ;(window as any).__awakeCalls = calls
    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: { active?: boolean }) => {
        if (command === 'notch_metrics') return [184, 36]
        if (command !== 'set_keep_awake') return null
        calls.push(args?.active === true)
        return args?.active === true
      },
    }
  })
  await page.goto('/?demo=1&demoScenario=idle')
  await page.getByRole('button', { name: 'Setup' }).click()
  await page.getByRole('tab', { name: 'Display' }).click()
  const control = page.getByRole('radiogroup', { name: 'Keep display awake mode' })
  await control.getByText('On', { exact: true }).click()
  await expect(page.getByText('On · Active', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__awakeCalls.at(-1))).toBe(true)
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.getByRole('button', { name: 'Setup' }).click()
  await page.getByRole('tab', { name: 'Display' }).click()
  await expect(control.getByRole('radio', { name: 'On', exact: true })).toBeChecked()
  await page.reload()
  await page.getByRole('button', { name: 'Setup' }).click()
  await page.getByRole('tab', { name: 'Display' }).click()
  await expect(control.getByRole('radio', { name: 'On', exact: true })).toBeChecked()
  await expect(page.getByText('On · Active', { exact: true })).toBeVisible()
  await control.getByText('Agent', { exact: true }).click()
  await expect(page.getByText('Agent · Standby', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__awakeCalls.at(-1))).toBe(false)
  await control.getByText('On', { exact: true }).click()
  await expect(page.getByText('On · Active', { exact: true })).toBeVisible()
  await control.getByText('Off', { exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__awakeCalls.at(-1))).toBe(false)
})

test('Off releases during active agent work', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agent-halo.keep-awake-mode', 'agent')
    ;(window as any).__awakeCalls = []
    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: { active?: boolean }) => {
        if (command === 'notch_metrics') return [184, 36]
        if (command !== 'set_keep_awake') return null
        ;(window as any).__awakeCalls.push(args?.active === true)
        return args?.active === true
      },
    }
  })
  await page.goto('/?demo=1&demoScenario=long-llm')
  await page.getByRole('button', { name: 'Setup' }).click()
  await page.getByRole('tab', { name: 'Display' }).click()
  await expect(page.getByText('Agent · Active', { exact: true })).toBeVisible()
  const control = page.getByRole('radiogroup', { name: 'Keep display awake mode' })
  await control.getByText('Off', { exact: true }).click()
  await expect(control.getByRole('radio', { name: 'Off', exact: true })).toBeChecked()
  await expect.poll(() => page.evaluate(() => (window as any).__awakeCalls.at(-1))).toBe(false)
})

test('Off does not hide an exhausted native release failure', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agent-halo.keep-awake-mode', 'on')
    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: { active?: boolean }) => {
        if (command === 'notch_metrics') return [184, 36]
        if (command !== 'set_keep_awake') return null
        if (args?.active !== true) throw new Error('synthetic display assertion release failure')
        return true
      },
    }
  })
  await page.goto('/?demo=1&demoScenario=idle')
  await page.getByRole('button', { name: 'Setup' }).click()
  await page.getByRole('tab', { name: 'Display' }).click()
  await expect(page.getByText('On · Active', { exact: true })).toBeVisible()
  await page.getByRole('radiogroup', { name: 'Keep display awake mode' }).getByText('Off', { exact: true }).click()
  await expect(
    page.getByText('Unavailable · synthetic display assertion release failure', { exact: true }),
  ).toBeVisible()
})

test('segmented native radios support trusted arrow keys and one selected mode', async ({ page }) => {
  await page.goto('/?demo=1&demoScenario=idle')
  await page.getByRole('button', { name: 'Setup' }).click()
  await page.getByRole('tab', { name: 'Display' }).click()
  const group = page.getByRole('radiogroup', { name: 'Keep display awake mode' })
  const off = group.getByRole('radio', { name: 'Off', exact: true })
  const agent = group.getByRole('radio', { name: 'Agent', exact: true })
  await off.focus()
  await off.press('ArrowLeft')
  await expect(agent).toBeChecked()
  await expect(agent).toBeFocused()
  await agent.press('ArrowLeft')
  const on = group.getByRole('radio', { name: 'On', exact: true })
  await expect(on).toBeChecked()
  await expect(group.locator('input:checked')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('agent-halo.keep-awake-mode'))).toBe('on')
})
