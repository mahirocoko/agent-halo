# Development Commands

Commands below are verified from the repository scripts and current README.

## Quick Start

```bash
pnpm install
pnpm quality
```

## Development

```bash
pnpm desktop:web       # Browser-only Vite demo on 127.0.0.1:47622
pnpm desktop:dev       # Tauri desktop development app
pnpm viewer             # Terminal SSE viewer
pnpm mod:tail           # Tail the local bridge NDJSON log
```

The browser demo uses `?demo=1` and optional `demoScenario` query values. It is useful for deterministic UI checks, not proof of native macOS behavior.

## Building

```bash
pnpm desktop:web:build  # Frontend production build
pnpm desktop:build      # Tauri native build
pnpm desktop:install    # Build/install the macOS app
```

Native Rust checks can run without launching the app:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Linting and Formatting

```bash
pnpm format             # Biome format + import organization for biome.json, package.json, and apps/desktop/src
pnpm format:check       # Check the same source scope
pnpm lint               # Clean scoped lint gate for the refactored shared/Usage owners
pnpm lint:desktop       # Inventory all desktop-source findings; legacy findings remain
pnpm quality            # format:check + lint + check
```

The broader source lint inventory is intentionally separate from the clean scoped gate while the existing codebase is migrated. `format:all`, `format:check:all`, and `lint:all` cover the repository-wide scope when a deliberate migration is approved.

## Type Checking

```bash
pnpm check
```

This runs the root protocol TypeScript check and the desktop TypeScript check.

## Testing

```bash
pnpm test:demo
pnpm test:hooks
pnpm test:performance
```

Use one Playwright worker during local iteration when possible. Native bridge, display, camera, notification, Ghostty, and menu-bar behavior still needs a native app check.

## Dependency Management

```bash
pnpm install
pnpm add <package>
pnpm add -D <package>
```

Use pnpm only and keep the workspace lockfile authoritative.

## Verification Cadence

For normal source changes:

```bash
pnpm quality
```

For visible desktop changes, add:

```bash
pnpm test:demo
```

For bridge/native changes, add the relevant Rust/native build or install check. Do not claim browser checks prove native behavior.
