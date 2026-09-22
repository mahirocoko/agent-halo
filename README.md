# Agent Halo

<p align="center">
  <img src="apps/desktop/assets/agent-halo-app-icon.png" alt="Agent Halo app icon" width="128" height="128" />
</p>

<p align="center">
  A local macOS companion for AI coding agents — live presence, workspace sessions, focus rituals, and private local tooling around the notch. Supports Letta Code and AGY (Antigravity).
</p>

<p align="center">
  <strong>Local-first</strong> · <strong>Mod-driven</strong> · <strong>Notch-native</strong>
</p>

---

## Overview

Agent Halo is a native desktop companion for AI coding agents, currently supporting [Letta Code](https://docs.letta.com/letta-code/index.md) and [AGY (Antigravity)](https://antigravity.google). It runs around the macOS camera notch, listens to trusted agent events, and turns agent activity into a compact live presence surface.

The desktop companion uses a view-owned panel width (Sessions 560, Focus 540, Usage 700, Runtime 660, Services 620, Setup 640, session detail 520; max height 440px; min/screen-capped) with Agent Halo-owned discrete tabs and one material board per view:
- **Collapsed Hardware Notch**: Preserves Notchcode / boring.notch hardware-notch integration at rest (SVG path, collapsed pill, activity status glyphs, and Pomodoro countdown).
- **Top-Level Navigation**: Transparent rail with discrete tab buttons and small pastel signal underline, plus separate circular Setup and Close buttons. Responsive icon collapsing at narrow widths.
- **Top-Level Tabs**:
  - **Sessions**: Real agent conversations grouped into Active and Completed sections, showing compact project/status/model/age context with reachable focus/detail/clear actions (mint `#7fba8f` surface).
  - **Focus**: Pomodoro countdown, phase progress, and quick action controls, with independent Pomodoro, Stopwatch, and Move challenge tools (lavender `#b59ae0` surface).
  - **Usage**: Local quota/token views for known AI providers, including truthful unavailable/offline diagnostics (ochre `#e0b86a` surface).
  - **Runtime**: Read-only Letta host/subprocess CPU and memory pressure, with no process controls (navy `#1a3350` surface).
  - **Services**: Local TCP/HTTP listeners grouped into Detected web frontends, Letta services, and Other listeners, with expandable process detail, browser-open actions, and guarded Stop → Force kill controls for eligible current-user listener processes (teal `#154038` surface).
- **Setup Surface**: Separate circular gear button opening a parchment `#f0d49a` surface for bridge diagnostics, Pet customization, display placement, and preferences.

## Product surfaces

| Surface | Current role |
| --- | --- |
| **Sessions** | Workspace-grouped Letta conversations, truthful activity state, sticky completion history, detail, clear/dismiss, exact Herdr-pane focus when available, and Ghostty fallback |
| **Focus** | Independent Pomodoro, Stopwatch, and Move tools; Pomodoro keeps custom phases and silent alerts, while Stopwatch adds reload-safe elapsed tracking and clearable local history |
| **Usage** | Local quota/token views for known AI providers, including truthful unavailable/offline diagnostics |
| **Runtime** | Read-only Letta host/subprocess CPU and memory pressure, with no process controls |
| **Services** | Local TCP/HTTP listeners grouped into Detected web frontends, Letta services, and Other listeners, with expandable process detail, browser-open actions, and guarded Stop → Force kill controls for eligible current-user listener processes |
| **Setup** | Separate circular gear action and surface for connection/mod install, global Pet choice and size, Completion Pet and **Offer movement after Focus** settings, keep-awake, and target-display selection |
| **Pet** | A separate passively shown, non-focus-stealing Pet window: Focus completion retains Start break/Later/Close and notification handoff; a manual companion persists until Hide and offers deliberate Focus navigation and movement; setup preview is dismiss-only |
| **Movement Break** | Explicit Squat or Overhead Reach challenge from Focus exact-exercise buttons or the Pet chooser, using one local camera stream, exercise-specific tracking, live progress, and bundled offline pose inference |

## What Agent Halo does

- Projects live Letta Code lifecycle, turn, model, tool, compaction, completion, and needs-input activity into a compact notch surface.
- Keeps recent conversations in workspace groups, including distinct subagent/default lanes, sticky completed rows, per-session context, and guarded clear/dismiss behavior.
- Focuses the exact Herdr pane when trusted runtime identity is present, then falls back to native Ghostty cwd/title/session matching.
- Tracks local AI usage and read-only Letta/subprocess pressure without hiding known providers or adding Runtime process controls.
- Lists locally listening TCP services in a dedicated Services tab, separates strongly evidenced browser apps first, exact Letta-started non-web services second, and other listeners last; expands into bounded process/start/memory/parent/executable/cwd context plus trusted Letta/Herdr ancestry, reserves the green service dot for web evidence only, opens detected HTTP endpoints, and can stop an eligible current-user listener only after exact native identity revalidation and confirmation.
- Runs independent local Pomodoro and Stopwatch tools together, with persisted deadlines/elapsed time, collapsed status, silent Pomodoro notifications, clearable Stopwatch history, and a projection-only Pet; the main renderer remains the sole Pomodoro/notification owner.
- Offers Squat and Overhead Reach Movement Breaks only after a specific exercise click, either from Focus Move or the Pet chooser; preview and pose tracking share one local stream and bundled offline assets, and manual movement never mutates Pomodoro.
- Keeps the display awake only while genuine visible Letta work is active.
- Remembers the selected display for the notch and Pet, with safe Primary fallback when that display disconnects.
- Installs, verifies, and diagnoses the local Letta Code mod without rewriting global Letta settings.

Agent Halo intentionally stays local. It uses the public Letta Code mod surface and AGY hooks API, a local bridge, local credentials, and local logs. The desktop app supervises a bundled standalone bridge whenever no existing Agent Halo bridge is reachable, so AGY presence does not require Letta Code to be open. It does not depend on a hosted dashboard and does not use transcript parsing as its primary source of truth.

## Current status

Agent Halo is an actively used personal macOS app, not a public packaged release. The bridge, native overlay, multi-session model, Completion Pet, Focus/Movement flow, Usage, Runtime, Services, display placement, keep-awake, and setup/install paths are implemented and covered by browser/native regression checks. The local-service lane additionally has parser/native compile coverage, browser demo coverage, and live macOS evidence that structured `lsof` sees Bun/Python listeners while bounded HTTP evidence distinguishes a Bun browser app from Python directory listings and AirTunes. Known local projects may opt into the bounded explicit registry documented in `docs/runtime-monitor.md`. The installed app remains the final visual/product check for the real machine state.

The project still moves quickly. Session controls remain intentionally conservative: Agent Halo does not invent an “end session” capability before Letta exposes a stable scoped API. Services process control is a separate desktop-native boundary limited to exact current-user listener identities; it does not terminate a Letta conversation or enable bridge `sessionActions.endSession`.

## Architecture

```text
Letta Code public mod events / AGY lifecycle hooks
  -> ~/.letta/mods/agent-halo.js (Letta)
  -> adapters/agy/agent-halo-agy-hook.mjs (AGY)
  -> local bridge on 127.0.0.1:47621
  -> SSE / snapshot / NDJSON log
  -> Tauri desktop notch overlay + terminal viewer
       ├─ Sessions / presence / Herdr + Ghostty focus
       ├─ Usage / Runtime / Services / keep-awake
       └─ Setup / display placement

Local Pomodoro state + macOS notifications (main renderer only)
  -> collapsed notch countdown
  -> natural Focus completion
  -> Focus-completion Pet
       ├─ Start break / Later / Close + notification handoff
       └─ optional movement chooser -> prepared Short/Long break

Focus Move
  -> exact Squat/Reach button or manual companion chooser
  -> one local camera stream + bundled pose tracking
  -> return to manual companion; no Pomodoro mutation

Local Stopwatch state + bounded history
  -> reload/sleep-safe elapsed time
  -> collapsed secondary context beside Pomodoro
  -> Finish / Discard / clearable saved sessions
```

The bridge exposes local-only endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Bridge status and capability metadata |
| `GET /snapshot` | Current capabilities and recent events |
| `GET /events` | Live Server-Sent Events stream |
| `POST /hook/stop` | Optional local Stop-hook bridge for turn completion fallback |
| `POST /hook/attention` | Local PermissionRequest-hook bridge for needs-input activity |
| `POST /ingest` | Multi-provider fan-in: secondary Letta instances, AGY adapters, and other event sources post here |

The bridge also writes a local NDJSON event log:

```text
~/.letta/mods/agent-halo.events.ndjson
```

Bridge ownership is fail-closed and local: every bridge owner and relay normalizes to the canonical IPv4 loopback host `127.0.0.1`. The desktop reuses a healthy Agent Halo bridge when Letta or another standalone owner already serves the configured port. It starts its bundled fallback only after a refused loopback connection, treats timeout or ambiguous failures as occupied, never replaces an unrelated listener, and stops the child it owns when the app exits.

See:

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/event-protocol.md`](docs/event-protocol.md)
- [`docs/presence-model.md`](docs/presence-model.md)
- [`docs/runtime-monitor.md`](docs/runtime-monitor.md)
- [`docs/pomodoro.md`](docs/pomodoro.md)
- [`docs/stopwatch.md`](docs/stopwatch.md)
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

Notes:

- Codex history and token trends come from local usage history for the resolved local home where available; it is never labelled as a separately selected account until Agent Halo has account-card UI.
- Codex condenses available local history into Today/Yesterday, a 30-day trend, a short model mix, and an optional daily detail disclosure. The surface labels that data as an estimate from this home.
- Antigravity usage first reads the local Antigravity/`agy` language server, then falls back to Cloud Code with the existing `gemini`/`antigravity` Keychain credential when the language server is unavailable or not signed in.
- If an Antigravity refresh token must be refreshed, Agent Halo reads locally supplied OAuth client metadata from `AGENT_HALO_AGY_GOOGLE_CLIENT_ID`/`AGENT_HALO_AGY_GOOGLE_CLIENT_SECRET` or the local ignored file `~/.config/agent-halo/agy-google-oauth.json`; these values must never be committed.
- Claude Code tries valid local Keychain/file logins before an inference-only environment token and refreshes only back into the source that produced the credential.
- Provider cards remain capability-aware; a failed refresh preserves last-good metrics with an explicit Outdated/error state instead of silently disappearing.

### Antigravity OAuth refresh setup (local only)

The existing `gemini`/`antigravity` Keychain access token is enough for normal Cloud Code reads. This extra setup is needed only when Agent Halo must exchange an Antigravity `refresh_token` for a new access token. The OAuth client ID and secret are installed-app client metadata, but GitHub Push Protection still treats the values as credentials; never place them in tracked source, a committed `.env`, logs, prompts, screenshots, or chat messages.

An AI or operator working on the user's Mac may create the ignored local config when both values are already available from an authorized local environment or provider installation. The setup must not print the values:

```bash
test -n "${AGENT_HALO_AGY_GOOGLE_CLIENT_ID:-}" \
  && test -n "${AGENT_HALO_AGY_GOOGLE_CLIENT_SECRET:-}" \
  || { echo "Set the two AGY OAuth variables from an authorized local source first." >&2; exit 1; }

umask 077
/usr/bin/python3 - <<'PY'
import json
import os
from pathlib import Path

path = Path.home() / ".config" / "agent-halo" / "agy-google-oauth.json"
path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
path.write_text(json.dumps({
    "client_id": os.environ["AGENT_HALO_AGY_GOOGLE_CLIENT_ID"],
    "client_secret": os.environ["AGENT_HALO_AGY_GOOGLE_CLIENT_SECRET"],
}) + "\n")
path.chmod(0o600)
print(path)
PY
```

If no authorized local source is available, stop and ask the user to set the variables or create that file themselves. Do not invent values, ask the user to paste a secret into chat, or commit the local file. The app can still use a currently valid Keychain access token without this refresh configuration.

## Installation

### Requirements

- macOS
- Letta Code `0.30.x` recommended and verified through `0.30.14` (`0.27.18+` has the core activity events, but capabilities vary by runtime; reflection child processes on `0.30.14+` intentionally do not load mods)
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

Setup also owns the global Pet, Completion Pet, **Offer movement after Focus**, keep-awake, and target-display preferences. The Focus-completion movement offer is Off by default; manual Move remains available, and no path opens the camera before a specific exercise click.

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

The browser demo is useful for layout and interaction checks. Native behavior — mod install, Herdr/Ghostty focus, menu-bar behavior, transparent window sizing, display placement, camera permission/release, notifications, and real event streams — must be validated in the Tauri desktop app.

## Project layout

```text
mods/agent-halo.js              Letta Code mod and local bridge
packages/protocol/              Shared event and presence model
apps/desktop/                   Tauri desktop notch overlay
apps/desktop/src/features/      Session, Pet, Pomodoro, Stopwatch, Movement, Usage, Runtime, and Setup owners
apps/desktop/public/mediapipe/  Pinned offline Movement Break runtime/model assets
apps/viewer/                    Terminal event viewer
docs/                           Architecture, protocol, product contracts, parity, and performance notes
scripts/install-mod.mjs         Local mod installer
scripts/install-desktop.mjs     Desktop build/install helper
```

## Design direction

Agent Halo should feel like a quiet companion, not a generic AI dashboard. The collapsed hardware notch stays dark; open views use Halo-owned pastel boards (mint Sessions, lavender Focus, ochre Usage, navy Runtime, teal Services, parchment Setup) with ink and status tokens remapped on each board instead of the old orange-on-black recipe. Compact workspace rows, hairline dividers, and small Pet activity remain. Setup exposes only Halo Bot and Haloform as one global persisted Pet choice. Halo Bot is the fresh default and exposes all 10,752 combinations from the pinned 43-part Pixabots catalog through four layered selectors; Haloform uses an approved provider-derived native96 CRT master with explicit semantic masks. Retired stored Pet IDs normalize to Halo Bot, and neither identity nor color is randomized per project. A separate persisted Letta-state motion map may redirect body presentation (for example, Working → Idle motion) without changing truthful status, Signal V4, or Keep display awake semantics.

Natural Focus completion can summon a separate floating Pet without opening or focusing the full notch panel. The Pet owns projection only; the main renderer remains the sole Pomodoro and notification owner. That Focus-completion purpose retains Start break/Later/Close and its notification handoff, with an optional **Offer movement after Focus** chooser. Independently, Focus Move can show a manual companion or launch a specific Squat/Reach exercise; it mirrors main-projected state and Signal V4, returns after manual movement, and never mutates Pomodoro. Every camera path starts only after the exact exercise click, using the shared compact black/green camera surface with exercise-specific white/green tracking guides. Setup preview is dismiss-only. See [`docs/pet.md`](docs/pet.md) and [`docs/movement-break.md`](docs/movement-break.md).

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
- Movement Break camera capture starts only after an explicit Squat or Overhead Reach action. One ephemeral stream feeds both the mirrored preview and bundled local pose tracker; frames are never recorded, exported, or uploaded.
- The bundled MediaPipe WASM/model payload is loaded only for Movement Break and has no runtime CDN dependency.

## Known boundaries

- Real “end session” control is not exposed until Letta provides a stable scoped session/process API.
- Herdr identity can focus an exact pane; Ghostty matching remains a native fallback. Neither is a Letta process/session-control API.
- `llm_*` and `compact_*` events are local-backend dependent.
- App-server queue/approval/result protocol support is intentionally deferred until there is a stable integration boundary.
- Browser demo checks cannot prove native Tauri or Ghostty behavior.
- Movement Break is interaction guidance, not exercise-form or medical advice; useful counting still requires real-camera foreground verification.

## Credits

Notch geometry and sheet anatomy are inspired by [Notchcode](https://github.com/billxby/notchcode) by Bill Xu, including its documented [DynamicNotchKit](https://github.com/MrKai77/DynamicNotchKit) lineage by Kai Azim. Both projects are MIT-licensed; see their upstream repositories for full license text.

The local usage-provider research and quota-reading approach is informed by [OpenUsage](https://github.com/robinebers/openusage) by Robin Ebers. Agent Halo implements its own local desktop integration, but OpenUsage was a useful reference for understanding provider credential locations and usage/quota surfaces.

The white-line/green-target Movement Break interaction was inspired by [DeskSquat](https://desksquat.app/). Agent Halo reimplements the idea inside its own projection-only Pet and main-renderer Pomodoro ownership model with one explicit local stream, bundled offline inference, and no camera recording or upload.
