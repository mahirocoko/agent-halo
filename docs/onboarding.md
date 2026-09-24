# Agent Halo Onboarding

This is the practical onboarding path for the local macOS desktop companion. Use `AGENTS.md` as the full repository policy source; use this page to find the first commands and the right docs.

## 1) Start Here

Install dependencies:

```bash
pnpm install
```

Run the normal source checks:

```bash
pnpm quality
```

`quality` covers the current scoped Biome format/lint gate plus TypeScript checks. `pnpm lint:desktop` is available for the broader desktop lint inventory; it currently reports legacy findings and is not a clean gate yet.

Run the browser demo when the change affects the desktop surface:

```bash
pnpm test:demo
```

Build or install the native app when the change crosses the Tauri/native boundary:

```bash
pnpm desktop:build
pnpm desktop:install
```

Do not start a long-running dev server as part of a routine inspection. When browser work is needed, run `pnpm desktop:web` deliberately and use the demo query (`?demo=1`) for deterministic local states.

## 2) Architecture Snapshot

- **Runtime**: React 19 + TypeScript in a Vite frontend embedded by Tauri 2 on macOS.
- **Bridge**: local `127.0.0.1:47621` SSE/snapshot/NDJSON bridge fed by the Letta mod and AGY hook adapter.
- **Data access**: local bridge fetches, Tauri `invoke` commands, and provider-specific local adapters; no hosted API client.
- **State**: React local state/hooks plus explicit localStorage and native persistence; no shared client-state library is established.
- **Styling**: CSS-first custom properties and ordered stylesheets, with small local React primitives in `apps/desktop/src/components/`.
- **i18n**: Not established; user-facing copy is currently local English JSX/string data.

## 3) Where to Work

- Desktop shell and native orchestration: `apps/desktop/src/main.tsx`
- Shared UI primitives: `apps/desktop/src/components/`
- Feature owners: `apps/desktop/src/features/<feature>/`
- CSS cascade owners: `apps/desktop/src/styles/`
- Shared event/presence types: `packages/protocol/src/`
- Letta mod and bridge: `mods/` and `adapters/bridge/`
- AGY hook adapter: `adapters/agy/`
- Native Tauri implementation: `apps/desktop/src-tauri/`

## 4) Docs Map

### Core

- `AGENTS.md`
- `docs/project-overview.md`
- `docs/development-commands.md`
- `docs/file-organization.md`
- `docs/best-practices.md`
- `docs/commit-guide.md`

### Code Style and Patterns

- `docs/styling.md`
- `docs/api-data-fetching.md`
- `docs/code-style/typescript.md`
- `docs/code-style/imports.md`
- `docs/code-style/formatting.md`
- `docs/patterns/component-conventions.md`
- `docs/patterns/hooks-pattern.md`
- `docs/patterns/state-management.md`

### Existing Domain Contracts

Read the domain page before changing its owner: architecture, event protocol, presence model, runtime monitor, Pet, Movement Break, Pomodoro, Stopwatch, Notchcode parity, and performance docs are listed in `AGENTS.md`.

## 5) Repo-Specific Rules

- Keep bridge and provider data local; do not add hosted telemetry or transcript parsing as a shortcut.
- Use kebab-case for filenames under `apps/desktop/src`; keep exported component/type symbols in semantic casing.
- Preserve the CSS import order and style ownership in `apps/desktop/src/styles/`.
- Keep local UI state with its feature owner until repeated cross-owner pressure proves a shared boundary.
- Browser demo evidence does not prove native Tauri, Ghostty, display, camera, notification, or menu-bar behavior.

## 6) Suggested Reading Paths

### New contributor

Read `AGENTS.md`, then this page, `docs/project-overview.md`, `docs/file-organization.md`, and `docs/development-commands.md`.

### Feature work

Read the relevant domain contract, then the matching code-style/pattern page before extracting or moving ownership.

### Native or bridge work

Read `docs/architecture.md`, `docs/event-protocol.md`, and the relevant runtime/presence page before changing the protocol boundary.
