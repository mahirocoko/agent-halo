# Agent Halo

<p align="center">
  <img src="apps/desktop/assets/agent-halo-app-icon.png" alt="Agent Halo app icon" width="128" height="128" />
</p>

<p align="center">
  A local macOS companion for Letta Code — live presence, workspace sessions, focus rituals, and private local tooling around the notch.
</p>

<p align="center">
  <strong>Local-first</strong> · <strong>Mod-driven</strong> · <strong>Notch-native</strong>
</p>

---

## Overview

Agent Halo is a native desktop companion for [Letta Code](https://docs.letta.com/letta-code/index.md). It runs around the macOS camera notch, listens to trusted Letta Code mod events, and turns agent activity into a compact live presence surface.

It is designed for people who keep multiple Letta Code conversations, subagents, and project terminals open at once. Instead of scraping terminal text or asking you to hunt through panes, Agent Halo keeps recent workspaces visible, shows what each conversation is doing, and adds local focus tools without trying to become a hosted dashboard or process manager.

The current app now spans session presence, a floating Completion Pet, Pomodoro, an optional camera-based Movement Break, local provider usage, read-only process pressure, native display placement, and setup/install controls.

## Product surfaces

| Surface | Current role |
| --- | --- |
| **Sessions** | Workspace-grouped Letta conversations, truthful activity state, sticky completion history, detail, clear/dismiss, and Ghostty focus |
| **Completion Pet** | A separate non-focus-stealing Pet window for natural Focus completion, with Start break, Later, Close, and optional Movement Break actions |
| **Pomodoro** | Local Focus/Short/Long phases, custom durations and cadence, pause/restart/reset/skip, persisted deadlines, and silent macOS alerts |
| **Movement Break** | Explicit 10-squat challenge using one local camera stream, a white shoulder line, fixed green target, live progress, and bundled offline pose inference |
| **Usage** | Local quota/token views for known AI providers, including truthful unavailable/offline diagnostics |
| **Runtime** | Read-only Letta host and subprocess CPU/memory pressure with strong PID identity and no kill controls |
| **Setup** | Connection/mod install, global Pet choice and size, Completion Pet/Movement settings, keep-awake, and target-display selection |

## What Agent Halo does

- Projects live Letta Code lifecycle, turn, model, tool, compaction, completion, and needs-input activity into a compact notch surface.
- Keeps recent conversations in workspace groups, including distinct subagent/default lanes, sticky completed rows, per-session context, and guarded clear/dismiss behavior.
- Focuses matching Ghostty tabs/windows through a native cwd/title/session-aware fallback.
- Tracks local AI usage and read-only Letta/subprocess pressure without hiding known providers or exposing process controls.
- Runs an independent local Pomodoro with customizable phases, persisted deadlines, collapsed countdown, silent notifications, and a separate Completion Pet.
- Offers an opt-in 10-squat Movement Break only after an explicit Pet action; preview and shoulder tracking use one local stream and bundled offline assets.
- Keeps the display awake only while genuine visible Letta work is active.
- Remembers the selected display for the notch and Pet, with safe Primary fallback when that display disconnects.
- Installs, verifies, and diagnoses the local Letta Code mod without rewriting global Letta settings.

Agent Halo intentionally stays local. It uses the public Letta Code mod surface, a local bridge, local credentials, and local logs. It does not depend on a hosted dashboard and does not use transcript parsing as its primary source of truth.

## Current status

Agent Halo is an actively used personal macOS app, not a public packaged release. The bridge, native overlay, multi-session model, Completion Pet, Pomodoro/Movement flow, Usage, Runtime, display placement, keep-awake, and setup/install paths are implemented and covered by browser/native regression checks.

The project still moves quickly. Session/process controls remain intentionally conservative: Agent Halo will not invent an “end session” or kill-process feature before Letta exposes a stable scoped API.

## Architecture

```text
Letta Code public mod events
  -> ~/.letta/mods/agent-halo.js
  -> local bridge on 127.0.0.1:47621
  -> SSE / snapshot / NDJSON log
  -> Tauri desktop notch overlay + terminal viewer
       ├─ Sessions / presence / Ghostty focus
       ├─ Usage / Runtime / keep-awake
       └─ Setup / display placement

Local Pomodoro state + macOS notifications
  -> collapsed notch countdown
  -> natural Focus completion
  -> Completion Pet
       ├─ Start break / Later / Close
       └─ explicit Movement Break
            -> one local camera stream
            -> bundled shoulder tracking
            -> prepared Short/Long break
```

The bridge exposes local-only endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Bridge status and capability metadata |
| `GET /snapshot` | Current capabilities and recent events |
| `GET /events` | Live Server-Sent Events stream |
| `POST /hook/stop` | Optional local Stop-hook bridge for turn completion fallback |
| `POST /hook/attention` | Local PermissionRequest-hook bridge for needs-input activity |
| `POST /ingest` | Multi-instance fan-in when another mod instance already owns the bridge port |

The bridge also writes a local NDJSON event log:

```text
~/.letta/mods/agent-halo.events.ndjson
```

See:

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/event-protocol.md`](docs/event-protocol.md)
- [`docs/presence-model.md`](docs/presence-model.md)
- [`docs/runtime-monitor.md`](docs/runtime-monitor.md)
- [`docs/pomodoro.md`](docs/pomodoro.md)
- [`docs/pet.md`](docs/pet.md)
- [`docs/movement-break.md`](docs/movement-break.md)
- [`docs/notchcode-parity.md`](docs/notchcode-parity.md)
- [`docs/performance.md`](docs/performance.md)

## Event coverage

Agent Halo currently consumes these Letta Code mod events when available:

- `conversation_open`
- `conversation_close`
- `turn_start`
- `tool_start`
- `tool_end`
- `compact_start`
- `compact_end`
- `llm_start`
- `llm_end`
- `turn_complete` from the installed Stop-hook relay
- `attention_requested` from `AskUserQuestion` tool lifecycle when available, or an explicitly connected PermissionRequest/Notification hook

The bridge keeps payloads intentionally small and privacy-aware. Tool results are represented by status and output length, not raw output. LLM activity stores model, stop reason, duration, and token counts. User text previews are disabled by default unless explicitly configured locally.

Lower-level Letta Code app-server/device protocol events such as queue, approval result, and process-control messages are not consumed. Agent Halo uses the supported local `PermissionRequest` hook only to signal that user attention is required; it does not inspect transcript text or claim access to the full internal approval queue.

## Usage providers

The Usage tab keeps every known provider discoverable. Providers Agent Halo can read locally show current metrics; unavailable/offline providers remain visible with the concrete local cause instead of disappearing.

Currently supported local providers:

- Codex
- Antigravity
- Claude Code
- Cursor
- Grok

Notes:

- Codex history and token trends come from local usage history where available.
- Antigravity usage is read from the local Antigravity/`agy` language server using the same quota-summary surface as `/usage`.
- Claude Code follows OpenUsage-informed local credential detection and refresh behavior where possible.
- Provider cards remain capability-aware; credential-present but unusable sessions should surface a status message instead of silently disappearing.

## Installation

### Requirements

- macOS
- Letta Code `0.28.x` recommended (`0.27.18+` has the core activity events, but capabilities vary by runtime)
- pnpm `10.x`
- Rust and the Tauri toolchain for desktop builds
- Camera permission only if the optional Movement Break is enabled and explicitly started

### Build and install the desktop app

```bash
pnpm install
pnpm desktop:install
open /Applications/Agent\ Halo.app
```

In Agent Halo, open **Setup** and choose **Install/Reinstall** to install the local Letta mod:

```text
~/.letta/mods/agent-halo.js
```

Then reload Letta Code:

```text
/reload
```

Setup also owns the global Pet, Completion Pet, Movement Break, keep-awake, and target-display preferences. Movement Break is Off by default and never opens the camera from Focus completion alone.

You can also install the mod directly from the repository:

```bash
pnpm mod:install
```

The installer also copies a local hook relay to `~/.letta/hooks/agent-halo-hook.mjs`. It deliberately does **not** rewrite global `~/.letta/settings.json`, so existing voice/safety hooks and concurrent Letta settings writes remain untouched. `AskUserQuestion` is observed directly when its tool lifecycle is available; runtimes that render it outside the local tool manager can connect an existing `Notification` voice hook to the relay. Completion-adjacent notifications are suppressed so ordinary finished turns do not become false needs-input activity. Generic `PermissionRequest` attention remains optional and requires explicitly registering the relay after active Letta sessions are closed.

## Development

Common commands:

```bash
pnpm check              # Typecheck root + desktop
pnpm test:demo          # Browser demo Playwright suite
pnpm test:hooks         # Local hook/mod integration checks
pnpm test:performance   # Bundle + model/bridge performance budgets
pnpm desktop:dev        # Run the Tauri desktop app in dev mode
pnpm desktop:install    # Build and install /Applications/Agent Halo.app
pnpm desktop:web        # Browser-only demo/dev server
pnpm viewer             # Terminal SSE viewer
pnpm mod:tail           # Tail the local NDJSON event log
```

Browser-only demo:

```bash
pnpm desktop:web
open http://127.0.0.1:47622/?demo=1
```

Run native Rust checks from the Tauri crate:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

The browser demo is useful for layout and interaction checks. Native behavior — mod install, Ghostty focus, menu-bar behavior, transparent window sizing, display placement, camera permission/release, notifications, and real event streams — must be validated in the Tauri desktop app.

## Project layout

```text
mods/agent-halo.js              Letta Code mod and local bridge
packages/protocol/              Shared event and presence model
apps/desktop/                   Tauri desktop notch overlay
apps/desktop/src/features/      Session, Pet, Pomodoro, Movement, Usage, Runtime, and Setup owners
apps/desktop/public/mediapipe/  Pinned offline Movement Break runtime/model assets
apps/viewer/                    Terminal event viewer
docs/                           Architecture, protocol, product contracts, parity, and performance notes
scripts/install-mod.mjs         Local mod installer
scripts/install-desktop.mjs     Desktop build/install helper
```

## Design direction

Agent Halo should feel like a quiet companion, not a generic AI dashboard. The interface follows a dark hardware-notch direction with compact workspace rows, hairline dividers, restrained orange/green state accents, and small Pet activity. Setup exposes the original companion roster as one global persisted Pet choice; Scorpion is the default and neither Pet identity nor color is randomized per project.

Natural Focus completion can summon a separate floating Pet without opening or focusing the full notch panel. The Pet owns presentation only; the main renderer remains the sole Pomodoro owner. If Movement Break is enabled, its camera surface follows the same compact black/green language with a white shoulder line, fixed green target, and short success celebration. See [`docs/pet.md`](docs/pet.md) and [`docs/movement-break.md`](docs/movement-break.md).

Design references and parity notes live in [`docs/notchcode-parity.md`](docs/notchcode-parity.md).

Runtime Pet strips remain in the legacy asset path:

```text
apps/desktop/public/mascots/agent-halo-roster/
```

Selected source masters, palette provenance, and QA evidence live in:

```text
apps/desktop/assets/mascots/agent-halo-roster/
```

## Privacy and local data

Agent Halo is built around local state:

- Bridge traffic stays on `127.0.0.1`.
- Events are written to `~/.letta/mods/agent-halo.events.ndjson`.
- Cleared completion tombstones and removed local session history are stored in desktop renderer local storage.
- Provider usage reads local credentials, CLIs, language servers, or local history where available.
- The bridge does not store raw tool output by default.
- Text preview capture is opt-in through local config and disabled by default.
- Movement Break camera capture starts only after an explicit 10-squat action. One ephemeral stream feeds both the mirrored preview and bundled local shoulder tracker; frames are never recorded, exported, or uploaded.
- The bundled MediaPipe WASM/model payload is loaded only for Movement Break and has no runtime CDN dependency.

## Known boundaries

- Real “end session” control is not exposed until Letta provides a stable scoped session/process API.
- Ghostty focus is a native fallback, not a guaranteed exact process/session focus API.
- `llm_*` and `compact_*` events are local-backend dependent.
- App-server queue/approval/result protocol support is intentionally deferred until there is a stable integration boundary.
- Browser demo checks cannot prove native Tauri or Ghostty behavior.
- Movement Break is interaction guidance, not exercise-form or medical advice; useful counting still requires real-camera foreground verification.

## Credits

Notch geometry and sheet anatomy are inspired by [Notchcode](https://github.com/billxby/notchcode) by Bill Xu, including its documented [DynamicNotchKit](https://github.com/MrKai77/DynamicNotchKit) lineage by Kai Azim. Both projects are MIT-licensed; see their upstream repositories for full license text.

The local usage-provider research and quota-reading approach is informed by [OpenUsage](https://github.com/robinebers/openusage) by Robin Ebers. Agent Halo implements its own local desktop integration, but OpenUsage was a useful reference for understanding provider credential locations and usage/quota surfaces.

The white-line/green-target Movement Break interaction was inspired by [DeskSquat](https://desksquat.app/). Agent Halo reimplements the idea inside its own Completion Pet/Pomodoro ownership model with one explicit local stream, bundled offline inference, and no camera recording or upload.
