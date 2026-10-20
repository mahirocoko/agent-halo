import { createRequire } from 'node:module'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { IAgentHaloTaskSnapshotEvent } from '../../packages/protocol/src/index.ts'
import { projectTaskRecords } from '../../packages/protocol/src/tasks.ts'

interface IService {
  listAgents(): unknown[]
}
type Accessor = (owner: object) => IService | undefined

// Use public registered-tool provenance to resolve the already loaded native
// package when optional peers have separate install roots. No settings, cwd,
// hardcoded sibling paths, or process-global service lookup.
export const loadTaskAccessor = async (pi: Pick<ExtensionAPI, 'getAllTools'>): Promise<Accessor | undefined> => {
  const name = '@gotgenes/pi-subagents'
  const sources = pi
    .getAllTools()
    .filter((tool) => tool.name === 'subagent')
    .map((tool) => tool.sourceInfo.path)
  for (const source of sources) {
    if (!isAbsolute(source)) continue
    try {
      const entry = createRequire(source).resolve(name)
      const module = await import(pathToFileURL(entry).href)
      if (typeof module.getSubagentsServiceForSession === 'function') return module.getSubagentsServiceForSession
    } catch {
      /* Capability remains unavailable, never use the global accessor. */
    }
  }
  return undefined
}

export const projectTasks = projectTaskRecords

export function createTaskObserver(
  pi: ExtensionAPI,
  owns: (ctx: ExtensionContext) => boolean,
  publish: (ctx: ExtensionContext, data: IAgentHaloTaskSnapshotEvent['data']) => Promise<void>,
  load: () => Promise<Accessor | undefined> = () => loadTaskAccessor(pi),
) {
  let generation = 0
  let cleanups: (() => void)[] = []
  const stop = () => {
    generation++
    for (const cleanup of cleanups) cleanup()
    cleanups = []
  }
  return {
    stop,
    start(ctx: ExtensionContext) {
      stop()
      const current = generation
      let accessor: Accessor | undefined
      let last = ''
      let scheduled = false
      const valid = () => generation === current && owns(ctx)
      const refresh = () => {
        if (!valid() || scheduled) return
        scheduled = true
        queueMicrotask(() => {
          scheduled = false
          if (!valid()) return
          let data: IAgentHaloTaskSnapshotEvent['data']
          try {
            const service = accessor?.(ctx.sessionManager)
            if (service) {
              const records = service.listAgents()
              data = {
                availability: 'available',
                tasks: projectTasks(records),
                omittedCount: Math.max(0, records.length - 256),
              }
            } else data = { availability: 'unavailable', tasks: [] }
          } catch {
            data = { availability: 'unavailable', tasks: [] }
          }
          const serialized = JSON.stringify(data)
          if (serialized === last) return
          last = serialized
          void publish(ctx, data)
        })
      }
      // The SDK supplies an instance bus. Payloads are deliberately ignored;
      // even a shared/custom bus can only trigger a read of this exact owner.
      for (const channel of [
        'created',
        'started',
        'completed',
        'failed',
        'resuming',
        'resumed',
        'compacted',
        'steered',
      ]) {
        cleanups.push(pi.events.on(`subagents:${channel}`, refresh))
      }
      void load()
        .then((loaded) => {
          if (!valid()) return
          accessor = loaded
          refresh()
          // session_start handlers run in load order. Finite deferred retries let
          // a later service bind, without leaving a background poller running.
          if (loaded)
            for (const delay of [0, 100, 500]) {
              const timer = setTimeout(refresh, delay)
              timer.unref?.()
              cleanups.push(() => clearTimeout(timer))
            }
        })
        .catch(() => {
          if (valid()) refresh()
        })
    },
  }
}
