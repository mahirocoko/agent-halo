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

1. **Bridge** — mod emits normalized local events over SSE and NDJSON.
2. **Desktop shell** — Tauri or native macOS renderer subscribes to the bridge.
3. **Presence model** — derive stable per-conversation statuses such as idle, thinking, tool-running, attention, inactive, done, and error.
4. **Letta-specific surfaces** — memory dirty/synced, subagent/task activity, skill invocation, permission waits when public mod APIs expose them.


## Presence model

Raw events are normalized into a UI-facing presence model in `packages/protocol/src/presence.ts`. This keeps desktop, terminal, and future menu-bar surfaces aligned on state transitions. See `docs/presence-model.md`.


## Desktop renderer

`apps/desktop` is the first Notchcode-like renderer. It uses Tauri so the app can become an always-on-top transparent desktop surface while the frontend stays protocol-driven React. The current window is a compact top-center notch/pill; future work should add native tray controls, monitor-aware notch geometry, and richer session details without changing the bridge contract.


## Demo mode and visual QA

The desktop frontend supports `?demo=1` so the Notchcode-inspired surface can be inspected without requiring a live Letta bridge. Demo mode cycles through synthetic `conversation_open`, `turn_start`, `tool_start`, and `conversation_close` events while using the same presence reducer and UI components as live mode.


The desktop app now includes a first tray/menu-bar control plane with Show, Hide, and Quit actions. The closed notch wing expands persistently for real needs-input activity and briefly for turn completion; it does not use OS notifications. Completed rows remain sticky until explicit Clear, while old incomplete activity becomes low-priority inactive history instead of masquerading as a user wait. Active and Completed sessions share one compact scroll surface; workspace groups expand into child session rows so secondary completions retain detail and Ghostty focus access. The Tauri installer writes the mod plus an idempotent Stop/PermissionRequest hook relay while preserving existing hooks. The Tauri runtime resizes the transparent window between compact pill and expanded sheet states through `set_panel_open`, and its setup view checks the complete mod/hook install before offering install/reinstall.


## Notchcode visual contract

Mahiro wants Agent Halo to match Notchcode taste for this project, not a generic AI dashboard. The desktop renderer should therefore use a black notch silhouette, click-to-expand dropped charcoal sheet, compact expandable session rows, session drill-down, completed-session Clear controls, compact setup/status view, small status glyphs, hairline dividers, and restrained orange/green state accents. Avoid blue/cyan glass panels, metric grids, large glowing status orbs, and decorative control-room copy unless Mahiro explicitly changes direction.

Concrete parity evidence and known gaps live in `docs/notchcode-parity.md`.
