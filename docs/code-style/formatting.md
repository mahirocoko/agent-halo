# Formatting (Biome)

## Current Reality

- **Formatter**: Biome 2.5.14.
- **Config**: `biome.json`.
- **Auto-run posture**: manual package scripts; no commit hook currently enforces it.
- **Source scope**: `biome.json`, `package.json`, and `apps/desktop/src` for the normal command.

## Formatting Commands

```bash
# Check source formatting and import organization
pnpm format:check

# Apply source formatting and import organization
pnpm format

# Check/fix the full configured repository scope deliberately
pnpm format:check:all
pnpm format:all

# Check the normal scoped quality gate
pnpm quality
```

## Core Rules

- Indent with 2 spaces.
- Use single quotes for JavaScript/TypeScript and double quotes for JSX attributes.
- Omit semicolons where possible.
- Use a 120-column line width.
- Keep trailing commas according to Biome's `all` setting.
- Let Biome organize imports rather than manually creating a second ordering convention.

## Lint Boundary

The clean `pnpm lint` gate currently covers the refactored shared-card and Usage owners. `pnpm lint:desktop` inventories all desktop source findings while the legacy migration is still open; do not report it as clean until its errors are resolved or an explicit baseline policy is adopted.
