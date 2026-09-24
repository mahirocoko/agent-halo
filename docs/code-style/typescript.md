# TypeScript Guidelines

## Configuration

- **Strict mode**: enabled in `tsconfig.json` and `apps/desktop/tsconfig.json`.
- **No implicit any / strict null checks**: covered by strict mode.
- **Module resolution**: NodeNext at the workspace root and Bundler for the Vite desktop app.
- **Base configs**: `tsconfig.json` and `apps/desktop/tsconfig.json`.

## Naming Conventions

- Interfaces authored in this repo use an `I` prefix (`ISetupPanelProps`, `IResizableCardLayout`).
- Type aliases use PascalCase without an `I` prefix.
- React components use PascalCase exports; hooks use `useX` exports.
- Filenames under `apps/desktop/src` use kebab-case.

## Type Imports and Exports

Use explicit type-only imports:

```ts
import type { AgentHaloPresenceStatus } from '@agent-halo/protocol'
import { useMemo } from 'react'
```

Keep public contracts near their owner. Shared event and presence contracts belong in `packages/protocol/`; feature contracts stay in the feature folder.

## Avoid `any`

Prefer `unknown` plus a runtime/type guard when an external local payload is not trusted:

```ts
const parsed: unknown = JSON.parse(raw)
if (!isUsageSnapshot(parsed)) return null
```

## Preferred Direction

- Keep domain signal in names when a type or helper crosses a feature boundary.
- Use utility types for projections rather than duplicating shape declarations.
- Keep interfaces for extendable/public object contracts and aliases for unions, literals, and simple projections.
