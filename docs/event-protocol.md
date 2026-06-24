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

The desktop app may expose a separate native-only terminal focus fallback. For Ghostty, it uses Ghostty's macOS scripting dictionary to match a terminal by cwd/title/id, select the owning tab, and focus the terminal. For Warp, the local mod sets a unique terminal title from workspace + conversation id; the desktop app first uses Warp's optional `warpctrl tab activate --tab-title ...` path when local control is enabled and `warpctrl` is installed, otherwise it falls back to macOS accessibility window-title matching with Tab-menu cycling and finally app activation. Warp does not expose Ghostty-style terminal/tab metadata, so exact fallback tab focus depends on that terminal-title handshake. It is still not a bridge-level session action and should remain clearly labeled as a desktop-native fallback.

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
