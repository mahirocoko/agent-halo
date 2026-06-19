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
| `turn_stop` / `conversation_close` | `done` | `idle` | Turn/session completed; candidate for settle/idle/done animation. |
| `bridge_error` | `error` | `hurt` | Bridge or stream issue; candidate for hurt/fluster animation. |

Important limitation: there is no native `plan_start`, `thinking_delta`, `tool_end`, or assistant-text event in the current protocol. “Plan” is inferred from the `UpdatePlan` tool, “thinking” is inferred from `turn_start`, and active work is inferred from `tool_start` until `turn_stop` or staleness.

## Privacy stance

The presence model should be enough for ambient UI:

- agent / conversation identity
- cwd / model / permission mode
- current status
- active tool name
- event timestamps

It should not need raw prompts, full tool args, transcript contents, or secrets. Text preview is opt-in at the bridge config level and disabled by default.
