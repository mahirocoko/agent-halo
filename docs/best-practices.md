# Best Practices

This page combines current repo behavior with a conservative preferred direction. Current code and active domain docs remain authoritative.

## Always Run Verification Commands

```bash
pnpm quality
```

Add `pnpm test:demo` for visible desktop behavior and native checks for Tauri/bridge changes.

## Type and Export Contracts

- Keep `strict` TypeScript enabled and avoid `any`; prefer `unknown` plus a checked domain type.
- Use `I`-prefixed interfaces for authored public contracts and unprefixed type aliases.
- Use explicit `type` imports for type-only dependencies.
- Keep exported types close to the implementation when that is the owner boundary.

## Component Practices

- Keep shell/native orchestration in `main.tsx` and feature behavior in feature owners.
- Use local components for one-owner composition; extract shared UI only after repeated cross-feature need is real.
- Prefer semantic native elements and existing local primitives before adding copied controls.
- Treat browser accessibility and geometry tests as technical evidence, not as a substitute for native or human visual review.

## Hook Practices

- Keep hooks focused on one behavior boundary: DOM interaction, persistence, derived state, or feature orchestration.
- Use `useMemo`/`useCallback` when stable identity or measured work justifies it, not by habit.
- Audit effect dependencies against actual captures; do not silence dependency findings without documenting the ownership reason.
- Keep persistence transitions explicit, including reload, reset, empty, error, and stale states.

## Styling Practices

- Preserve CSS-first ownership and the ordered imports in `apps/desktop/src/styles.css`.
- Prefer existing semantic variables and shared primitives over one-off palette, border, radius, or shadow recipes.
- Keep feature styling in the owning stylesheet; extend shared primitives only for a genuinely cross-feature visual contract.
- Validate the rendered consumer and relevant responsive state; class presence alone is not visual proof.

## Local Data and Privacy

- Keep bridge traffic on loopback and avoid raw tool output or user text by default.
- Keep credentials and OAuth metadata in ignored local locations; never put them in source, docs, logs, screenshots, or tests.
- Movement Break camera streams are explicit, ephemeral, local, and not recorded or uploaded.
- Preserve capability-aware unavailable/error states instead of hiding unsupported providers or inventing controls.

## Preferred Direction

- Keep owner-local code as the default until a domain-neutral boundary is proven.
- Split files when one owner mixes unrelated responsibilities; do not create abstraction layers only to make a tree look uniform.
- Treat every persisted user setting as a lifecycle: read, modify, reset, persist, reload, and failure behavior.
