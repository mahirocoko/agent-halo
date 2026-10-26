import { expect, test } from '@playwright/test'
import type { AgentHaloEvent } from '../../../packages/protocol/src/index'
import { createInitialPresence, reducePresence } from '../../../packages/protocol/src/index'
import { hasVisibleSessionTasks } from '../src/features/session/components'
import { mergeSessionEvents, normalizeSessionEventRegistry } from '../src/features/session/event-registry'
import { buildSessionDetail, buildSessionSummaries } from '../src/features/session/selectors'

const stamp = '2026-10-01T10:00:00.000Z'
const base = (id: string) => ({
  version: 2 as const,
  id: `event-${id}`,
  timestamp: stamp,
  agentId: `pi:${id}`,
  agentName: 'Pi',
  conversationId: `pi:${id}`,
  cwd: '/work/pi-project',
  model: 'provider/model',
})
const complete = (id: string): AgentHaloEvent => ({
  ...base(id),
  type: 'turn_complete',
  data: { hookEventName: 'agent_settled', source: 'pi-sdk' },
})
const tasks = (id: string): AgentHaloEvent => ({
  ...base(id),
  id: `tasks-${id}`,
  timestamp: '2026-10-01T11:00:00.000Z',
  type: 'task_snapshot',
  data: {
    availability: 'available',
    tasks: [{ id: `task-${id}`, role: 'implementer', status: 'running', startedAt: 123, completedAt: null }],
  },
})

test('server-free: tasks cannot change completion, activity, model, identity, or create phantom sessions', () => {
  // Existing shortenPath reads only this browser home projection.
  Object.assign(globalThis, { window: { __AGENT_HALO_HOME__: '' } })
  const done = complete('one')
  const initial = reducePresence(createInitialPresence(), done)
  expect(reducePresence(initial, tasks('one'))).toBe(initial)
  let registry = mergeSessionEvents({}, [done, complete('two'), tasks('one'), tasks('ghost')])
  for (let i = 0; i < 200; i++) registry = mergeSessionEvents(registry, [{ ...tasks('one'), id: `snapshot-${i}` }])
  expect(registry['pi:one']).toHaveLength(2)
  expect(registry['pi:one'][0].type).toBe('turn_complete')
  const rows = buildSessionSummaries(registry, initial, new Date(stamp))
  expect(rows).toHaveLength(2)
  expect(rows.find((row) => row.conversationId === 'pi:one')).toMatchObject({
    status: 'done',
    lastActivityAt: stamp,
    model: 'provider/model',
  })
  expect(rows.find((row) => row.conversationId === 'pi:two')?.tasks).toBeNull()
  expect(hasVisibleSessionTasks(null)).toBe(false)
  expect(hasVisibleSessionTasks({ availability: 'available', tasks: [], omittedCount: 0 })).toBe(false)
  expect(hasVisibleSessionTasks({ availability: 'unavailable', tasks: [] })).toBe(true)
  expect(hasVisibleSessionTasks({ availability: 'available', tasks: [], omittedCount: 2 })).toBe(true)
  expect(hasVisibleSessionTasks(rows.find((row) => row.conversationId === 'pi:one')?.tasks ?? null)).toBe(true)
  expect(buildSessionDetail('pi:one', rows, registry, initial)?.events).toHaveLength(1)
  const malformed = { ...tasks('one'), data: { availability: 'available', tasks: {} } } as unknown as AgentHaloEvent
  expect(normalizeSessionEventRegistry({ 'pi:one': [done, malformed] })['pi:one']).toHaveLength(1)
})

test('Pi tasks render under their real parent and detail without waking completed sessions; SSE updates and reload stay private', async ({
  page,
}) => {
  const emptyTwo: AgentHaloEvent = {
    ...tasks('two'),
    data: { availability: 'available', tasks: [], omittedCount: 0 },
  }
  const events = [complete('one'), complete('two'), tasks('one'), emptyTwo, tasks('ghost')]
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('pi-task-test-seeded')) {
      localStorage.clear()
      sessionStorage.setItem('pi-task-test-seeded', 'true')
    }
    const handlers = new Map<string, (event: { data: string }) => void>()
    class Source {
      readyState = 1
      static CLOSED = 2
      onopen = null
      onerror = null
      addEventListener(name: string, handler: (event: { data: string }) => void) {
        handlers.set(name, handler)
      }
      close() {}
    }
    Object.assign(window, {
      EventSource: Source,
      haloTaskPush: (event: { type: string }) => handlers.get(event.type)?.({ data: JSON.stringify(event) }),
    })
  })
  await page.route('http://127.0.0.1:47621/**', (route) =>
    route.fulfill({ json: { recent: events }, headers: { 'Access-Control-Allow-Origin': '*' } }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Agent Halo', exact: true }).click()
  await page.getByRole('button', { name: 'Expand pi-project, 2 sessions' }).click()
  const row = page.locator('.session-child-row').filter({ has: page.locator('[data-session-id="pi:one"]') })
  const emptyRow = page.locator('.session-child-row').filter({ has: page.locator('[data-session-id="pi:two"]') })
  await expect(row).toHaveAttribute('data-status', 'done')
  await expect(row).toHaveClass(/has-tasks/)
  await expect(emptyRow).not.toHaveClass(/has-tasks/)
  await expect(emptyRow.getByRole('region', { name: 'Pi subagent tasks' })).toHaveCount(0)
  await expect(row.getByRole('region', { name: 'Pi subagent tasks' })).toContainText('task-one')
  await expect(row.locator('.session-tasks [data-status]')).toHaveAttribute('data-status', 'running')
  await expect(row.getByRole('region')).toContainText('Last observed')
  await expect(row.getByRole('region')).toContainText('not a live heartbeat')
  await expect(page.locator('[data-session-id="pi:ghost"]')).toHaveCount(0)
  const stopped = { ...tasks('one'), id: 'tasks-one-stopped', timestamp: '2026-10-01T12:00:00.000Z' } as AgentHaloEvent
  stopped.data = {
    availability: 'available',
    tasks: [
      {
        id: 'task-one',
        role: 'implementer',
        status: 'stopped',
        startedAt: 1e100,
        completedAt: 1234,
        prompt: 'PRIVATE',
      } as never,
    ],
    result: 'PRIVATE',
  } as never
  await page.evaluate(
    (event) => (window as unknown as { haloTaskPush: (event: unknown) => void }).haloTaskPush(event),
    stopped,
  )
  await expect(row.getByRole('region')).toContainText('stopped')
  await expect(row.getByRole('region')).toContainText('Start unavailable')
  await expect(row).toHaveAttribute('data-status', 'done')
  await row.locator('[data-session-id="pi:one"]').click()
  await expect(page.getByRole('region', { name: 'Pi subagent tasks' })).toContainText('stopped')
  await page.getByRole('button', { name: 'Back to sessions', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Pi subagent tasks' })).toContainText('stopped')
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('agent-halo.session-events'))).not.toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('agent-halo.session-events'))).not.toContain('PRIVATE')
  // Reload from persistence while the bridge hydrates its older running
  // snapshot: historical state must not regress or manufacture parent work.
  await page.reload()
  await page.getByRole('button', { name: 'Open Agent Halo', exact: true }).click()
  await page.getByRole('button', { name: 'Expand pi-project, 2 sessions' }).click()
  await expect(page.getByRole('region', { name: 'Pi subagent tasks' })).toContainText('stopped')
  await expect(page.getByRole('region', { name: 'Pi subagent tasks' })).toContainText('Last observed')
  await expect(page.locator('[data-session-id="pi:one"]').locator('..')).toHaveAttribute('data-status', 'done')
})

test('320px Pi task rows keep long identifiers, statuses, and observation text reachable without overlapping controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 500 })
  await page.addInitScript(() => {
    localStorage.clear()
    class Source {
      readyState = 1
      static CLOSED = 2
      onopen = null
      onerror = null
      addEventListener() {}
      close() {}
    }
    Object.assign(window, { EventSource: Source })
  })
  const statuses = ['queued', 'running', 'completed', 'aborted', 'stopped', 'error'] as const
  const records = statuses.map((status, index) => ({
    id: `task-${index}-${'long-task-identifier-'.repeat(5)}`,
    role: `specialist-${'long-role-'.repeat(10)}`,
    status,
    startedAt: 123,
    completedAt: status === 'running' || status === 'queued' ? null : 1234,
  }))
  const snapshot = tasks('one')
  snapshot.data = { availability: 'available', tasks: records }
  const events = [complete('one'), complete('two'), snapshot]
  await page.route('http://127.0.0.1:47621/**', (route) =>
    route.fulfill({ json: { recent: events }, headers: { 'Access-Control-Allow-Origin': '*' } }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Agent Halo', exact: true }).click()
  await page.getByRole('button', { name: 'Expand pi-project, 2 sessions' }).click()
  const parent = page.locator('.session-child-row').filter({ has: page.locator('[data-session-id="pi:one"]') })

  for (const surface of ['list', 'detail'] as const) {
    if (surface === 'detail') await parent.locator('[data-session-id="pi:one"]').click()
    const region = page.getByRole('region', { name: 'Pi subagent tasks' })
    await expect(region.locator('li')).toHaveCount(records.length)
    const owner = surface === 'list' ? parent : page.locator('.session-detail-overview-card')
    await owner.evaluate(async (node) => {
      await Promise.allSettled(
        node
          .getAnimations({ subtree: true })
          .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
          .map((animation) => animation.finished),
      )
    })
    for (const [index, record] of records.entries()) {
      const row = region.locator('li').nth(index)
      await expect(row).toContainText(record.id)
      await expect(row).toContainText(record.role)
      await expect(row).toContainText(record.status)
      await row.scrollIntoViewIfNeeded()
      expect(
        await row.evaluate((node) => {
          const tray = node.closest<HTMLElement>('.sessions-tray, .session-detail-tray')!
          const rect = node.getBoundingClientRect()
          const trayRect = tray.getBoundingClientRect()
          return (
            rect.top >= trayRect.top - 1 &&
            rect.bottom <= trayRect.bottom + 1 &&
            node.scrollWidth <= node.clientWidth + 1 &&
            [...node.querySelectorAll<HTMLElement>('span, code')].every(
              (text) => text.scrollWidth <= text.clientWidth + 1,
            )
          )
        }),
      ).toBe(true)
    }
    const observed = region.getByText(/Last observed/)
    await observed.scrollIntoViewIfNeeded()
    expect(
      await owner.evaluate((node) => {
        const region = node.querySelector<HTMLElement>('.session-tasks')!
        const observed = [...region.querySelectorAll<HTMLElement>('span')].find((span) =>
          span.textContent?.startsWith('Last observed'),
        )!
        const a = observed.getBoundingClientRect()
        return [...node.querySelectorAll<HTMLElement>('button')].every((button) => {
          const b = button.getBoundingClientRect()
          return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
        })
      }),
    ).toBe(true)
    expect(await page.locator('.halo-surface').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    expect(
      await page
        .locator(surface === 'list' ? '.sessions-tray' : '.session-detail-tray')
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true)
  }
})
