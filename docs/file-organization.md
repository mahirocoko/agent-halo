# File Organization

## Project Structure

```text
agent-halo/
├── adapters/                 # Provider hook and bridge-side adapters
├── apps/
│   ├── desktop/              # Tauri desktop app and browser demo
│   └── viewer/               # Terminal SSE viewer
├── docs/                     # Architecture, protocol, product, and engineering docs
├── hooks/                    # Local hook relay source
├── mods/                     # Letta Code mod and bridge owner
├── packages/protocol/        # Shared event/presence TypeScript contracts
├── scripts/                  # Install, benchmark, asset, and budget scripts
├── AGENTS.md                 # Repository policy
├── README.md                 # Product overview and quick commands
└── package.json              # Workspace scripts and toolchain
```

## Desktop App Structure

```text
apps/desktop/
├── src/
│   ├── components/           # Small cross-feature UI primitives
│   ├── features/             # Feature-owned components, hooks, models, and persistence
│   ├── styles/               # Ordered CSS cascade owners
│   └── main.tsx              # Shell, query-surface routing, native orchestration
├── src-tauri/                # Rust/Tauri commands, windows, macOS integration
├── public/                   # Runtime-served static assets and pose assets
├── tests/                    # Playwright browser demo specs
└── package.json              # Desktop-local Vite/Tauri commands
```

## Route Structure

There is no router package or route directory. `apps/desktop/src/main.tsx` selects the main or Pet surface from query parameters and composes the feature panels. Keep query-surface selection and native-window coordination in the shell; keep feature behavior in its feature owner.

## Data Ownership Structure

- Bridge events and snapshots belong to the local bridge/mod/adapters boundary.
- Protocol normalization and presence derivation belong in `packages/protocol/` or the established session/presence feature owners.
- Provider-specific usage reads belong in `apps/desktop/src/features/usage/` and native/provider adapters, not in presentational cards.
- Tauri commands and native process/display/camera/notification work belong in `apps/desktop/src-tauri/`.
- There is no general `services/` layer; do not create one for a single local data path.

## File Naming Conventions

### Components and modules

- Use kebab-case for filenames under `apps/desktop/src`, including component and hook files (`setup-panel.tsx`, `use-stopwatch.ts`).
- Keep exported React component symbols in PascalCase and hook symbols in `useX` form.
- Keep feature-specific modules inside their owning `features/<feature>/` folder.

### Hooks

- Hook filenames use kebab-case; hook exports use `useX` naming.
- Hooks own reusable behavior first. Transport/data ownership stays with the existing local adapter or feature boundary.

### Types and constants

- Keep types near their feature owner unless the protocol is shared.
- Mahiro-style interface contracts use an `I` prefix; type aliases stay unprefixed.
- Constants use explicit uppercase names when they are module-level contracts.

### Tests

- Browser specs live in `apps/desktop/tests/` and use descriptive kebab-case filenames.
- Dynamic import paths in tests must match the case and kebab-case of source files.

## Component Organization

Shared components belong in `apps/desktop/src/components/` only when the boundary is domain-neutral and used by multiple features. Feature-specific composition belongs in the feature folder. `BoardSurface` and `SurfaceControl` own reusable shell/control semantics; callers should mainly own layout and content.

## Placement Rules

- Keep logic with its real owner until repeated cross-owner pressure proves a shared boundary.
- Add a shared hook or primitive when the same behavior appears across multiple real consumers and its contract is domain-neutral.
- Do not introduce future `routes/`, `services/`, `stores/`, or `i18n/` folders without an earned owner and a concrete consumer.
