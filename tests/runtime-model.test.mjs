import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLocalServiceOwnerTargets,
  buildRuntimeLivenessTargets,
  buildRuntimeSessionViews,
  buildRuntimeUsageTargets,
  isTerminalRuntimeStatus,
  localServiceOwnerLabel,
  reconcileEndedRuntimeSessions,
  runtimeHostLabel,
  runtimeTargetKey,
  selectRuntimeSamplingTargets,
} from '../apps/desktop/src/features/runtime/model.ts'

const session = (id, overrides = {}) => ({
  conversationId: `pi:${id}`,
  project: 'agent-halo',
  workspace: 'agent-halo',
  workspacePath: '/work/agent-halo',
  status: 'working',
  lastActivityAt: '2026-10-01T10:00:00Z',
  herdrTarget: null,
  ...overrides,
})
const runtime = (pid = 1234, start = 100_000) => ({
  sourceKind: 'piHost', sourcePid: pid, sourcePpid: 100, sourceStartedAtMs: start,
})
const source = (sessions, runtimes) => ({
  sessions,
  registry: Object.fromEntries(sessions.map((row, index) => [row.conversationId, [{
    id: `event-${index}`, cwd: '/work/agent-halo', runtime: runtimes[index],
  }]])),
})

test('two Pi Main sessions in one cwd retain distinct trusted host identities', () => {
  const input = source([session('one'), session('two')], [runtime(), runtime(5678, 200_000)])
  const targets = buildRuntimeUsageTargets(input)
  assert.equal(targets.length, 2)
  assert.equal(new Set(targets.map(runtimeTargetKey)).size, 2)
  assert.deepEqual(targets.map((target) => target.sourceKind), ['piHost', 'piHost'])
  assert.ok(targets.every((target) => target.mappingStatus === 'exact'))
  assert.equal(buildRuntimeLivenessTargets(input).length, 2)
  assert.equal(buildLocalServiceOwnerTargets(input).length, 2)
})

test('shared Pi host is sampled once but liveness retains both session identities', () => {
  const input = source([
    session('old', { status: 'done', lastActivityAt: '2026-09-01T10:00:00Z' }),
    session('new'),
  ], [runtime(), runtime()])
  const targets = buildRuntimeUsageTargets(input)
  assert.equal(targets.length, 1)
  assert.equal(targets[0].mappingStatus, 'sharedProcess')
  assert.equal(targets[0].relatedConversationCount, 2)
  const owners = buildLocalServiceOwnerTargets(input)
  assert.equal(owners.length, 1)
  assert.equal(owners[0].sourceKind, 'piHost')
  assert.equal(owners[0].relatedConversationCount, 2)
  assert.equal(localServiceOwnerLabel({ ...owners[0], herdrPaneId: 'w1:p1' }),
    'Started by Pi · shared host (session unknown)')
  input.sessions[0].status = 'attention'
  assert.equal(buildRuntimeLivenessTargets(input).length, 2)
})

test('same-session PID reuse rejects stale snapshots and preserves the replacement identity', () => {
  const old = buildRuntimeUsageTargets(source([session('one')], [runtime()]))[0]
  const replacement = buildRuntimeUsageTargets(source([session('one')], [runtime(1234, 300_000)]))[0]
  const ended = new Map([[runtimeTargetKey(old), 1]])
  assert.notEqual(runtimeTargetKey(old), runtimeTargetKey(replacement))
  assert.deepEqual(selectRuntimeSamplingTargets([old, replacement], ended), [replacement])
  const snapshot = {
    conversationId: 'pi:one', processId: 1234,
    targetSourceStartedAtMs: old.sourceStartedAtMs, processStartTimeMs: old.sourceStartedAtMs,
    sampledAtMs: 400_000, cwd: '/work/agent-halo', status: 'ok', error: null,
    host: { physicalFootprintBytes: 100, residentSizeBytes: 100, cpuPercent: 0 },
    children: { physicalFootprintBytes: 0, residentSizeBytes: 0, cpuPercent: 0, processCount: 0, topProcesses: [] },
  }
  const [stale] = buildRuntimeSessionViews([replacement], [snapshot])
  assert.equal(stale.snapshot, null)
  assert.equal(stale.pressure, 'unavailable')
  const fresh = {
    ...snapshot, targetSourceStartedAtMs: replacement.sourceStartedAtMs,
    processStartTimeMs: replacement.sourceStartedAtMs,
  }
  const [accepted] = buildRuntimeSessionViews([replacement], [fresh])
  assert.equal(accepted.snapshot, fresh)
  assert.equal(accepted.pressure, 'normal')
  // Even a response labelled for the new target cannot reuse old native process metrics.
  assert.equal(buildRuntimeSessionViews([replacement], [{
    ...fresh, processStartTimeMs: old.sourceStartedAtMs,
  }])[0].snapshot, null)
})

test('terminal reconciliation downgrades only the ended conversation without claiming success', () => {
  assert.equal(isTerminalRuntimeStatus('pidReused'), true)
  assert.equal(isTerminalRuntimeStatus('missing'), true)
  assert.equal(isTerminalRuntimeStatus('identityMismatch'), false)
  assert.deepEqual(reconcileEndedRuntimeSessions([session('old'), session('new')], new Set(['pi:old']))
    .map((row) => row.status), ['inactive', 'working'])
})

test('incomplete or non-host Pi identities fail closed without cwd-based fallback', () => {
  for (const invalid of [null, { ...runtime(), sourcePid: undefined }, { ...runtime(), sourcePid: 1 }, { ...runtime(), sourcePid: 1.5 },
    { ...runtime(), sourceStartedAtMs: undefined }, { ...runtime(), sourceStartedAtMs: 0 },
    { ...runtime(), sourceStartedAtMs: NaN }, { ...runtime(), sourceStartedAtMs: Infinity },
    { ...runtime(), sourceStartedAtMs: -1 }, { ...runtime(), sourceKind: 'hookRelay' }]) {
    const input = source([session('one')], [invalid])
    assert.deepEqual(buildRuntimeUsageTargets(input), [])
    assert.deepEqual(buildRuntimeLivenessTargets(input), [])
    assert.deepEqual(buildLocalServiceOwnerTargets(input), [])
  }
  const noCwd = source([session('one', { workspacePath: null })], [runtime()])
  noCwd.registry['pi:one'][0].cwd = null
  assert.deepEqual(buildRuntimeUsageTargets(noCwd), [])
  assert.deepEqual(buildRuntimeLivenessTargets(noCwd), [])
  // Services relies on exact ancestry/start, not cwd, as before.
  assert.equal(buildLocalServiceOwnerTargets(noCwd).length, 1)
})

test('provider labels preserve known kinds and make legacy/unknown attribution explicit', () => {
  assert.deepEqual(['lettaHost', 'agyHost', 'cursorHost', 'codexHost', 'piHost'].map(runtimeHostLabel),
    ['Letta', 'AGY', 'Cursor', 'Codex', 'Pi'])
  assert.equal(runtimeHostLabel(undefined), 'Unknown agent')
  assert.equal(runtimeHostLabel('futureHost'), 'Unknown agent')
  assert.equal(localServiceOwnerLabel(null), null)
  assert.equal(localServiceOwnerLabel({ project: 'agent-halo', herdrPaneId: null }),
    'Started by Unknown agent · agent-halo')
  assert.equal(localServiceOwnerLabel({ sourceKind: 'piHost', project: 'agent-halo', herdrPaneId: null }),
    'Started by Pi · agent-halo')
})
