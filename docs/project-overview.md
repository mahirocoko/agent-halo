# Project Overview

## Tech Stack

- **App / Runtime**: React 19 frontend with Vite, embedded in a Tauri 2 macOS desktop app.
- **UI**: TypeScript with React components, local feature modules, and Lucide icons.
- **Styling**: plain CSS, custom properties, ordered stylesheet imports, and local semantic surface primitives; no Tailwind or CSS Modules.
- **Data access**: local bridge SSE/snapshot/NDJSON transport, Tauri `invoke`, and provider-specific local adapters.
- **State**: React state/hooks, localStorage, and native Tauri persistence; no TanStack Query, Zustand, or Redux layer.
- **i18n**: Not established.
- **Tooling**: pnpm workspace, Vite, Tauri CLI, TypeScript, Playwright, and Biome 2.5.14.

## Runtime

- **Package manager**: pnpm 10.33.0
- **TypeScript**: 5.9.3
- **React**: 19.2.7
- **Tauri**: 2.11.x frontend API/CLI line

## Key Libraries

- **UI primitives**: local components in `apps/desktop/src/components/` (`BoardSurface`, `BoardScroll`, `SurfaceControl`, `SurfaceStatus`, and `ResizableCardDivider`).
- **Icons**: `lucide-react`.
- **Camera/pose runtime**: `@mediapipe/tasks-vision`, loaded for the explicit Movement Break flow.
- **Protocol**: workspace package `@agent-halo/protocol` in `packages/protocol/`.
- **Build**: Vite + `@vitejs/plugin-react`; Tauri owns native packaging and windows.
- **HTTP/data client**: native/provider-specific code rather than a frontend-wide query client.

## Repository Shape

Agent Halo is a pnpm workspace with a protocol package and a desktop app. The repository also contains the local Letta mod, AGY and bridge adapters, a terminal viewer, native Tauri code, and domain documentation.

## Runtime Boundaries

The Letta mod and AGY adapter normalize provider events into the local Agent Halo bridge. The bridge serves local health/snapshot/SSE endpoints and writes a local NDJSON diagnostic log. The desktop renderer consumes the protocol and owns the visible Sessions, Focus, Usage, Runtime, Services, Setup, and Pet projections. Tauri owns native windows, macOS integration, local process/display/camera/notification boundaries, and the bundled bridge supervision path.

See `docs/architecture.md`, `docs/event-protocol.md`, and `docs/presence-model.md` for the active contracts.

## State and Persistence

### Current Reality

- React hooks own feature-local state and derived projections.
- Provider snapshots, session tombstones, preferences, layouts, and histories use explicit local persistence owners.
- Native state such as selected display, notifications, process identity, and bridge supervision stays behind Tauri commands or native code.
- There is no general-purpose shared store or server-state cache.

### Not Established Yet

- A route framework, data-fetching library, shared store, or i18n extraction pipeline is not established.
- Do not add one for a single feature without a demonstrated cross-owner need.
