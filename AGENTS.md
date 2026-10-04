# Agent Halo Agent Rules

## Project Reality

- Agent Halo is a local-first Letta Code presence companion and Tauri desktop app. Start with `README.md` and `docs/` for product, architecture, event protocol, and presence-model context.
- Agent Halo is the trusted producer for Mahiro Herdr Sidebar's normalized Cursor quota cache. After a successful direct `GetCurrentPeriodUsage` read, it may publish only the sanitized `cursor.json` snapshot. Sidebar stays read-only. Cursor hooks and the Cursor statusline do not carry account usage.
- Use `pnpm` only (`packageManager: pnpm@10.33.0`). Do not add npm/yarn lockfiles.
- Preserve local/generated state. `.agent-state/`, `.letta/`, `.cocoindex_code/`, `node_modules/`, build output, and test reports are ignored local state.
- Use kebab-case for filenames under `apps/desktop/src`; when renaming a file, update every static import, dynamic import, and test path while keeping exported component/type symbols in their semantic casing.
- After changing `mods/agent-halo.js`, install/reload the Letta mod before judging live behavior. After native desktop changes, run an appropriate desktop check/build/install path.
- For persisted UI settings or layouts, browser coverage that keeps the component mounted is not sufficient. Test the real `A → B → panel unmount/remount → B` lifecycle, then verify the installed native Tauri build before claiming persistence; this applies to Usage visibility/layout and Setup preferences, but not static paint-only changes.
- Do not commit or push unless explicitly asked.

## Codebase Search

- Start with a known path, symbol, process, error, or nearby behavior. Use `rg --files` for paths and `rg` for exact strings/imports; read selected source before making behavior claims.
- When ownership is unclear, search likely module directories and callers, then broaden only if the first hypothesis fails. Exact-string absence does not prove a behavior is absent.
- Use AST-aware search for syntax-shaped questions when available. Do not open suspected secret contents during discovery.

## Validation Commands

- TypeScript/workspace check: `pnpm check`
- Browser demo regression: `pnpm test:demo`
- Hook integration tests: `pnpm test:hooks`
- Baseline-grounded bundle/session/bridge budgets: `pnpm test:performance`
- Desktop web build: `pnpm desktop:web:build`
- Native desktop build/install: `pnpm desktop:build` or `pnpm desktop:install`
- Rust-only native check: run `cargo check` from `apps/desktop/src-tauri/`

## Docs Map

- `docs/onboarding.md` - first-run setup and verification path
- `docs/project-overview.md` - current runtime, bridge, and desktop shape
- `docs/development-commands.md` - verified development, build, format, lint, and test commands
- `docs/file-organization.md` - source ownership and kebab-case naming
- `docs/best-practices.md` - conservative component, hook, state, and verification guidance
- `docs/commit-guide.md` - history-derived commit baseline
- `docs/styling.md` - CSS-first visual ownership and shared primitives
- `docs/api-data-fetching.md` - local bridge, Tauri command, and provider data boundaries
- `docs/code-style/` - TypeScript, imports, and formatting contracts
- `docs/patterns/` - component, hook, and state patterns
- Existing domain contracts remain in `docs/architecture.md`, `docs/battery-sleep.md`, `docs/event-protocol.md`, `docs/presence-model.md`, `docs/runtime-monitor.md`, `docs/pet.md`, `docs/movement-break.md`, `docs/pomodoro.md`, `docs/stopwatch.md`, `docs/notchcode-parity.md`, and `docs/performance.md`.
