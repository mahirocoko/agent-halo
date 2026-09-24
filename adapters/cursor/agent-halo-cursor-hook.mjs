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
    sourceKind: 'cursorHost',
    hostNames: ['agent', 'cursor'],
    input,
    type,
    provider: 'Cursor',
    data,
  })
  return event ? postEvent(endpoint, token, event) : undefined
}

try {
  if (eventName === 'sessionStart') await emit('conversation_open', { reason: 'startup' })
  else if (eventName === 'sessionEnd') await emit('conversation_close', { reason: 'session_end' })
  else if (eventName === 'beforeSubmitPrompt') await emit('turn_start', { inputCount: 1 })
  else if (eventName === 'preToolUse') await emit('tool_start', {
    toolCallId: input.tool_call_id ?? input.toolCallId ?? null,
    toolName: getToolName(input),
    argKeys: getInputKeys(input),
  })
  else if (eventName === 'postToolUse' || eventName === 'postToolUseFailure') await emit('tool_end', {
    toolCallId: input.tool_call_id ?? input.toolCallId ?? null,
    toolName: getToolName(input),
    status: eventName === 'postToolUseFailure' || input.error ? 'error' : 'success',
    outputLength: typeof input.tool_output === 'string' ? input.tool_output.length : null,
  })
  else if (eventName === 'stop') {
    if (input.status === 'aborted') await emit('conversation_close', { reason: 'aborted' })
    else if (input.status === 'error') await emit('bridge_error', { message: 'Cursor turn failed', code: 'cursor_turn_error' })
    else await emit('turn_complete', { hookEventName: 'stop', source: 'hook' })
  }
  else if (eventName === 'afterAgentResponse') await emit('llm_end', {
    stopReason: 'response',
    usage: null,
    durationMs: null,
  })
} catch {
  // Presence must never block Cursor's agent loop.
}

process.stdout.write(eventName === 'preToolUse' ? '{"permission":"allow"}\n' : '{}\n')
