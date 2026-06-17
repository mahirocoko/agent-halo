# Agent Halo Presence Model

The bridge emits raw Letta-native events. The presence model converts those events into a small UI-facing state so desktop and terminal viewers do not each invent their own rules.

## State shape

```ts
type AgentHaloPresenceStatus =
  | "offline"
  | "idle"
  | "thinking"
  | "tool-running"
  | "closed"
  | "error";
```

The current reducer lives in `packages/protocol/src/presence.ts`.

## Current transitions

| Event | Status | Notes |
| --- | --- | --- |
| `bridge_ready` | `idle` | Bridge is alive even if no conversation event has arrived yet. |
| `conversation_open` | `idle` | Clears active tool and closed stats. |
| `turn_start` | `thinking` | A user turn entered the model path. |
| `tool_start` | `tool-running` | Captures `activeToolName`; no arguments are stored. |
| `turn_stop` | `closed` | Local Letta `Stop` hook signal; means the assistant turn finished and should show as done/sticky. |
| `conversation_close` | `closed` | Captures message/tool counts when available. |
| `bridge_error` | `error` | Reserved for bridge/runtime errors. |

## Missing event types

Letta Code mods currently expose `tool_start` but not `tool_end` in this first event slice. Agent Halo can use Mahiro's local Letta `Stop` hook via `POST /hook/stop` as the reliable turn-finished signal. Viewers should still treat long-running `thinking` / `tool-running` states as potentially stale after a local timeout when the hook endpoint is unavailable.

The terminal viewer defaults to `staleAfterMs = 30000`.

## Privacy stance

The presence model should be enough for ambient UI:

- agent / conversation identity
- cwd / model / permission mode
- current status
- active tool name
- event timestamps

It should not need raw prompts, full tool args, transcript contents, or secrets. Text preview is opt-in at the bridge config level and disabled by default.
