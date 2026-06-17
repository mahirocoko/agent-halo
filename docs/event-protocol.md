# Agent Halo Event Protocol

Protocol version: `1`

Events are newline-delimited JSON in `~/.letta/mods/agent-halo.events.ndjson` and Server-Sent Events from `GET /events`.

## Base fields

```ts
{
  version: 1,
  id: string,
  type: string,
  timestamp: string,
  agentId: string | null,
  agentName?: string | null,
  conversationId: string | null,
  cwd?: string | null,
  model?: string | null,
  permissionMode?: string | null,
  data: object
}
```


## Bridge endpoints

`GET /health` and `GET /snapshot` include bridge capability metadata so viewers know which event streams and session actions are real instead of guessing or showing fake controls.

```ts
{
  ok: true,
  capabilities: {
    events: {
      lifecycle: boolean,
      turns: boolean,
      tools: boolean,
    },
    endpoints: {
      health: true,
      snapshot: true,
      sse: true,
    },
    sessionActions: {
      focusTerminal: boolean,
      endSession: boolean,
      dismissEnded: boolean,
    },
  }
}
```

`GET /snapshot` also returns `recent: AgentHaloEvent[]`. Current bridge session actions intentionally report `focusTerminal: false` and `endSession: false` until real session/process capabilities exist.

## Event types

### `bridge_ready`

Emitted when the mod starts its local bridge.

```json
{
  "type": "bridge_ready",
  "data": {
    "port": 47621,
    "logFile": "~/.letta/mods/agent-halo.events.ndjson",
    "ssePath": "/events",
    "healthPath": "/health"
  }
}
```

### `conversation_open`

Emitted from Letta lifecycle events.

```json
{
  "type": "conversation_open",
  "data": {
    "reason": "startup",
    "previousConversationId": null
  }
}
```

### `conversation_close`

```json
{
  "type": "conversation_close",
  "data": {
    "durationMs": 120000,
    "messageCount": 12,
    "reason": "quit",
    "toolCallCount": 3
  }
}
```

### `turn_start`

By default this records counts only. Text previews are disabled unless local config opts in.

```json
{
  "type": "turn_start",
  "data": {
    "inputCount": 1
  }
}
```

### `tool_start`

Does not record full tool arguments by default; records argument keys only.

```json
{
  "type": "tool_start",
  "data": {
    "toolCallId": "call_123",
    "toolName": "exec_command",
    "argKeys": ["cmd", "yield_time_ms"]
  }
}
```
