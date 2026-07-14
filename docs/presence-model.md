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

The desktop UI derives a smaller “activity kind” from raw bridge events for recent-activity rows and future mascot/action mapping. This is intentionally a UI derivation, not a new bridge protocol field yet.

Current raw events:

| Raw event | Activity kind | Current mascot action | Meaning for UI/mascot direction |
| --- | --- | --- | --- |
| `turn_start` | `thinking` | `idle` | Model turn started; candidate for attentive/listening/thinking mascot state. |
| `tool_start` + `UpdatePlan` | `planning` | `coffee` | Planning changed; next custom candidate should be notebook/planning animation. |
| `tool_start` + shell/task tools | `shell` | `work` | Command/task lane activity; next custom candidate should be terminal/tool-use animation. |
| `tool_start` + `ApplyPatch` | `editing` | `work` | Code/file edit; candidate for focused work animation. |
| `tool_start` + `Agent`/`Task` | `delegating` | `work` | Subagent dispatched; next custom candidate should be handoff/companion/team animation. |
| `tool_start` + `ViewImage` | `visual` | `idle` | Visual inspection; next custom candidate should be looking/magnifier animation. |
| `tool_start` + `memory_apply_patch` | `memory` | `coffee` | Learning/memory write; next custom candidate should be archive/spark animation. |
| `tool_start` + `Skill` | `skill` | `work` | Skill invoked; next custom candidate should be tool-belt animation. |
| `tool_start` + goal tools | `goal` | `coffee` | Goal tracking; next custom candidate should be checkpoint animation. |
| `tool_end` success | derived tool kind | `work`/`idle` | Tool finished; status/output length are recorded without raw output. |
| `compact_start` / `compact_end` | `compact` | `dust` | Context compaction started/completed; token/message shrink stats are available on end. |
| `llm_start` / `llm_end` | `model` | `idle`/`work` | Provider request started/completed; duration and token usage are available on end. |
| `attention_requested` | `attention` | `coffee` | User input is required; the activity wing stays expanded until later activity resolves it. |
| `turn_complete` / legacy `turn_stop` / `conversation_close` | `done` | `idle` | Turn/session completed; the activity wing shows Done briefly while the row remains sticky. |
| `bridge_error` | `error` | `hurt` | Bridge or stream issue; candidate for hurt/fluster animation. |

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
