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
3. **Presence model** — derive stable statuses such as idle, thinking, tool-running, waiting, error.
4. **Letta-specific surfaces** — memory dirty/synced, subagent/task activity, skill invocation, permission waits when public mod APIs expose them.
