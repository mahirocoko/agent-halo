# Import Guidelines

## Import Order

Biome organizes imports when the scoped format command runs:

```bash
pnpm format
```

Current order is external packages, workspace packages, relative modules, and type-only specifiers grouped by the formatter. Do not hand-maintain a competing ordering rule.

## Type Imports

Use `type` for type-only imports:

```ts
import type { ComponentPropsWithRef } from 'react'
import { BoardSurface } from '../../components/board-surface'
```

## Relative Imports and Aliases

- The desktop source currently uses relative imports and the `@agent-halo/protocol` workspace package.
- No source-root alias such as `@/` is established; do not invent one for a small local edit.
- Keep relative paths aligned with the kebab-case filename on disk.

## Dynamic Imports

The shell uses dynamic imports for large or separate surfaces such as the Pet and Setup panels. Keep those imports pointing at the file path owner and update them during any rename.

## Exports

- Feature modules commonly use named exports.
- Components and hooks keep semantic exported symbols even though their filenames are kebab-case.
- Barrel files are not an established pattern; do not add one without a real import-boundary benefit.

## Duplicate and Unused Imports

Biome's scoped check organizes imports and the lint gate reports unused or invalid imports. Run `pnpm quality` before handoff.
