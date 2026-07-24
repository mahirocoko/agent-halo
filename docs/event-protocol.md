# Agent Halo Event Protocol

Protocol version: `2`

Events are newline-delimited JSON in `~/.letta/mods/agent-halo.events.ndjson` and Server-Sent Events from `GET /events`.

## Base fields

```ts
{
  version: 2,
  id: string,
  type: string,
  timestamp: string,
  agentId: string | null,
  agentName?: string | null,
  conversationId: string | null,
  cwd?: string | null,
  model?: string | null,
  permissionMode?: string | null,
  runtime?: {
    sourcePid: number,
    sourcePpid: number | null,
    sourceStartedAtMs: number,
    sourceKind: "lettaHost" | "hookRelay" | "unknown" | string,
    herdr?: {
      socketPath: string,
      paneId: string,
      sourcePid: number,
      sourceStartedAtMs: number,
      workspaceId?: string | null,
      tabId?: string | null,
    } | null,
  } | null,
  data: object
}
```

`runtime` is optional, additive protocol-v2 metadata for local read-only observability. Events emitted inside the Letta mod identify the originating Letta host process before multi-instance forwarding, so a secondary session does not inherit the primary bridge owner's PID. A Letta host launched inside Herdr may also preserve the inherited local socket plus workspace/tab/pane and source-process identity; this is terminal-host navigation metadata, not a Letta process capability. Forwarded `/ingest` runtime identity requires a machine-local 0600 shared token generated under `~/.letta/mods/`; untrusted or older senders remain event-compatible but their `runtime` field is stripped before storage. Hook-derived events reuse a recently correlated Letta scope only when that scope is unambiguous and no older than the bounded active-scope window; an unscoped hook event leaves `runtime` null. Runtime metadata never grants Letta process control and does not expose command arguments.

`conversationId` is normalized before emission. A real scoped conversation id wins. When Letta reports the literal fallback id `default`, Agent Halo uses `agent:<agentId>` (or a workspace fallback only when no agent id exists) so stateless/subagent lanes from different agents and projects never collapse into one global `default` session.

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
      hookAttention: true,
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

`GET /snapshot` also returns `recent: AgentHaloEvent[]`. `POST /hook/stop` converts a Letta `Stop` hook into `turn_complete`; legacy `turn_stop` events remain readable. `POST /hook/attention` converts an optionally configured `PermissionRequest` hook into `attention_requested`. The installer copies the relay but does not mutate global Letta settings while other sessions may be writing them. `POST /ingest` is the local multi-instance fan-in endpoint: secondary mod instances that cannot bind the bridge port forward their events to the primary bridge instead of dropping them. Current bridge session actions intentionally report `focusTerminal: false` and `endSession: false` until real Letta-scoped session/process capabilities exist.

The desktop app may expose a separate native terminal-host focus action. With trusted Herdr runtime identity it first reads the current Herdr agent and requires matching Letta PID, process start, and hashed conversation-scope tokens before sending `agent.focus`, then activates the Ghostty host. This prevents persisted pane IDs from silently targeting a reused pane after restart. The Unix socket must be a private current-user socket below `~/.config/herdr`, and the complete identity/focus exchange has a bounded deadline. If identity is absent, stale, invalid, or the request fails, the app preserves the existing Ghostty scripting-dictionary match by cwd/title/id. Neither path is a bridge-level Letta session/process action, so `sessionActions.focusTerminal` remains false.

Lower-level Letta Code app-server/device protocol exports richer queue, approval, tool-execution, and result events. Agent Halo does not consume that internal websocket protocol; the bridge stays on public mod events plus supported local hook events. `attention_requested` means only “the local harness asked for user input,” not that Agent Halo owns or can resolve the approval queue.

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

### `turn_complete`

Emitted when the installed local Letta `Stop` hook relay posts to `POST /hook/stop`. This means one assistant turn finished; it is not the same as conversation close or process/session kill. `turn_stop` is retained as a legacy input event.

```json
{
  "type": "turn_complete",
  "data": {
    "hookEventName": "Stop",
    "source": "hook",
    "message": null
  }
}
```

### `attention_requested`

Emitted from an explicitly connected `PermissionRequest`/`Notification` hook relay or when the public tool lifecycle reaches `AskUserQuestion`. Some Letta surfaces render `AskUserQuestion` outside the local tool manager, so Mahiro's existing decision voice hook also calls the relay. A Notification immediately following a terminal event in the same cwd is suppressed; a new `turn_start` clears that suppression. The event carries no raw tool arguments or question text.

```json
{
  "type": "attention_requested",
  "data": {
    "hookEventName": "PermissionRequest",
    "source": "hook",
    "kind": "approval",
    "toolName": "exec_command",
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
