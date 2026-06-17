# Agent Halo

Agent Halo is a native presence layer for Letta Code: a trusted Letta mod emits normalized local events, and a desktop halo can render agent activity without scraping terminal output or transcripts.

## Current shape

This repository starts contract-first:

- `mods/agent-halo.js` — Letta Code mod that emits lifecycle/tool/turn events.
- `packages/protocol/` — shared event schema for the mod and future desktop app.
- `docs/` — architecture and protocol notes.
- `apps/desktop/` — planned desktop renderer surface.

## Design stance

Agent Halo should be Letta-native, not a transcript parser MVP.

```text
Letta Code mod events
  -> local Agent Halo bridge (SSE + NDJSON)
  -> desktop halo renderer
```

The bridge intentionally avoids importing Letta Code internals. It uses public mod events and scoped context only.

## Install the local mod

```bash
pnpm install
pnpm mod:install
```

Then reload Letta Code:

```text
/reload
```

The bridge serves:

- `http://127.0.0.1:47621/health`
- `http://127.0.0.1:47621/events` (Server-Sent Events)

It also writes a local event log:

```text
~/.letta/mods/agent-halo.events.ndjson
```

## Development

```bash
pnpm check
pnpm mod:tail
```
