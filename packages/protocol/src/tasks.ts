import type { IAgentHaloTaskSnapshotEvent } from './index.js'

const statuses = new Set(['queued', 'running', 'completed', 'aborted', 'stopped', 'error'])
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,128}$/.test(value)
const time = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000 ? value : null

export const projectTaskRecords = (records: unknown[]): IAgentHaloTaskSnapshotEvent['data']['tasks'] => {
  const seen = new Set<string>()
  return records.slice(0, 256).flatMap((value) => {
    const record = object(value)
    if (
      !record ||
      !identifier(record.id) ||
      !identifier(record.role ?? record.type) ||
      !statuses.has(String(record.status))
    )
      return []
    // Deterministic first valid record wins; never create duplicate React keys.
    if (seen.has(record.id)) return []
    seen.add(record.id)
    return [
      {
        id: record.id,
        role: (record.role ?? record.type) as string,
        status: record.status as IAgentHaloTaskSnapshotEvent['data']['tasks'][number]['status'],
        startedAt: time(record.startedAt),
        completedAt: time(record.completedAt),
      },
    ]
  })
}

// Boundary for SSE, snapshot hydration and persisted registry reads. A task
// snapshot is never an independent conversation or a source of runtime identity.
export const normalizeTaskSnapshot = (value: unknown): IAgentHaloTaskSnapshotEvent | null => {
  const event = object(value)
  const data = object(event?.data)
  if (
    !event ||
    event.type !== 'task_snapshot' ||
    event.version !== 2 ||
    !identifier(event.id) ||
    typeof event.timestamp !== 'string' ||
    !Number.isFinite(Date.parse(event.timestamp)) ||
    typeof event.conversationId !== 'string' ||
    !/^pi:[a-zA-Z0-9_.:/-]{1,128}$/.test(event.conversationId) ||
    event.agentId !== event.conversationId ||
    event.agentName !== 'Pi' ||
    !data ||
    !['available', 'unavailable'].includes(String(data.availability)) ||
    !Array.isArray(data.tasks)
  )
    return null
  return {
    version: 2,
    id: event.id,
    timestamp: event.timestamp,
    type: 'task_snapshot',
    conversationId: event.conversationId,
    agentId: event.conversationId,
    agentName: 'Pi',
    runtime: null,
    model: null,
    cwd: null,
    permissionMode: null,
    data: {
      availability: data.availability as 'available' | 'unavailable',
      tasks: data.availability === 'available' ? projectTaskRecords(data.tasks) : [],
      omittedCount:
        typeof data.omittedCount === 'number' && Number.isSafeInteger(data.omittedCount) && data.omittedCount > 0
          ? data.omittedCount
          : Math.max(0, data.tasks.length - 256),
    },
  }
}
