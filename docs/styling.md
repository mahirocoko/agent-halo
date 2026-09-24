# Styling

## Current Reality

- Styling is CSS-first. The app does not use Tailwind, CSS Modules, or a utility-class compiler.
- `apps/desktop/src/styles.css` imports ordered feature and surface stylesheets; import order is part of cascade ownership.
- CSS custom properties and semantic surface classes carry ink, fill, border, focus, and status roles.
- Small shared React primitives in `apps/desktop/src/components/` provide board surfaces, controls, statuses, and resizable-card dividers.
- Feature styles remain in `apps/desktop/src/styles/` rather than being colocated beside every component.

## Preferred Direction

- Reuse the existing semantic variables and primitive contracts before adding raw colors or parallel shells.
- Keep feature-specific layout and content styling with the feature owner.
- Extend a shared primitive only when multiple consumers need the same domain-neutral visual contract.
- Keep surface tone, contrast, focus, disabled, hover, and selected states observable in a real consumer.

## Not Established Yet

- A formal token package, CSS-in-JS layer, Tailwind config, class-merging helper, or generated design-token registry is not established.
- Do not introduce one to solve a single visual correction.

## Working Rules

- Inspect the nearest accepted primitive and stylesheet before creating a new recipe.
- Keep global/reset/foundation rules in the foundation stylesheet and preserve the import order in `styles.css`.
- Prefer semantic `data-*` state selectors and existing variables over repeated raw palette literals.
- A browser screenshot can prove geometry/paint behavior for the web surface, but native Tauri and human visual acceptance remain separate gates.
