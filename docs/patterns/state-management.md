# State Management

## Current Reality

Agent Halo uses local React state/hooks plus explicit persistence owners. There is no Zustand, Redux, TanStack Query, or app-wide client store.

State is split by responsibility:

- `main.tsx` owns shell/native coordination and top-level projection state.
- Feature hooks/models own Pomodoro, Stopwatch, Usage, Runtime, Presence, Movement, and Setup behavior.
- Session/presence contracts are shared through `packages/protocol/` and feature selectors/models.
- localStorage/native commands own persisted preferences, layouts, histories, tombstones, and display settings.

## Lifecycle Expectations

For a persisted user-owned setting, map the full lifecycle: read, default, modify, reset, persist, reload, unavailable storage, and visible failure/stale state. For derived event state, preserve ordering, identity, and explicit cleanup boundaries.

## Preferred Direction

- Keep local UI state local.
- Promote state only when multiple real owners need the same contract or a native/protocol boundary requires it.
- Prefer explicit reducers/selectors/models when event transitions become difficult to audit in component bodies.
- Do not add a global store as a convenience for passing one prop through one feature.

## Not Established Yet

There is no general server-state cache, normalized entity store, route loader/action state, or form library. If one is introduced later, document its ownership and migration boundary before spreading it across features.
