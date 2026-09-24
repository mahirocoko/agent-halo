#!/usr/bin/env node

import {
  createEvent,
  getCliEventName,
  getHookEventName,
  getInputKeys,
  getToolName,
  postEvent,
  readEndpoint,
  readIngestToken,
  readInput,
} from '../shared/agent-halo-hook-utils.mjs'

const input = await readInput()
const eventName = getCliEventName() ?? getHookEventName(input)
const endpoint = await readEndpoint()
const token = await readIngestToken()

const emit = (type, data) => {
  const event = createEvent({
    sourceKind: 'codexHost',
    hostNames: ['codex'],
    input,
    type,
    provider: 'Codex',
    data,
  })
  return event ? postEvent(endpoint, token, event) : undefined
}

try {
  if (eventName === 'SessionStart') await emit('conversation_open', { reason: input.source ?? 'startup' })
  else if (eventName === 'SessionEnd') await emit('conversation_close', { reason: input.reason ?? 'session_end' })
  else if (eventName === 'UserPromptSubmit') await emit('turn_start', { inputCount: 1 })
  else if (eventName === 'PreToolUse') await emit('tool_start', {
    toolCallId: input.tool_call_id ?? input.toolCallId ?? null,
    toolName: getToolName(input),
    argKeys: getInputKeys(input),
  })
  else if (eventName === 'PostToolUse' || eventName === 'PostToolUseFailure') await emit('tool_end', {
    toolCallId: input.tool_call_id ?? input.toolCallId ?? null,
    toolName: getToolName(input),
    status: eventName === 'PostToolUseFailure' || input.error ? 'error' : 'success',
    outputLength: typeof input.tool_output === 'string' ? input.tool_output.length : null,
  })
  else if (eventName === 'Stop') await emit('turn_complete', { hookEventName: 'Stop', source: 'hook' })
  else if (eventName === 'Interrupt') await emit('conversation_close', { reason: 'interrupt' })
  else if (eventName === 'PreCompact') await emit('compact_start', { trigger: input.trigger ?? null })
  else if (eventName === 'PostCompact') await emit('compact_end', { trigger: input.trigger ?? null })
} catch {
  // Presence must never block Codex's agent loop.
}

process.stdout.write('{}\n')
