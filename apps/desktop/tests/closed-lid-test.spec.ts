import { expect, type Page, test } from '@playwright/test'

type ClosedLidMockPhase = 'ready' | 'starting' | 'active' | 'restoring' | 'unavailable'

interface IClosedLidMock {
  phase: ClosedLidMockPhase
  statusCalls: number
  startCalls: number
  stopCalls: number
  stopArgs: unknown[]
  batterySupported: boolean
  batteryArmed: boolean
  deferNextStatus: boolean
  deferNextStart: boolean
  deferNextStop: boolean
  rejectNextStart: string | null
  rejectNextStop: string | null
  rejectNextStatus: string | null
  resolveStatus: ((phase: ClosedLidMockPhase) => void) | null
  resolveStart: ((phase: ClosedLidMockPhase) => void) | null
  rejectStart: ((message: string) => void) | null
  resolveStop: ((phase: ClosedLidMockPhase) => void) | null
  rejectStop: ((message: string) => void) | null
  setPhase: (phase: ClosedLidMockPhase) => void
}

type MockHost = typeof window & {
  __TAURI_INTERNALS__: unknown
  __TAURI_EVENT_PLUGIN_INTERNALS__: unknown
  __closedLidMock: IClosedLidMock
}

const openDisplay = async (page: Page) => {
  await page.getByRole('button', { name: 'Setup', exact: true }).click()
  await page.getByRole('tab', { name: 'Display', exact: true }).click()
}

const installClosedLidMock = async (
  page: Page,
  initial: { phase?: ClosedLidMockPhase; batterySupported?: boolean; deferInitialStatus?: boolean } = {},
) => {
  await page.addInitScript(
    ({ phase, batterySupported, deferInitialStatus }) => {
      const host = window as MockHost
      const listeners = new Map<number, { event: string; handler: number }>()
      const callbacks = new Map<number, (event: unknown) => void>()
      let nextId = 0

      const mock: IClosedLidMock = {
        phase,
        statusCalls: 0,
        startCalls: 0,
        stopCalls: 0,
        stopArgs: [],
        batterySupported,
        batteryArmed: false,
        deferNextStatus: deferInitialStatus,
        deferNextStart: false,
        deferNextStop: false,
        rejectNextStart: null,
        rejectNextStop: null,
        rejectNextStatus: null,
        resolveStatus: null,
        resolveStart: null,
        rejectStart: null,
        resolveStop: null,
        rejectStop: null,
        setPhase: (next) => {
          mock.phase = next
        },
      }
      host.__closedLidMock = mock

      host.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (_event: string, id: number) => listeners.delete(id),
      }

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
          if (command === 'get_battery_sleep_status') {
            return {
              supported: mock.batterySupported,
              armed: mock.batteryArmed,
              thresholdPercent: 10,
              error: null,
              batteryLevel: 19,
              isBatteryPowered: true,
            }
          }
          if (command === 'set_battery_sleep_armed') {
            mock.batteryArmed = args.armed === true
            return {
              supported: mock.batterySupported,
              armed: mock.batteryArmed,
              thresholdPercent: 10,
              error: null,
              batteryLevel: 19,
              isBatteryPowered: true,
            }
          }
          if (command === 'get_closed_lid_test_status') {
            mock.statusCalls += 1
            if (mock.rejectNextStatus) {
              const msg = mock.rejectNextStatus
              mock.rejectNextStatus = null
              throw new Error(msg)
            }
            if (mock.deferNextStatus) {
              mock.deferNextStatus = false
              return await new Promise<ClosedLidMockPhase>((resolve) => {
                mock.resolveStatus = (nextPhase) => {
                  mock.resolveStatus = null
                  mock.phase = nextPhase
                  resolve(nextPhase)
                }
              })
            }
            return mock.phase
          }
          if (command === 'start_closed_lid_test') {
            mock.startCalls += 1
            if (mock.rejectNextStart) {
              const msg = mock.rejectNextStart
              mock.rejectNextStart = null
              throw new Error(msg)
            }
            if (mock.deferNextStart) {
              mock.deferNextStart = false
              return await new Promise<ClosedLidMockPhase>((resolve, reject) => {
                mock.resolveStart = (nextPhase) => {
                  mock.resolveStart = null
                  mock.rejectStart = null
                  mock.phase = nextPhase
                  resolve(nextPhase)
                }
                mock.rejectStart = (message) => {
                  mock.resolveStart = null
                  mock.rejectStart = null
                  reject(new Error(message))
                }
              })
            }
            mock.phase = 'starting'
            return mock.phase
          }
          if (command === 'stop_closed_lid_test') {
            mock.stopCalls += 1
            mock.stopArgs.push(args)
            if (mock.rejectNextStop) {
              const msg = mock.rejectNextStop
              mock.rejectNextStop = null
              throw new Error(msg)
            }
            if (mock.deferNextStop) {
              mock.deferNextStop = false
              return await new Promise<ClosedLidMockPhase>((resolve, reject) => {
                mock.resolveStop = (nextPhase) => {
                  mock.resolveStop = null
                  mock.rejectStop = null
                  mock.phase = nextPhase
                  resolve(nextPhase)
                }
                mock.rejectStop = (message) => {
                  mock.resolveStop = null
                  mock.rejectStop = null
                  reject(new Error(message))
                }
              })
            }
            mock.phase = 'restoring'
            return mock.phase
          }
          return null
        },
      }
    },
    {
      phase: initial.phase ?? 'ready',
      batterySupported: initial.batterySupported ?? true,
      deferInitialStatus: initial.deferInitialStatus ?? false,
    },
  )
}

test('browser demo disables closed-lid switch and omits experimental copy without native commands', async ({
  page,
}) => {
  await page.goto('/?demo=1&demoScenario=idle')
  await openDisplay(page)

  const row = page.getByTestId('closed-lid-test-row')
  await expect(row).toBeVisible()
  await expect(row.getByText('Keep awake with lid closed', { exact: true })).toBeVisible()
  await expect(row.getByRole('status')).toHaveText('Desktop runtime required')
  await expect(row.locator('.setup-detail')).toHaveCount(1)
  await expect(row.getByText(/experimental|start test/i)).toHaveCount(0)

  const lidSwitch = row.getByRole('switch', { name: 'Keep awake with lid closed' })
  await expect(lidSwitch).toBeDisabled()
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'false')
  await expect(lidSwitch).toHaveText('Off')
})

test('initial pending and unsupported battery states stay safe and disabled without native side effects', async ({
  page,
}) => {
  const consoleIssues: string[] = []
  page.on('pageerror', (error) => consoleIssues.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') consoleIssues.push(message.text())
  })

  await installClosedLidMock(page, { phase: 'ready', batterySupported: false, deferInitialStatus: true })
  await page.goto('/?demo=1&demoScenario=idle')
  await openDisplay(page)

  const row = page.getByTestId('closed-lid-test-row')
  const lidSwitch = row.getByRole('switch', { name: 'Keep awake with lid closed' })

  await expect(row.getByRole('status')).toHaveText('Checking status…')
  await expect(lidSwitch).toBeDisabled()
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'false')
  await expect(lidSwitch).toHaveText('…')

  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.resolveStatus?.('ready')
  })

  await expect(row.getByRole('status')).toHaveText('MacBook battery unavailable')
  await expect(lidSwitch).toBeDisabled()
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'false')
  await expect(lidSwitch).toHaveText('Off')

  expect(
    await page.evaluate(() => {
      const mock = (window as MockHost).__closedLidMock
      return { statusCalls: mock.statusCalls, startCalls: mock.startCalls, stopCalls: mock.stopCalls }
    }),
  ).toEqual({ statusCalls: 1, startCalls: 0, stopCalls: 0 })
  expect(consoleIssues).toEqual([])
})

test('closed-lid switch coexists with armed Low-battery sleep and handles stops and remount', async ({ page }) => {
  const consoleIssues: string[] = []
  page.on('pageerror', (error) => consoleIssues.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') consoleIssues.push(message.text())
  })

  await installClosedLidMock(page)
  await page.goto('/?demo=1&demoScenario=idle')
  await openDisplay(page)

  const row = page.getByTestId('closed-lid-test-row')
  const lidSwitch = row.getByRole('switch', { name: 'Keep awake with lid closed' })
  await expect(row.getByRole('status')).toHaveText('On battery only')
  await expect(lidSwitch).toBeEnabled()
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'false')
  await expect(lidSwitch).toHaveText('Off')

  // Never calls start or stop on mount
  expect(
    await page.evaluate(() => {
      const mock = (window as MockHost).__closedLidMock
      return { statusCalls: mock.statusCalls, startCalls: mock.startCalls, stopCalls: mock.stopCalls }
    }),
  ).toEqual({ statusCalls: 1, startCalls: 0, stopCalls: 0 })

  // Arming above the threshold does not block closed-lid keep-awake.
  const lowBatterySwitch = page.getByRole('switch', { name: 'Low-battery sleep' })
  await lowBatterySwitch.click()
  await expect(lowBatterySwitch).toHaveAttribute('aria-checked', 'true')
  await expect(row.getByRole('status')).toHaveText('On battery only')
  await expect(lidSwitch).toBeEnabled()

  const collapsedHalo = page.getByRole('button', { name: 'Open Agent Halo', exact: true })
  const clickOnAndWaitForCollapse = async (startCalls: number) => {
    await page.evaluate(() => {
      ;(window as MockHost).__closedLidMock.deferNextStart = true
    })
    await lidSwitch.click()
    // The panel is gone before native authorization returns, but start still reached native once.
    await expect(collapsedHalo).toHaveAttribute('aria-expanded', 'false')
    await expect(row).toHaveCount(0)
    expect(
      await page.evaluate(() => {
        const mock = (window as MockHost).__closedLidMock
        return { startCalls: mock.startCalls, awaitingApproval: mock.resolveStart !== null }
      }),
    ).toEqual({ startCalls, awaitingApproval: true })
  }
  const reopenDisplay = async () => {
    await collapsedHalo.press('Enter')
    await openDisplay(page)
  }

  // Native rejection survives the collapse and is visible on reopen.
  await clickOnAndWaitForCollapse(1)
  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.rejectStart?.('Unplug your MacBook first')
  })
  await reopenDisplay()
  await expect(row.getByRole('status')).toHaveText('Unplug your MacBook first')
  await expect(lidSwitch).toBeEnabled()
  await expect(lidSwitch).toHaveText('Off')

  // Native cancellation returns Ready without reusing the earlier error.
  await clickOnAndWaitForCollapse(2)
  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.resolveStart?.('ready')
  })
  await reopenDisplay()
  await expect(row.getByRole('status')).toHaveText('On battery only')
  await expect(lidSwitch).toHaveText('Off')

  // Reopening during authorization neither starts a second request nor shows optimistic On.
  await clickOnAndWaitForCollapse(3)
  await reopenDisplay()
  await expect(row.getByRole('status')).toHaveText('Enabling…')
  await expect(lidSwitch).toBeDisabled()
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'false')
  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.resolveStart?.('active')
  })
  await expect(row.getByRole('status')).toHaveText('On battery only')
  await expect(lidSwitch).toBeEnabled()
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'true')
  await expect(lidSwitch).toHaveText('On')
  await expect(lowBatterySwitch).toHaveAttribute('aria-checked', 'true')

  // Clicking Off invokes stop_closed_lid_test with no args; keeps checked while pending & restoring until ready
  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.deferNextStop = true
  })
  await lidSwitch.click()
  await expect(lidSwitch).toBeDisabled()
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'true')
  await expect(lidSwitch).toHaveText('…')
  await expect(row.getByRole('status')).toHaveText('Restoring sleep settings…')

  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.resolveStop?.('restoring')
  })
  await expect(lidSwitch).toBeDisabled()
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'true')
  await expect(row.getByRole('status')).toHaveText('Restoring sleep settings…')

  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.setPhase('ready')
  })
  await expect(row.getByRole('status')).toHaveText('On battery only', { timeout: 5_000 })
  await expect(lidSwitch).toBeEnabled()
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'false')
  await expect(lidSwitch).toHaveText('Off')

  expect(
    await page.evaluate(() => {
      const mock = (window as MockHost).__closedLidMock
      return { stopCalls: mock.stopCalls, stopArgs: mock.stopArgs }
    }),
  ).toEqual({ stopCalls: 1, stopArgs: [{}] })

  // If native is still Starting after the response, reopen and follow native status.
  await clickOnAndWaitForCollapse(4)
  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.resolveStart?.('starting')
  })
  await reopenDisplay()
  await expect(row.getByRole('status')).toHaveText('Enabling…')
  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.setPhase('active')
  })
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 })

  // An external stop, such as connecting power, also restores the switch without a click.
  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.setPhase('restoring')
  })
  await expect(row.getByRole('status')).toHaveText('Restoring sleep settings…', { timeout: 5_000 })
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'true')
  await expect(lidSwitch).toBeDisabled()
  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.setPhase('ready')
  })
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 5_000 })
  await expect(lidSwitch).toBeEnabled()

  // Remount while restoring indicates status explicitly and stays checked conservatively until ready
  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.setPhase('restoring')
  })
  await page.getByRole('tab', { name: 'Connection', exact: true }).click()
  await page.getByRole('tab', { name: 'Display', exact: true }).click()
  await expect(row.getByRole('status')).toHaveText('Restoring sleep settings…')
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'true')
  await expect(lidSwitch).toBeDisabled()
  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.setPhase('ready')
  })
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 5_000 })
  await expect(lidSwitch).toBeEnabled()

  // Unmount during deferred status fetch + remount shows fresh native phase without stale overwrite
  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.deferNextStatus = true
  })
  await page.getByRole('tab', { name: 'Connection', exact: true }).click()
  await page.getByRole('tab', { name: 'Display', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => typeof (window as MockHost).__closedLidMock.resolveStatus))
    .toBe('function')

  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await page.evaluate(() => {
    const mock = (window as MockHost).__closedLidMock
    mock.resolveStatus?.('active')
    mock.setPhase('unavailable')
  })
  await openDisplay(page)
  await expect(row.getByRole('status')).toHaveText('Unavailable')
  await expect(lidSwitch).toBeDisabled()
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'false')

  // Status rejection on remount displays error cleanly with disabled switch
  await page.evaluate(() => {
    ;(window as MockHost).__closedLidMock.rejectNextStatus = 'Power assertion bridge unavailable'
  })
  await page.getByRole('tab', { name: 'Connection', exact: true }).click()
  await page.getByRole('tab', { name: 'Display', exact: true }).click()
  await expect(row.getByRole('status')).toHaveText('Power assertion bridge unavailable')
  await expect(lidSwitch).toBeDisabled()
  await expect(lidSwitch).toHaveAttribute('aria-checked', 'false')

  expect(consoleIssues).toEqual([])
})
