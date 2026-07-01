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
      compact: boolean,
      llm: boolean,
    },
    endpoints: {
      health: true,
      snapshot: true,
      sse: true,
      hookStop: true,
      ingest: true,
    },
    sessionActions: {
      focusTerminal: boolean,
      endSession: boolean,
      dismissEnded: boolean,
    },
  }
}
```

`GET /snapshot` also returns `recent: AgentHaloEvent[]`. `POST /hook/stop` is a local hook integration endpoint that converts a Letta `Stop` hook into a `turn_stop` event. `POST /ingest` is the local multi-instance fan-in endpoint: secondary mod instances that cannot bind the bridge port forward their events to the primary bridge instead of dropping them. Current bridge session actions intentionally report `focusTerminal: false` and `endSession: false` until real Letta-scoped session/process capabilities exist.

The desktop app may expose a separate native-only Ghostty focus fallback. That action uses Ghostty's macOS scripting dictionary to match a terminal by cwd/title/id, select the owning tab, and focus the terminal; it is still not a bridge-level session action and should remain clearly labeled as a desktop-native fallback.

Lower-level Letta Code app-server/device protocol exports richer queue, approval, tool-execution, and result events. Agent Halo v1 does not consume that internal websocket protocol yet; the bridge stays on the trusted public mod event surface until a scoped, stable app-server integration is designed. Do not fake queue/approval rows from transcript text.

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

### `turn_stop`

Emitted when a local Letta `Stop` hook posts to `POST /hook/stop`. This means the assistant turn finished; it is not the same as a process/session kill.

```json
{
  "type": "turn_stop",
  "data": {
    "hookEventName": "Stop",
    "source": "hook",
    "message": null
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

### `tool_end`

Emitted after local tool execution finishes. The bridge stores only status and output length, not raw output.

```json
{
  "type": "tool_end",
  "data": {
    "toolCallId": "call_123",
    "toolName": "exec_command",
    "status": "success",
    "outputLength": 1200
  }
}
```

### `compact_start`

Emitted before local backend compaction starts.

```json
{
  "type": "compact_start",
  "data": {
    "trigger": "context_window_overflow"
  }
}
```

### `compact_end`

Emitted after local backend compaction completes.

```json
{
  "type": "compact_end",
  "data": {
    "trigger": "context_window_overflow",
    "messagesBefore": 220,
    "messagesAfter": 120,
    "contextTokensBefore": 190000,
    "contextTokensAfter": 90000
  }
}
```

### `llm_start`

Emitted before a local backend provider request starts.

```json
{
  "type": "llm_start",
  "data": {
    "model": "openai/gpt-5.5",
    "messageCount": 120,
    "contextWindow": 200000
  }
}
```

### `llm_end`

Emitted when a local backend provider request finishes. In Letta Code 0.27.20+, provider failures also emit `llm_end` with `stopReason: "llm_api_error"`, `usage: null`, and an optional `error` summary. Agent Halo intentionally keeps only the short error summary (`message`, `errorType`, `retryable`) and does not store verbose provider details. When prompt and completion counts are both available, Agent Halo normalizes `totalTokens` to `promptTokens + completionTokens` for per-request activity display.

```json
{
  "type": "llm_end",
  "data": {
    "model": "openai/gpt-5.5",
    "stopReason": "end_turn",
    "durationMs": 4200,
    "usage": {
      "promptTokens": 10000,
      "completionTokens": 1200,
      "totalTokens": 11200
    }
  }
}
```

Provider-error shape:

```json
{
  "type": "llm_end",
  "data": {
    "model": "openai/gpt-5.5",
    "stopReason": "llm_api_error",
    "durationMs": 4200,
    "usage": null,
    "error": {
      "message": "provider failed",
      "errorType": "llm_error",
      "retryable": true
    }
  }
}
```
