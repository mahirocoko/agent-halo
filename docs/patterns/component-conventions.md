# Component Conventions

## Current Reality

- Shared cross-feature primitives live in `apps/desktop/src/components/`.
- Feature-specific components and presentational partials stay in `apps/desktop/src/features/<feature>/`.
- Components use typed props, named exports, native semantic elements, and local CSS classes/data attributes.
- `BoardSurface`, `BoardScroll`, `SurfaceControl`, `SurfaceStatus`, and `ResizableCardDivider` own reusable shell/control contracts.

## Organization

For a growing component, keep this order where it improves scanning:

1. imports
2. interfaces/types
3. constants and pure helpers
4. component definition
5. hooks and derived values
6. event/effect helpers
7. returned JSX

Use section comments sparingly. A long file that needs many dividers is a split signal, not a reason to add labels everywhere.

## Props and Composition

Use explicit `I...Props` interfaces for public component contracts and preserve native props when the primitive wraps a DOM element:

```tsx
interface IPanelProps extends ComponentPropsWithRef<'section'> {
  tone: BoardSurfaceTone
}
```

Keep owner-local copy, options, and data with the feature. Compose a shared primitive only when the same behavior and visual contract are used by multiple real owners.

## Interaction and Accessibility

- Prefer native buttons, sections, fieldsets, labels, and disclosure elements.
- Keep keyboard and pointer behavior on the element that owns the state.
- Use browser tests for concrete role, focus, geometry, overflow, and state regressions.
- Do not turn a technical verifier's semantic preference into a product change without a separate product decision.

## Preferred Direction

Keep the shell thin and let feature components own feature behavior. Split a component when it mixes unrelated transport, persistence, native orchestration, and presentation responsibilities.
