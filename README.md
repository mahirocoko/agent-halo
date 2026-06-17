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

- `http://127.0.0.1:47621/health` — bridge status plus capability metadata
- `http://127.0.0.1:47621/snapshot` — recent events plus capability metadata
- `http://127.0.0.1:47621/events` — Server-Sent Events

It also writes a local event log:

```text
~/.letta/mods/agent-halo.events.ndjson
```

## Desktop halo

The first Notchcode-like desktop surface lives in `apps/desktop`. It is a transparent, always-on-top Tauri window that sits at the top center of the screen and subscribes to the Agent Halo bridge.

For local development:

```bash
pnpm desktop:web:build
(cd apps/desktop/src-tauri && cargo check)
pnpm test:demo
pnpm desktop:dev
```

For a local app install:

```bash
pnpm desktop:install
open ~/Applications/Agent\ Halo.app
```

The desktop app can install or reinstall the Letta mod from Setup. After the first mod install, reload or restart Letta Code so it loads `~/.letta/mods/agent-halo.js`; once loaded, the app can reconnect/check bridge state from Setup.

For browser-only visual QA without the bridge:

```bash
pnpm desktop:web
open http://127.0.0.1:47622/?demo=1
```

Browser demo mode intentionally guards native-only buttons. Use `pnpm desktop:dev` when testing bridge health checks or mod installation from the desktop UI.

Current desktop behavior:

- renders a Notchcode-inspired black hardware notch, click-to-expand dropped sheet, compact session rows, session drill-down, dismiss controls for ended sessions, compact capability-aware setup view with real mod install status and next-step guidance, and recent-event timeline
- keeps completed sessions sticky until the user acknowledges or dismisses them, with dismissed ended sessions remembered locally across reloads
- exposes a first tray/menu-bar lifecycle menu: show, hide, quit
- hydrates `GET /snapshot`
- subscribes to `GET /events` with `EventSource`
- derives `idle`, `thinking`, `tool-running`, `stale`, `closed`, and `error` from the shared presence model
- keeps raw prompts/tool args out of the UI by default

Run `/reload` after `pnpm mod:install` when the bridge mod changes.

## Dev viewer

After `/reload`, use the terminal viewer to validate live events before building the desktop shell:

```bash
pnpm viewer
```

For machine-readable output:

```bash
pnpm viewer -- --json
```

The viewer hydrates `/snapshot`, subscribes to `/events`, and derives a UI-facing presence state such as `idle`, `thinking`, `tool-running`, or `stale`.

## Development

```bash
pnpm check
pnpm test:demo
pnpm mod:tail
```


## Visual direction

Agent Halo should follow Notchcode's taste for this project: a black hardware notch/pill at rest, a compact dropped sheet for live state, small functional glyphs, row-based session lists, restrained charcoal surfaces, hairline dividers, and orange/done status accents. Avoid generic dark dashboard moves such as cyan glow panels, metric-card grids, oversized orbs, and decorative SaaS copy. Track concrete parity evidence in `docs/notchcode-parity.md`; v1 is accepted as read-only + dismiss + setup/control-plane, with real focus/end actions intentionally post-v1 until public session/process controls exist. Notch geometry and sheet anatomy are adapted from Notchcode; see `CREDITS.md` and `THIRD_PARTY_LICENSES.md`.

The Tauri runtime resizes the transparent window between a compact pill (`272x64`) and panel (`340x314`) so the overlay does not leave a permanent dashboard-sized hit area on screen. The expanded shell should read as the notch extending downward, not as a detached popup below it.
