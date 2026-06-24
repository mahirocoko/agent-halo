# Notchcode Parity Checklist

Mahiro's direction is for Agent Halo to feel like Notchcode, not a generic AI dashboard. This checklist turns that product direction into concrete, inspectable evidence.

## V1 scope decision

Mahiro accepted Notchcode v1 as a read-only + dismiss + setup/control-plane surface. Real focus/end session actions remain intentionally post-v1 until Letta exposes public scoped session/process controls, or until Mahiro explicitly chooses an experimental/internal bridge.

## Success criteria

| Area | Current evidence | Status |
| --- | --- | --- |
| Hardware notch at rest | `apps/desktop/src/main.tsx` renders `NotchShape` and collapsed pill; `apps/desktop/src/styles.css` owns the black notch/pill treatment. | Done |
| Click-to-expand dropped sheet | Desktop state toggles between pill and `.sheet.view-panel.docked`; Tauri `set_panel_open` resizes the native transparent window. | Done |
| Compact session rows | `buildSessionSummaries()` feeds `.session-list` / `.session-row` with project, status, and last activity. | Done |
| Session drill-down | Row click sets `selectedSessionId`; detail view shows path, status, permission mode, and recent activity. | Done |
| Sticky done state | `conversation_close` maps to `closed` / `done`; closed sessions remain visible until acknowledge/dismiss. | Done |
| Dismiss ended sessions | Row/detail dismiss hides ended sessions and persists IDs in `localStorage` under `agent-halo.dismissed-sessions`. | Done |
| Dismiss reload regression | `apps/desktop/tests/demo-dismiss.spec.ts` verifies dismiss survives reload and stale `Acknowledge` does not reappear. | Covered |
| Setup/control plane | Setup view shows bridge, mod install status, next step, and session-control capability boundary. | Done |
| Setup boundary regression | `apps/desktop/tests/demo-setup.spec.ts` verifies browser demo does not fake native install/check behavior or focus/end controls. | Covered |
| Capability-aware bridge | `packages/protocol/src/index.ts` defines bridge capabilities; `/health` and `/snapshot` include them from `mods/agent-halo.js`. | Done |
| No fake focus/end | Bridge-level `focusTerminal` / `endSession` remain false; desktop labels terminal focus as a native fallback, not exact session/process control. | Done |
| Ghostty/Warp focus fallback | Desktop detail view uses Ghostty's scripting dictionary or Warp accessibility window-title matching, then falls back to app activation when no terminal match is found. | Done |
| Real end session action | Needs a real Letta session/process capability before exposing controls. | Post-v1 |

## Focus/end capability evidence

Current Letta Code mod public APIs expose lifecycle, turn, and tool events plus scoped conversation helpers. The relevant public mod references are:

- `creating-mods/references/events.md`: supported events are `conversation_open`, `conversation_close`, `tool_start`, and `turn_start`.
- Event `ctx.conversation` exposes `id`, `getHistory()`, `fork()`, and `sendMessageStream()`.
- `creating-mods/references/architecture.md` says: “If the mod API does not expose a capability yet, avoid reaching around it.”

The installed Letta Code protocol types include lower-level app-server commands such as `abort_message`, `terminal_kill`, and terminal process messages, but those are not exposed through the trusted mod API used by `mods/agent-halo.js`. Agent Halo should therefore keep bridge-level `sessionActions.focusTerminal` and `sessionActions.endSession` false until Letta exposes a public scoped session/process action or Mahiro explicitly accepts an internal/experimental bridge.

Current desktop focus is intentionally narrower: `focus_terminal` is a native macOS fallback for supported terminals. Ghostty matching uses its scripting dictionary; Warp matching uses accessibility window-title matching plus Tab-menu cycling because Warp does not expose the same terminal/tab scripting model. When no exact match is found, Agent Halo activates a supported terminal and reports app-level activation. Warp exact tab focus requires a unique tab/window title hint; if multiple tabs only expose the same agent name, Agent Halo cannot distinguish them yet. Exact pane focus should use future metadata such as terminal title mapping, `TMUX_PANE` plus `tmux select-pane`, or a deliberate terminal-title handshake.

## Verification commands

```bash
pnpm check
pnpm test:demo
pnpm --filter @agent-halo/desktop build
(cd apps/desktop/src-tauri && cargo check)
node --check apps/viewer/index.mjs
node --check mods/agent-halo.js
pnpm desktop:dev
```

Use `pnpm desktop:dev` for native smoke because browser demo cannot exercise Tauri invoke commands.

## Completion rule

Notchcode v1 can be considered complete under Mahiro's accepted read-only + dismiss + setup/control-plane scope. Do not expose focus/end buttons while `sessionActions.focusTerminal` and `sessionActions.endSession` are unavailable; keep those controls capability-aware and visibly unavailable instead of adding fake buttons.
