import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { AgentHaloEvent, IAgentHaloEventRuntime } from '../../packages/protocol/src/index.ts'
// Shared source-owner transport; this private package is not a standalone tarball.
import { postEvent, readEndpoint, readIngestToken } from '../shared/agent-halo-hook-utils.mjs'
import { createTaskObserver, loadTaskAccessor } from './tasks.ts'

export const selfIdentity = (): IAgentHaloEventRuntime | null => {
  try {
    const start = execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], {
      encoding: 'utf8',
      timeout: 750,
    }).trim()
    const sourceStartedAtMs = Date.parse(start)
    return Number.isFinite(sourceStartedAtMs) && sourceStartedAtMs > 0
      ? { sourcePid: process.pid, sourcePpid: process.ppid, sourceStartedAtMs, sourceKind: 'piHost' }
      : null
  } catch {
    return null
  }
}

type Registry = { owner?: object; tail: Promise<void> }
const key = Symbol.for('agent-halo.pi.tui-owner.v1')
const globals = globalThis as typeof globalThis & { [key]?: Registry }
const registry = (globals[key] ??= { tail: Promise.resolve() })
const defaults = { postEvent, readEndpoint, readIngestToken, selfIdentity, registry, loadTaskAccessor }

export function registerHalo(pi: ExtensionAPI, deps = defaults) {
  const owner = {}
  let disposed = false
  let sessionId: string | undefined
  let runtime: IAgentHaloEventRuntime | null = null
  let running = false
  let outcome: 'completed' | 'aborted' | 'error' | undefined
  let pending = 0
  let epoch = 0
  const owns = (ctx: ExtensionContext) =>
    !disposed && ctx.mode === 'tui' && deps.registry.owner === owner && sessionId === ctx.sessionManager.getSessionId()

  const emit = (ctx: ExtensionContext, payload: Pick<AgentHaloEvent, 'type' | 'data'>) => {
    if (pending >= 64) return Promise.resolve()
    const generation = epoch
    const event = {
      version: 2,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      agentId: `pi:${sessionId}`,
      agentName: 'Pi',
      conversationId: `pi:${sessionId}`,
      cwd: ctx.cwd,
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
      permissionMode: null,
      runtime,
      ...payload,
      ...(payload.type === 'task_snapshot' ? { runtime: null, model: null } : {}),
    }
    pending++
    const work = deps.registry.tail
      .then(async () => {
        if (deps.registry.owner !== owner || epoch !== generation) return
        const endpoint = await deps.readEndpoint()
        if (deps.registry.owner !== owner || epoch !== generation) return
        const token = await deps.readIngestToken()
        if (deps.registry.owner !== owner || epoch !== generation) return
        await deps.postEvent(endpoint, token, event)
      })
      .catch(() => {})
      .finally(() => {
        pending--
      })
    deps.registry.tail = work
    return work
  }

  const tasks = createTaskObserver(
    pi,
    owns,
    (ctx, data) => emit(ctx, { type: 'task_snapshot', data }),
    () => deps.loadTaskAccessor(pi),
  )

  pi.on('session_start', (event, ctx) => {
    if (disposed || ctx.mode !== 'tui') return
    const id = ctx.sessionManager.getSessionId()
    if (!id) return
    epoch++
    sessionId = id
    deps.registry.owner = owner
    runtime = deps.selfIdentity()
    running = false
    outcome = undefined
    const opened = emit(ctx, { type: 'conversation_open', data: { reason: event.reason } })
    tasks.start(ctx)
    return opened
  })
  pi.on('agent_start', (_event, ctx) => {
    if (!owns(ctx) || running) return
    running = true
    outcome = undefined
    return emit(ctx, { type: 'turn_start', data: { inputCount: 1 } })
  })
  pi.on('agent_before_settle', (event, ctx) => {
    if (owns(ctx) && running) outcome = event.outcome
  })
  pi.on('agent_settled', (event, ctx) => {
    if (!owns(ctx) || !running) return
    running = false
    if (event.aborted || outcome === 'aborted') {
      return emit(ctx, {
        type: 'llm_end',
        data: {
          model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : 'unknown',
          stopReason: 'aborted_stop',
          durationMs: null,
          usage: null,
        },
      })
    }
    if (outcome === 'error') {
      return emit(ctx, {
        type: 'llm_end',
        data: {
          model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : 'unknown',
          stopReason: 'error',
          durationMs: null,
          usage: null,
          error: { message: 'Pi run failed', errorType: 'llm_error', retryable: null },
        },
      })
    }
    if (outcome === 'completed')
      return emit(ctx, {
        type: 'turn_complete',
        data: { hookEventName: 'agent_settled', source: 'pi-sdk' },
      })
  })
  const bounded = (name: string) => (/^[a-zA-Z0-9_.:/-]{1,96}$/.test(name) ? name : 'unknown')
  pi.on('tool_execution_start', (event, ctx) => {
    if (!owns(ctx) || !running) return
    return emit(ctx, {
      type: 'tool_start',
      data: {
        toolName: bounded(event.toolName),
        toolCallId: null,
        argKeys: [],
      },
    })
  })
  pi.on('tool_execution_end', (event, ctx) => {
    if (!owns(ctx) || !running) return
    return emit(ctx, {
      type: 'tool_end',
      data: {
        toolName: bounded(event.toolName),
        toolCallId: null,
        status: event.isError ? 'error' : 'success',
        outputLength: null,
      },
    })
  })
  pi.on('session_shutdown', async (event, ctx) => {
    if (!owns(ctx)) return
    tasks.stop()
    disposed = true
    running = false
    // Reload tears down extensions, not the conversation. Never enqueue a late close.
    if (event.reason === 'reload') {
      epoch++
      return
    }
    await emit(ctx, {
      type: 'conversation_close',
      data: {
        reason: event.reason,
        durationMs: null,
        messageCount: null,
        toolCallCount: null,
      },
    })
  })
}

export default function halo(pi: ExtensionAPI) {
  registerHalo(pi)
}
