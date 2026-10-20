import { type AgentHaloEvent, normalizeTaskSnapshot } from '@agent-halo/protocol'
import { MAX_RECENT_EVENTS, MAX_SESSION_EVENTS_PER_SESSION } from './constants'
import type { SessionEventRegistry } from './types'

export const isSessionEventRegistry = (value: unknown): value is SessionEventRegistry =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(
    (events) =>
      Array.isArray(events) &&
      events.every(
        (event) =>
          typeof event === 'object' &&
          event !== null &&
          typeof (event as AgentHaloEvent).id === 'string' &&
          typeof (event as AgentHaloEvent).timestamp === 'string' &&
          typeof (event as AgentHaloEvent).conversationId === 'string',
      ),
  )

export const normalizeSessionEventIdentity = (event: AgentHaloEvent): AgentHaloEvent => {
  if (event.conversationId !== 'default') return event

  const conversationId = event.agentId ? `agent:${event.agentId}` : event.cwd ? `workspace:${event.cwd}` : 'default'
  return { ...event, conversationId }
}

export const sortEventsNewestFirst = (events: AgentHaloEvent[]): AgentHaloEvent[] =>
  [...events].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))

export const mergeSessionEvents = (current: SessionEventRegistry, incoming: AgentHaloEvent[]): SessionEventRegistry => {
  if (incoming.length === 0) return current

  const incomingByConversation = new Map<string, Map<string, AgentHaloEvent>>()
  for (const rawEvent of incoming) {
    const event =
      rawEvent.type === 'task_snapshot' ? normalizeTaskSnapshot(rawEvent) : normalizeSessionEventIdentity(rawEvent)
    if (!event?.conversationId) continue

    const byId = incomingByConversation.get(event.conversationId) ?? new Map<string, AgentHaloEvent>()
    byId.set(event.id, event)
    incomingByConversation.set(event.conversationId, byId)
  }

  if (incomingByConversation.size === 0) return current

  const next = { ...current }
  for (const [conversationId, incomingById] of incomingByConversation) {
    const byId = new Map((current[conversationId] ?? []).map((event) => [event.id, event]))
    for (const [eventId, event] of incomingById) byId.set(eventId, event)
    const sorted = sortEventsNewestFirst([...byId.values()])
    // Incoming wins equal-time ties; older hydration must never replace a
    // newer observed snapshot. Keep only one, outside the activity budget.
    const snapshot = [...byId.values()]
      .filter((event) => event.type === 'task_snapshot')
      .reduce<AgentHaloEvent | undefined>(
        (latest, event) => (!latest || Date.parse(event.timestamp) >= Date.parse(latest.timestamp) ? event : latest),
        undefined,
      )
    const activity = sorted.filter((event) => event.type !== 'task_snapshot').slice(0, MAX_SESSION_EVENTS_PER_SESSION)
    next[conversationId] = snapshot ? [...activity, snapshot] : activity
  }
  return next
}

export const normalizeSessionEventRegistry = (registry: SessionEventRegistry): SessionEventRegistry =>
  mergeSessionEvents({}, Object.values(registry).flat())

export const appendRecentEvent = (events: AgentHaloEvent[], event: AgentHaloEvent): AgentHaloEvent[] =>
  event.type === 'task_snapshot' ? events : [event, ...events].slice(0, MAX_RECENT_EVENTS)

export const getUniqueSortedEvents = (events: AgentHaloEvent[]): AgentHaloEvent[] => {
  const byId = new Map<string, AgentHaloEvent>()
  for (const event of events) byId.set(event.id, event)
  return sortEventsNewestFirst([...byId.values()])
}
