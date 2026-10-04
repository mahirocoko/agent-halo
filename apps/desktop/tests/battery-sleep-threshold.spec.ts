import { expect, test } from '@playwright/test'

test('threshold drafts save before arming, lock while On, and survive UI reload', async ({ page }) => {
  const consoleIssues: string[] = []
  page.on('pageerror', (error) => consoleIssues.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') consoleIssues.push(message.text())
  })

  // Browser-local transport fixture ONLY. Native persistence/ACL/sleep are
  // verified separately; these mocks never contact the installed Tauri app.
  await page.addInitScript(() => {
    type Status = {
      supported: boolean
      armed: boolean
      thresholdPercent: number
      error: string | null
      batteryLevel: number
      isBatteryPowered: boolean
    }
    const host = window as typeof window & {
      __TAURI_INTERNALS__: unknown
      __TAURI_EVENT_PLUGIN_INTERNALS__: unknown
      __batteryTestEmit: () => void
      __batteryTestCalls: Array<{ command: string; args: unknown }>
    }
    const storageKey = 'test-only-battery-threshold'
    let status: Status = JSON.parse(localStorage.getItem(storageKey) || 'null') || {
      supported: true,
      armed: false,
      thresholdPercent: 10,
      error: null,
      batteryLevel: 85,
      isBatteryPowered: false,
    }
    const callbacks = new Map<number, (event: unknown) => void>()
    const listeners = new Map<number, { event: string; handler: number }>()
    let nextId = 0
    host.__batteryTestCalls = []
    const emit = () => {
      for (const [id, entry] of listeners) {
        if (entry.event === 'agent-halo://battery-sleep-status') {
          callbacks.get(entry.handler)?.({ event: entry.event, id, payload: { ...status } })
        }
      }
    }
    host.__batteryTestEmit = () => {
      status = { ...status, armed: false }
      localStorage.setItem(storageKey, JSON.stringify(status))
      emit()
    }
    host.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event: string, id: number) => listeners.delete(id) }
    host.__TAURI_INTERNALS__ = {
      transformCallback: (callback: (event: unknown) => void) => {
        const id = ++nextId
        callbacks.set(id, callback)
        return id
      },
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        if (command === 'plugin:event|listen') {
          const id = ++nextId
          listeners.set(id, { event: args.event as string, handler: args.handler as number })
          return id
        }
        if (command === 'plugin:event|unlisten') return listeners.delete(args.eventId as number)
        if (command === 'notch_metrics') return [184, 36]
        if (command === 'get_battery_sleep_status') return { ...status }
        if (command === 'set_battery_sleep_threshold') {
          host.__batteryTestCalls.push({ command, args })
          if (status.armed) throw new Error('Turn monitoring Off first')
          status = { ...status, thresholdPercent: args.thresholdPercent as number }
          localStorage.setItem(storageKey, JSON.stringify(status))
          emit()
          return { ...status }
        }
        if (command === 'set_battery_sleep_armed') {
          host.__batteryTestCalls.push({ command, args })
          status = { ...status, armed: args.armed === true }
          localStorage.setItem(storageKey, JSON.stringify(status))
          emit()
          return { ...status }
        }
        if (command === 'display_state') return { displays: [], preference: null, selectedId: null, fallback: false }
        if (command.endsWith('_status')) return { installed: false, path: null }
        return null
      },
    }
  })

  await page.setViewportSize({ width: 420, height: 720 })
  const openDisplay = async () => {
    await page.getByRole('button', { name: 'Setup', exact: true }).click()
    await page.getByRole('tab', { name: 'Display', exact: true }).click()
  }
  await page.goto('/?demo=1&demoScenario=idle')
  await openDisplay()
  const input = page.getByRole('spinbutton', { name: 'Sleep threshold percentage' })
  const toggle = page.getByRole('switch', { name: 'Low-battery sleep' })
  await expect(input).toHaveValue('10')
  await expect(input).toBeEnabled()
  await expect(toggle).toBeEnabled()
  expect(consoleIssues).toEqual([]) // initial load gate

  for (const invalid of ['', '0', '101', '10.5']) {
    await input.fill(invalid)
    await expect(toggle).toBeDisabled()
    await input.press('Tab')
    await expect(input).toHaveAttribute('aria-invalid', 'true')
  }
  await input.fill('90')
  await expect(toggle).toBeDisabled() // unsaved valid draft cannot use old native threshold
  await input.press('Enter')
  await expect(page.getByText('Sleep below 90%', { exact: true })).toBeVisible()
  await expect(toggle).toBeEnabled()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(input).toBeDisabled()

  const geometry = await page.locator('.battery-sleep-controls').evaluate((controls) => {
    const label = controls.querySelector('label')!.getBoundingClientRect()
    const button = controls.querySelector('button')!.getBoundingClientRect()
    return { separate: label.right <= button.left, insideViewport: button.right <= window.innerWidth }
  })
  expect(geometry).toEqual({ separate: true, insideViewport: true })
  await page.evaluate(() => (window as typeof window & { __batteryTestEmit: () => void }).__batteryTestEmit())
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(input).toBeEnabled()
  await expect(input).toHaveValue('90')
  await page.reload()
  await openDisplay()
  await expect(input).toHaveValue('90')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(consoleIssues).toEqual([]) // after interactions and reload gate
})

test('ordinary browser demo cannot edit or arm the native threshold', async ({ page }) => {
  await page.goto('/?demo=1&demoScenario=idle')
  await page.getByRole('button', { name: 'Setup', exact: true }).click()
  await page.getByRole('tab', { name: 'Display', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Sleep threshold percentage' })).toBeDisabled()
  await expect(page.getByRole('switch', { name: 'Low-battery sleep' })).toBeDisabled()
})
