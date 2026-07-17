# Agent Halo Architecture

## Goal

Agent Halo is a native presence layer for Letta Code. It should show what the current agent is doing — conversation lifecycle, model turns, tool usage, and eventually memory/subagent state — without parsing terminal output as the primary source of truth.

## Current architecture

```text
Letta Code Mod API
  conversation_open / conversation_close / turn_start / tool_start
        |
        v
mods/agent-halo.js
  - normalizes event payloads
  - writes NDJSON audit log
  - serves Server-Sent Events on localhost
        |
        v
Desktop renderer (planned)
  - subscribes to /events
  - renders compact live presence UI
```

## Why a mod-first bridge

Letta Code has richer runtime state than Claude/Codex hook-only flows: persistent agent identity, conversation identity, scoped cwd/model, tool events, memory, skills, and subagents. A transcript watcher would see some of this late and indirectly. A mod sees public runtime events as they happen.

## Boundaries

- Do not import Letta Code internals from the mod.
- Keep bridge state local and explicit.
- Avoid capturing raw user text by default.
- Treat the NDJSON log as local diagnostics, not canonical telemetry.
- Desktop UI should consume the protocol package, not infer fields from mod implementation details.

## Planned phases

1. **Bridge** — mod emits normalized local events over SSE and NDJSON, including stable per-agent identities for Letta's `default` fallback lanes and short-lived completed-scope correlation for delayed hooks.
2. **Desktop shell** — Tauri or native macOS renderer subscribes to the bridge.
3. **Presence model** — derive stable per-conversation statuses such as idle, thinking, tool-running, attention, inactive, done, and error.
4. **Letta-specific surfaces** — memory dirty/synced, subagent/task activity, skill invocation, permission waits when public mod APIs expose them.


## Presence model

Raw events are normalized into a UI-facing presence model in `packages/protocol/src/presence.ts`. This keeps desktop, terminal, and future menu-bar surfaces aligned on state transitions. See `docs/presence-model.md`.

Optional protocol-v2 runtime identity lets the native desktop map one conversation to its originating Letta host PID. Runtime samples remain a desktop-local read-only concern: the mod and bridge carry PID identity, while macOS `libproc` sampling, CPU deltas, process-tree aggregation, pressure labels, a bounded recent-target window, and strong ended-identity tombstones stay outside the event log. See `docs/runtime-monitor.md`.


## Desktop renderer

`apps/desktop` is the active Notchcode-like renderer. It uses Tauri for an always-on-top transparent macOS surface while the frontend stays protocol-driven React. `src/main.tsx` is the shell/native-window orchestrator; `src/features/session`, `presence`, `setup`, `pomodoro`, and `usage` own focused typed behavior, and ordered files under `src/styles/` preserve CSS cascade ownership. The app includes tray controls, selected-monitor-aware native notch metrics and positioning, state-directed session detail, a local Pomodoro timer, local usage, and setup without changing the bridge contract. The selected macOS screen is persisted natively by `NSScreenNumber` plus a name/resolution/scale fingerprint; a missing screen falls back to Primary without discarding the saved preference.

The Phase 1 Completion Pet adds one hidden transparent `pet` WebView routed before the main `App` mounts. The main renderer remains the sole Pomodoro owner; Pet is a projection/action surface backed by validated native commands and its own display-safe persisted position. See `docs/pet.md`.

Pomodoro state uses an absolute persisted deadline rather than a decrementing counter, so renderer reload, background throttling, and wake reconciliation do not extend a running session. Duration/cadence settings persist separately; each active or paused phase snapshots its own duration so editing settings cannot make the countdown jump. Starting a phase schedules one silent macOS `UserNotifications` alert natively; pause, reset, and skip cancel it. Renderer operations are serialized locally, while a native monotonic operation gate invalidates stale schedule/cancel work across WebView reloads. Permission or scheduling failure never blocks the local timer. In the collapsed notch, agent Attention/Error remains highest priority, then active/recent Pomodoro, then ordinary agent Working/Done activity. See `docs/pomodoro.md`.


## Demo mode and visual QA

The desktop frontend supports `?demo=1` plus focused `demoScenario` values so the Notchcode-inspired surface can be inspected without a live Letta bridge. Demo events use the same presence reducer, bounded registry, selectors, components, accessibility behavior, and CSS as live mode.


The desktop app now includes a first tray/menu-bar control plane with Show, Hide, and Quit actions. Agent activity itself does not use OS notifications: the closed notch wing expands persistently for real needs-input activity and briefly for turn completion. Status changes—including Attention, Error, Done, and Pomodoro completion—never auto-open the full panel or activate/focus Agent Halo; full expansion is pointer/keyboard/user-command driven. Hover expansion resizes without taking keyboard focus, while explicit keyboard/click navigation may request focus. Pomodoro completion separately uses an explicitly requested silent local macOS alert. Completed rows remain sticky until explicit Clear, while old incomplete activity becomes low-priority inactive history instead of masquerading as a user wait. Active and Completed sessions share one compact scroll surface; workspace groups expand into child session rows so secondary completions retain detail and Ghostty focus access. The Sessions overview uses dense trusted project/status/activity/model/age anatomy, while selecting a session replaces the overview with a state-directed Working, Needs input, Done, Error, Inactive, or Idle context and a clear Back to sessions control. These views remain event-derived and do not fabricate task prompts, permission diffs, answer controls, or exact terminal capabilities. The Tauri installer writes the mod plus an idempotent Stop/PermissionRequest hook relay while preserving existing hooks. The Tauri runtime serializes transparent-window resize/focus intent through `set_panel_open`, and its setup view checks the complete mod/hook install before offering install/reinstall.


## Notchcode visual contract

Mahiro wants Agent Halo to match Notchcode taste for this project, not a generic AI dashboard. The desktop renderer should therefore use a black notch silhouette, pointer/keyboard-expand dropped sheet, compact expandable session rows, session drill-down, completed-session Clear controls, compact setup/status view, small status glyphs, hairline dividers, and restrained state accents. Avoid blue/cyan glass panels, metric grids, large glowing status orbs, and decorative control-room copy unless Mahiro explicitly changes direction.

Concrete parity evidence and known gaps live in `docs/notchcode-parity.md`.
