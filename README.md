# Agent Halo

Agent Halo is a small macOS companion for Letta Code. It sits near the camera notch, shows what your agents are doing, and keeps recent sessions easy to find without digging through terminal panes.

<p align="center">
  <img src="apps/desktop/assets/agent-halo-app-icon.png" alt="Agent Halo app icon" width="128" height="128" />
</p>

## What it does

- Shows live Letta Code activity in a compact notch-style overlay.
- Groups recent conversations by workspace so subagents in the same repo stay together.
- Lets you focus a matching Ghostty terminal from a session row.
- Keeps completed sessions around until you dismiss or delete them locally.
- Shows local AI usage for supported tools such as Codex, Antigravity, Claude Code, Cursor, and Grok when their local credentials are available.
- Installs and checks the local Letta mod from the desktop app.

Agent Halo is intentionally local-first. It reads local Letta mod events and local tool credentials; it does not depend on transcript scraping or a hosted dashboard.

## How it works

```text
Letta Code mod events
  -> local Agent Halo bridge on 127.0.0.1:47621
  -> desktop notch overlay
```

The bridge exposes local-only endpoints:

- `GET /health` — bridge status and capabilities
- `GET /snapshot` — recent session state
- `GET /events` — live Server-Sent Events

It also writes a local event log at:

```text
~/.letta/mods/agent-halo.events.ndjson
```

## Install locally

Requirements:

- macOS
- Letta Code
- pnpm
- Rust/Tauri toolchain for building the desktop app

Install dependencies and build the app:

```bash
pnpm install
pnpm desktop:install
open /Applications/Agent\ Halo.app
```

In Agent Halo, open **Setup** and choose **Install/Reinstall** to install the Letta mod. Then reload or restart Letta Code so it loads:

```text
~/.letta/mods/agent-halo.js
```

You can also install the mod from the command line:

```bash
pnpm mod:install
```

Then run `/reload` inside Letta Code.

## Usage view

The Usage tab shows providers only when Agent Halo can read local credentials for them. Missing providers stay hidden instead of showing noisy error cards.

Currently supported providers:

- Codex
- Antigravity
- Claude Code
- Cursor
- Grok

Antigravity is read from the Antigravity/`agy` language server when it is running, so it can show the actual Antigravity model list. If the language server is not available, Agent Halo falls back to the local Cloud Code quota path when possible.

## Development

Common commands:

```bash
pnpm check
pnpm desktop:dev
pnpm desktop:install
pnpm viewer
pnpm mod:tail
```

Browser-only visual demo:

```bash
pnpm desktop:web
open http://127.0.0.1:47622/?demo=1
```

The browser demo is useful for layout checks, but native features such as mod install, Ghostty focus, menu-bar behavior, and macOS window sizing require the Tauri desktop app.

## Project layout

- `mods/agent-halo.js` — Letta Code mod and local bridge
- `apps/desktop/` — Tauri desktop overlay
- `apps/viewer/` — terminal event viewer
- `packages/protocol/` — shared event and presence model
- `docs/` — architecture, protocol, and design notes

## Design direction

Agent Halo should feel like a quiet companion, not an AI dashboard. The UI follows a dark hardware-notch direction with compact rows, restrained accents, and local controls. See `docs/notchcode-parity.md` for the current design reference notes.

## Credits

Notch geometry and sheet anatomy are inspired by Notchcode. See `CREDITS.md` and `THIRD_PARTY_LICENSES.md` for attribution and licenses.
