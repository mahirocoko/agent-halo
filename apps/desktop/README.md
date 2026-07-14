# Agent Halo Desktop

The active Agent Halo desktop renderer is a Tauri v2 transparent macOS notch surface backed by the local bridge at `127.0.0.1:47621`.

Runtime flow:

```text
http://127.0.0.1:47621/events
```

The renderer derives compact presence and persisted per-conversation Sessions from the protocol package plus bounded local event history. `src/main.tsx` owns shell/native-window orchestration; owner-local modules under `src/features/` own Sessions, presence ingestion, Setup, Usage, and Halo Soft Cube behavior. Ordered CSS ownership lives under `src/styles/`.

Do not start by scraping terminal output or transcript files. Those can be fallback diagnostics later, not the primary source.

Validation:

```bash
pnpm check
pnpm test:demo
pnpm test:performance
pnpm desktop:web:build
```

Use `pnpm desktop:install` for the native release/install gate.
