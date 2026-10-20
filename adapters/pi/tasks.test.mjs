import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTaskSnapshot } from '../../packages/protocol/src/tasks.ts'
import { createTaskObserver, loadTaskAccessor, projectTasks } from './tasks.ts'

const tick = () => new Promise((resolve) => setImmediate(resolve))
const record = (status = 'queued') => ({
  id: 'task-1',
  type: 'implementer',
  status,
  startedAt: 123,
  prompt: 'PRIVATE',
  result: 'PRIVATE',
  error: 'PRIVATE',
  description: 'PRIVATE',
  outputFile: 'PRIVATE',
  env: 'PRIVATE',
})
const snapshot = (data) => ({
  version: 2,
  id: 'snapshot-1',
  timestamp: new Date().toISOString(),
  type: 'task_snapshot',
  agentId: 'pi:main',
  agentName: 'Pi',
  conversationId: 'pi:main',
  data,
})
function bus() {
  const handlers = new Map()
  return {
    on(name, fn) {
      const set = handlers.get(name) ?? new Set()
      set.add(fn)
      handlers.set(name, set)
      return () => set.delete(fn)
    },
    emit(name, payload = { prompt: 'PRIVATE' }) {
      for (const fn of handlers.get(name) ?? []) fn(payload)
    },
    size() {
      return [...handlers.values()].reduce((sum, set) => sum + set.size, 0)
    },
  }
}

test('exact owners in same cwd/process isolate snapshots even on a shared bus; lifecycle comes from records', async () => {
  const events = bus()
  const owners = [{}, {}]
  const records = [[record()], [{ ...record('running'), id: 'task-2' }]]
  const services = new Map(owners.map((owner, i) => [owner, { listAgents: () => records[i] }]))
  const published = [[], []]
  const observers = owners.map((owner, i) => {
    const observer = createTaskObserver(
      { events },
      () => true,
      async (_ctx, data) => published[i].push(data),
      async () => (exact) => services.get(exact),
    )
    observer.start({ sessionManager: owner, cwd: '/same' })
    return observer
  })
  await tick()
  assert.equal(published[0].at(-1).tasks[0].id, 'task-1')
  assert.equal(published[1].at(-1).tasks[0].id, 'task-2')
  for (const [status, event] of [
    ['running', 'started'],
    ['stopped', 'completed'],
    ['running', 'resuming'],
    ['completed', 'resumed'],
    ['aborted', 'completed'],
    ['error', 'failed'],
  ]) {
    records[0] = [record(status)]
    events.emit(`subagents:${event}`, { status: 'completed', result: 'PRIVATE' })
    await tick()
    assert.equal(published[0].at(-1).tasks[0].status, status)
    assert.equal(published[1].length, 1)
  }
  assert.equal(JSON.stringify(published).includes('PRIVATE'), false)
  for (const observer of observers) observer.stop()
  assert.equal(events.size(), 0)
  const count = published[0].length
  events.emit('subagents:created')
  await tick()
  assert.equal(published[0].length, count)
})

test('load order finite retry, unavailable capability, late async load and shutdown invalidation', async () => {
  const events = bus()
  let service
  let release
  const output = []
  const observer = createTaskObserver(
    { events },
    () => true,
    async (_ctx, data) => output.push(data),
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  observer.start({ sessionManager: {} })
  observer.stop()
  release(() => ({ listAgents: () => [record()] }))
  await tick()
  assert.equal(output.length, 0)
  const ready = createTaskObserver(
    { events },
    () => true,
    async (_ctx, data) => output.push(data),
    async () => () => service,
  )
  ready.start({ sessionManager: {} })
  await tick()
  assert.equal(output.at(-1).availability, 'unavailable')
  service = { listAgents: () => [record()] }
  await new Promise((resolve) => setTimeout(resolve, 125))
  assert.equal(output.at(-1).availability, 'available')
  ready.stop()
  const absent = createTaskObserver(
    { events },
    () => true,
    async (_ctx, data) => output.push(data),
    async () => undefined,
  )
  absent.start({ sessionManager: {} })
  await tick()
  assert.deepEqual(output.at(-1), { availability: 'unavailable', tasks: [] })
  absent.stop()
  assert.equal(events.size(), 0)
  assert.equal(await loadTaskAccessor({ getAllTools: () => [] }), undefined)
})

test('malformed snapshot/privacy allowlist: bounds dates, scope, statuses, arrays and size', () => {
  const projected = projectTasks([
    { ...record(), startedAt: 1e100, completedAt: -1 },
    null,
    { ...record(), status: 'success' },
  ])
  assert.equal(projected.length, 1)
  assert.equal(projected[0].startedAt, null)
  assert.equal(projected[0].completedAt, null)
  assert.deepEqual(
    projectTasks([record('stopped'), record('completed')]).map((task) => task.status),
    ['stopped'],
  )
  const normalized = normalizeTaskSnapshot({
    ...snapshot({
      availability: 'available',
      tasks: Array.from({ length: 260 }, (_, i) => ({ ...record(), id: `task-${i}` })),
      prompt: 'PRIVATE',
    }),
    runtime: { secret: 'PRIVATE' },
    result: 'PRIVATE',
  })
  assert.equal(normalized.data.tasks.length, 256)
  assert.equal(normalized.data.omittedCount, 4)
  assert.equal(normalized.runtime, null)
  assert.equal(JSON.stringify(normalized).includes('PRIVATE'), false)
  for (const invalid of [
    null,
    {},
    snapshot({ tasks: {} }),
    snapshot({ availability: 'available', tasks: null }),
    { ...snapshot({ availability: 'available', tasks: [] }), conversationId: 'other' },
  ])
    assert.equal(normalizeTaskSnapshot(invalid), null)
})
