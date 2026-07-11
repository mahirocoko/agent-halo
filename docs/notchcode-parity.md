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
| Ambient attention/done wing | PermissionRequest or filtered question/decision activity expands a persistent orange Needs input wing; turn completion shows a timed green Done wing without OS notifications. | Covered |
| Stale-state truth | Quiet unfinished events become low-priority inactive history rather than a fake waiting-for-user state. | Covered |
| Dismiss ended sessions | Row/detail dismiss hides ended sessions and persists IDs in `localStorage` under `agent-halo.dismissed-sessions`. | Done |
| Dismiss reload regression | `apps/desktop/tests/demo-dismiss.spec.ts` verifies dismiss survives reload and stale `Acknowledge` does not reappear. | Covered |
| Setup/control plane | Setup view shows bridge, mod install status, next step, and session-control capability boundary. | Done |
| Setup boundary regression | `apps/desktop/tests/demo-setup.spec.ts` verifies browser demo does not fake native install/check behavior or focus/end controls. | Covered |
| Capability-aware bridge | `packages/protocol/src/index.ts` defines bridge capabilities; `/health` and `/snapshot` include them from `mods/agent-halo.js`. | Done |
| No fake focus/end | Bridge-level `focusTerminal` / `endSession` remain false; desktop labels Ghostty focus as a native fallback, not exact session/process control. | Done |
| Ghostty focus fallback | Desktop detail view uses Ghostty's scripting dictionary to match terminal cwd/title/id, select the owning tab, and focus the terminal. It falls back to app activation when no terminal match is found. | Done |
| Real end session action | Needs a real Letta session/process capability before exposing controls. | Post-v1 |

## Focus/end capability evidence

Current Letta Code mod public APIs expose lifecycle, turn, tool, compaction, and local-backend LLM events plus scoped conversation helpers. The relevant public mod references are:

- `creating-mods/references/events.md`: supported events include `conversation_open`, `conversation_close`, `turn_start`, `tool_start`, `tool_end`, `compact_start`, `compact_end`, `llm_start`, and `llm_end`.
- Event `ctx.conversation` exposes `id`, `getHistory()`, `fork()`, and `sendMessageStream()`.
- `creating-mods/references/architecture.md` says: “If the mod API does not expose a capability yet, avoid reaching around it.”

The installed Letta Code protocol types include lower-level app-server commands/events such as `abort_message`, `terminal_kill`, terminal process messages, queue/approval events, tool execution events, and result usage. These are not the trusted public mod API used by `mods/agent-halo.js`. Agent Halo should therefore keep bridge-level `sessionActions.focusTerminal` and `sessionActions.endSession` false, and should not fake queue/approval activity, until Letta exposes a public scoped session/process/app-server action or Mahiro explicitly accepts an internal/experimental bridge.

Current desktop focus is intentionally narrower: `focus_terminal` is a macOS/Ghostty fallback that activates Ghostty, attempts to raise a window whose title contains the conversation id, cwd, or folder name, and otherwise reports app-level activation. It is not exact pane focus. Exact pane focus should use future metadata such as terminal title mapping or `TMUX_PANE` plus `tmux select-pane`.

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
