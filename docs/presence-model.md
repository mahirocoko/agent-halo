# Agent Halo Presence Model

The bridge emits raw Letta-native events. The presence model converts those events into a small UI-facing state so desktop and terminal viewers do not each invent their own rules.

## State shape

```ts
type AgentHaloPresenceStatus =
  | "offline"
  | "idle"
  | "thinking"
  | "tool-running"
  | "attention"
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
| `tool_end` | `thinking` / `error` | Clears active tool; errors become error state, success returns to thinking until the next model/turn event. |
| `compact_start` | `tool-running` | Shows context compaction as active work with `activeToolName = compact`. |
| `compact_end` | `thinking` | Records before/after compaction stats and returns to thinking. |
| `llm_start` | `thinking` | A provider request started; records model, message count, and context window. |
| `llm_end` | `closed` / `thinking` / `error` | Records stop reason, duration, token usage, and provider-error summaries; terminal stop reasons close the turn, provider errors enter error state. |
| `attention_requested` | `attention` | An optional PermissionRequest/filtered Notification relay or direct `AskUserQuestion` lifecycle needs user input. It stays until later tool/turn/completion activity resolves it. |
| `turn_complete` / legacy `turn_stop` | `closed` | Local Letta `Stop` hook signal; means the assistant turn finished and should show as done/sticky. |
| `conversation_close` | `closed` | Captures message/tool counts when available. |
| `bridge_error` | `error` | Reserved for bridge/runtime errors. |

## Completion and stale fallback

Letta Code mods now expose `tool_end`, `compact_start` / `compact_end`, and local-backend `llm_start` / `llm_end`; Letta Code 0.27.20 also emits `llm_end` for provider errors with nullable usage and an error summary. Agent Halo still keeps Mahiro's local Letta `Stop` hook via `POST /hook/stop` as a reliable turn-finished fallback because not every backend/surface emits every event. Viewers should still treat long-running `thinking` / `tool-running` states as potentially stale after a local timeout when terminal events are unavailable.

The terminal viewer defaults to `staleAfterMs = 30000`. The desktop uses event-aware missing-terminal fallbacks instead of one universal 30-second timeout: in-flight model work may remain active for up to 10 minutes, tool work for up to 30 minutes, compaction for up to 10 minutes, and transitional events for up to 2 minutes. A paired terminal event still resolves immediately. Once a fallback expires, the desktop maps the quiet event to `inactive`, not `waiting`: only `attention_requested` means the agent actually needs user input. Inactive sessions remain in history but have lower priority than done/idle sessions and do not occupy the notch activity wing.

Legacy persisted or snapshot events whose conversation id is `default` are migrated to the same per-agent fallback identity used by the mod. Scoped `local-conv-*` history is preserved. This prevents events from unrelated projects or stateless subagents from sharing one registry key.

## Derived activity semantics

The desktop UI derives a smaller “activity kind” from raw bridge events for recent-activity rows. The Halo Soft Cube mascot then maps the truthful session status to five compact visual states (`idle`, `working`, `attention`, `done`, `error`); activity kind may help choose the state but does not invent task content. This is intentionally a UI derivation, not a new bridge protocol field.

Current raw events:

| Raw event | Activity kind | Soft Cube state | Meaning for UI/mascot direction |
| --- | --- | --- | --- |
| `turn_start` | `thinking` | `working` | Model turn started; restrained body rhythm plus active mote. |
| `tool_start` + `UpdatePlan` | `planning` | `working` | Planning remains truthful working presence without a fake notebook/task scene. |
| `tool_start` + shell/task tools | `shell` | `working` | Command/task activity; task content is not rendered into the pet. |
| `tool_start` + `ApplyPatch` | `editing` | `working` | Code/file edit activity. |
| `tool_start` + `Agent`/`Task` | `delegating` | `working` | Subagent activity without fabricating a durable hierarchy. |
| `tool_start` + `ViewImage` | `visual` | `working` | Visual inspection remains active work. |
| `tool_start` + `memory_apply_patch` | `memory` | `working` | Learning/memory activity without exposing memory content. |
| `tool_start` + `Skill` | `skill` | `working` | Skill execution activity. |
| `tool_start` + goal tools | `goal` | `working` | Goal-tool activity without adding unsupported goal detail. |
| `tool_end` success | derived tool kind | derived status | Tool completion detail remains in activity history; the pet follows the resulting session state. |
| `compact_start` / `compact_end` | `compact` | `working` | Context compaction activity; token/message shrink stats remain textual evidence. |
| `llm_start` / `llm_end` | `model` | `working` / derived status | Provider request lifecycle; terminal state comes from the actual event result. |
| `attention_requested` | `attention` | `attention` | User input is required; orange state and alert mote persist until later activity resolves it. |
| `turn_complete` / legacy `turn_stop` / `conversation_close` | `done` | `done` | Green one-shot settle while the completed row remains sticky. |
| `bridge_error` | `error` | `error` | Red worried face/mote while safe error detail stays textual. |

Important limitation: there is no native `plan_start`, `thinking_delta`, or assistant-text event in the current protocol. “Plan” is inferred from the `UpdatePlan` tool, “thinking” is inferred from `turn_start` / `llm_start`, and active work is inferred from tool/model/compaction lifecycle until `llm_end`, `turn_complete`, or inactivity. General approval queue/result state remains unavailable.

Stop/attention hook relays may arrive shortly after a terminal model event. The bridge retains completed scopes for 15 seconds and attaches an unscoped hook only when exactly one recent scope matches the requested cwd/agent constraints; ambiguous same-cwd completions remain unscoped rather than being guessed.

## Privacy stance

The presence model should be enough for ambient UI:

- agent / conversation identity
- cwd / model / permission mode
- current status
- active tool name
- event timestamps

It should not need raw prompts, full tool args, transcript contents, or secrets. Text preview is opt-in at the bridge config level and disabled by default.
