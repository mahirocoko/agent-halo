import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHalo, selfIdentity } from './index.ts'

const context = (id = 'session-1', mode = 'tui') => ({
  mode,
  cwd: '/workspace',
  sessionManager: { getSessionId: () => id },
  model: { provider: 'actual-provider', id: 'actual-model' },
})
function fixture(overrides = {}, shared = { tail: Promise.resolve() }) {
  const handlers = new Map()
  const events = []
  let tokens = 0
  const deps = {
    registry: shared,
    loadTaskAccessor: () => new Promise(() => {}),
    selfIdentity: () => ({ sourcePid: 42, sourcePpid: 2, sourceStartedAtMs: 123, sourceKind: 'piHost' }),
    readEndpoint: async () => ({ hostname: '127.0.0.1', port: 1 }),
    readIngestToken: async () => {
      tokens++
      return null
    },
    postEvent: async (_endpoint, _token, event) => {
      events.push(event)
    },
    ...overrides,
  }
  registerHalo({ on: (name, handler) => handlers.set(name, handler), events: { on: () => () => {} } }, deps)
  return {
    events,
    shared,
    tokens: () => tokens,
    fire: async (name, event = {}, ctx = context()) => handlers.get(name)?.({ type: name, ...event }, ctx),
  }
}

test('public handler order, whole-run completion once, private content excluded', async () => {
  const f = fixture()
  await f.fire('session_start', { reason: 'startup' })
  await f.fire('agent_start')
  await f.fire('agent_start')
  await f.fire('tool_execution_start', { toolName: 'read', args: { secret: 'PRIVATE' } })
  await f.fire('tool_execution_end', { toolName: 'read', result: 'PRIVATE', isError: false })
  await f.fire('agent_before_settle', { outcome: 'completed', context: 'PRIVATE' })
  await f.fire('agent_settled', { aborted: false })
  await f.fire('agent_settled', { aborted: false })
  await f.fire('session_shutdown', { reason: 'quit' })
  assert.deepEqual(
    f.events.map((e) => e.type),
    ['conversation_open', 'turn_start', 'tool_start', 'tool_end', 'turn_complete', 'conversation_close'],
  )
  assert.equal(f.events[0].agentId, 'pi:session-1')
  assert.equal(f.events[0].agentName, 'Pi')
  assert.equal(f.events[0].model, 'actual-provider/actual-model')
  assert.equal(f.events[0].runtime.sourceKind, 'piHost')
  assert.equal(f.events[0].runtime.herdr, undefined)
  assert.equal(JSON.stringify(f.events).includes('PRIVATE'), false)
})

test('non-TUI same-process children cannot claim, read token, or dispose parent', async () => {
  const f = fixture()
  await f.fire('session_start', { reason: 'startup' })
  const initialTokens = f.tokens()
  for (const mode of ['print', 'json', 'rpc']) {
    const child = context('child', mode)
    await f.fire('session_start', { reason: 'startup' }, child)
    await f.fire('agent_start', {}, child)
    await f.fire('session_shutdown', { reason: 'quit' }, child)
    const separate = fixture({}, f.shared)
    await separate.fire('session_start', { reason: 'startup' }, child)
    assert.equal(separate.tokens(), 0)
  }
  assert.equal(f.tokens(), initialTokens)
  await f.fire('agent_start')
  assert.equal(f.events.at(-1).type, 'turn_start')
})

test('foreground Pi is valid; foreign session callbacks cannot mutate its lifecycle', async () => {
  const f = fixture()
  await f.fire('session_start', { reason: 'startup' })
  await f.fire('session_shutdown', { reason: 'quit' }, context('foreign'))
  await f.fire('agent_start', {}, context('foreign'))
  await f.fire('agent_start')
  assert.equal(f.events.length, 2)
})

test('abort overrides an earlier completed outcome; errors do not complete', async () => {
  const f = fixture()
  await f.fire('session_start', { reason: 'startup' })
  await f.fire('agent_start')
  await f.fire('agent_before_settle', { outcome: 'completed' })
  await f.fire('agent_settled', { aborted: true })
  assert.equal(f.events.at(-1).data.stopReason, 'aborted_stop')
  await f.fire('agent_start')
  await f.fire('agent_before_settle', { outcome: 'error', error: 'PRIVATE' })
  await f.fire('agent_settled', { aborted: false })
  assert.equal(f.events.at(-1).data.stopReason, 'error')
  assert.equal(
    f.events.some((e) => e.type === 'turn_complete'),
    false,
  )
  assert.equal(JSON.stringify(f.events).includes('PRIVATE'), false)
})

test('reload invalidates queued token work and old callbacks cannot close replacement', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const old = fixture({ readEndpoint: () => gate })
  const pending = old.fire('session_start', { reason: 'startup' })
  await Promise.resolve()
  await old.fire('session_shutdown', { reason: 'reload' })
  const fresh = fixture({}, old.shared)
  const start = fresh.fire('session_start', { reason: 'reload' })
  release({ hostname: '127.0.0.1', port: 1 })
  await Promise.all([pending, start])
  await old.fire('session_shutdown', { reason: 'quit' })
  await old.fire('agent_start')
  assert.equal(old.tokens(), 0)
  assert.equal(old.events.length, 0)
  assert.equal(fresh.events[0].type, 'conversation_open')
})

test('missing bridge failure is harmless, bounded queue drains, shutdown has no timers', async () => {
  let calls = 0
  const f = fixture({
    postEvent: async () => {
      calls++
      throw new Error('offline')
    },
  })
  await f.fire('session_start', { reason: 'startup' })
  await f.fire('agent_start')
  await f.fire('tool_execution_start', { toolName: 'bad PRIVATE name' })
  await f.fire('session_shutdown', { reason: 'quit' })
  await f.shared.tail
  await f.fire('agent_start')
  assert.equal(calls, 4)
})

test('concurrent tool events stay ordered and queue overflow is bounded', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const f = fixture({ readEndpoint: () => gate })
  const start = f.fire('session_start', { reason: 'startup' })
  const run = f.fire('agent_start')
  const tools = Array.from({ length: 100 }, () => f.fire('tool_execution_start', { toolName: 'PRIVATE bad name' }))
  release({ hostname: '127.0.0.1', port: 1 })
  await Promise.all([start, run, ...tools])
  assert.equal(f.events.length, 64)
  assert.deepEqual(
    f.events.slice(0, 2).map((e) => e.type),
    ['conversation_open', 'turn_start'],
  )
  assert.equal(f.events.at(-1).data.toolName, 'unknown')
  await f.fire('session_shutdown', { reason: 'quit' })
  assert.equal(f.events.at(-1).type, 'conversation_close')
})

test('self identity uses this process, not inherited parent identity or argv', () => {
  const identity = selfIdentity()
  assert.equal(identity.sourcePid, process.pid)
  assert.equal(identity.sourcePpid, process.ppid)
  assert.ok(identity.sourceStartedAtMs > 0)
  assert.equal(identity.sourceKind, 'piHost')
  assert.equal('argv' in identity, false)
})
