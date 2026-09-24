# API and Data Fetching

## Current Reality

Agent Halo is local-first and does not use a hosted application API or frontend query library. Its data boundaries are:

1. Letta Code mod and AGY hook adapters emit normalized events.
2. The local bridge owns `/health`, `/snapshot`, `/events`, `/ingest`, and hook endpoints on `127.0.0.1:47621`.
3. The React desktop shell subscribes to the bridge and derives session/presence views.
4. Tauri `invoke` commands own native operations such as display placement, process inspection/control, notifications, provider commands, and external URL opening.
5. Feature adapters own provider-specific local reads and normalization before presentational components render them.

## Ownership Rules

- Keep provider command/credential parsing in the provider adapter or native command boundary, not in a card component.
- Keep bridge event normalization provider-agnostic after the adapter boundary.
- Keep feature-local snapshots and preferences with their feature persistence owner.
- Treat local NDJSON as diagnostics/audit evidence, not as a remote server-state cache.
- Do not expose credentials, raw tool output, command arguments, or camera frames to the renderer unless the active contract explicitly requires a safe projection.

## Fetch and Subscription Shape

- Use the bridge snapshot for initial hydration and SSE for live event updates.
- Rehydrate the snapshot after an SSE reconnect so a late-starting bridge does not leave the renderer stale.
- Keep provider refreshes capability-aware: retain last-good values with an explicit stale/error state when a source is unavailable.
- Use Tauri `invoke` for native work and keep blocking provider/native work off the renderer path where the existing command boundary supports it.

## Not Established Yet

- TanStack Query, SWR, Redux, Zustand, a general API client, and a generic `services/` folder are not established.
- Do not add a shared fetch/cache abstraction for one provider or one feature without repeated ownership pressure.

## Verification

Protocol changes require the relevant bridge/mod/adaptor checks plus desktop TypeScript/browser coverage. Native command changes require the appropriate Rust/native build or install evidence; browser demo tests alone cannot prove native behavior.

See `docs/architecture.md` and `docs/event-protocol.md` for the canonical bridge and envelope contracts.
