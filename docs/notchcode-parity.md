# Notchcode Parity Checklist

Mahiro's direction is for Agent Halo to feel like Notchcode, not a generic AI dashboard. This checklist turns that product direction into concrete, inspectable evidence.

## V1 scope decision

Mahiro accepted Notchcode v1 as a read-only + dismiss + setup/control-plane surface. Bridge-level scoped focus/end actions remain intentionally unavailable until Letta exposes public scoped session/process controls. The desktop may offer the separately labeled native Ghostty focus fallback; it must never be described as Letta session/process control.

## Success criteria

| Area | Current evidence | Status |
| --- | --- | --- |
| Hardware notch at rest | `apps/desktop/src/main.tsx` renders the SVG notch path and collapsed pill; ordered modules under `apps/desktop/src/styles/` own the black notch treatment. | Done |
| Pointer/keyboard-expand dropped sheet | Hover, click, Enter, or Space opens the same `.halo-surface`; Tauri `set_panel_open` resizes the native transparent window. Escape closes overview or returns detail/Setup to Sessions with focus restoration. | Done |
| Compact session rows | `buildSessionSummaries()` feeds dense `.session-list` / `.session-row` anatomy with project, truthful activity/status, model, relative age, and workspace path; row Focus is contextual rather than a persistent pill. | Done |
| State-directed session context | Row click replaces the overview with a Working, Needs input, Done, Error, Inactive, or Idle context using trusted event descriptors, recent activity, Focus/Clear/history actions, and a clear Back to sessions control. It never invents prompt text, answer choices, permission diffs, or approval controls. | Done |
| Sticky done state | `turn_complete` / `conversation_close` maps to `done`; completed sessions remain visible across quiet reloads until explicit Clear. Closing the ambient Done signal does not clear the row. | Done |
| Ambient attention/done wing | PermissionRequest or filtered question/decision activity expands a persistent orange Needs input wing; turn completion shows a timed green Done wing without OS notifications. | Covered |
| Stale-state truth | Quiet unfinished events become low-priority inactive history rather than a fake waiting-for-user state. | Covered |
| Clear completed sessions | Per-session Clear hides completed rows and persists IDs in `localStorage` under `agent-halo.dismissed-sessions`; guarded Clear completed handles the current completed section. | Done |
| Completion persistence regressions | `apps/desktop/tests/demo-dismiss.spec.ts` separately verifies quiet-reload persistence and fresh-activity resurrection after Clear. | Covered |
| Expandable workspace groups | Active and Completed sections keep one compact scroll surface; grouped workspaces expose child detail, Focus, and per-session Clear actions. | Covered |
| Quiet completion ledger | Completed sessions retain sticky workspace/child access and scoped Clear controls while using lower visual emphasis than Active work. | Covered |
| Setup/control plane | Setup view shows bridge, mod install status, next step, session-control capability boundary, one global robot mascot picker, and a persisted connected-display picker. | Done |
| Setup boundary regression | `apps/desktop/tests/demo-setup.spec.ts` verifies browser demo does not fake native install/check behavior or focus/end controls. | Covered |
| Capability-aware bridge | `packages/protocol/src/index.ts` defines bridge capabilities; `/health` and `/snapshot` include them from `mods/agent-halo.js`. | Done |
| No fake bridge focus/end | Bridge-level `focusTerminal` / `endSession` remain false; desktop labels Ghostty focus as a native fallback, not exact Letta session/process control. | Done |
| Ghostty focus fallback | Desktop detail view uses Ghostty's scripting dictionary to match cwd/title/id, select the owning tab/window, and focus the terminal. It reports fallback app activation honestly when no terminal match is found. | Done |
| Real end session action | Needs a real Letta session/process capability before exposing controls. | Post-v1 |

## Focus/end capability evidence

Current Letta Code mod public APIs expose lifecycle, turn, tool, compaction, and local-backend LLM events plus scoped conversation helpers. The relevant public mod references are:

- `creating-mods/references/events.md`: supported events include `conversation_open`, `conversation_close`, `turn_start`, `tool_start`, `tool_end`, `compact_start`, `compact_end`, `llm_start`, and `llm_end`.
- Event `ctx.conversation` exposes `id`, `getHistory()`, `fork()`, and `sendMessageStream()`.
- `creating-mods/references/architecture.md` says: “If the mod API does not expose a capability yet, avoid reaching around it.”

The installed Letta Code protocol types include lower-level app-server commands/events such as `abort_message`, `terminal_kill`, terminal process messages, queue/approval events, tool execution events, and result usage. These are not the trusted public mod API used by `mods/agent-halo.js`. Agent Halo should therefore keep bridge-level `sessionActions.focusTerminal` and `sessionActions.endSession` false, and should not fake queue/approval activity, until Letta exposes a public scoped session/process/app-server action or Mahiro explicitly accepts an internal/experimental bridge.

Current desktop focus is intentionally separate from bridge capabilities: `focus_terminal` is a macOS/Ghostty fallback that uses Ghostty's scripting dictionary to inspect windows/tabs and match cwd/title/id before selecting and activating the result. It reports app-level activation when no exact tab match exists. It is not a Letta-scoped process action.

## Verification commands

```bash
pnpm check
pnpm test:demo
pnpm test:performance
pnpm --filter @agent-halo/desktop build
(cd apps/desktop/src-tauri && cargo check)
node --check apps/viewer/index.mjs
node --check mods/agent-halo.js
pnpm desktop:dev
```

Use `pnpm desktop:dev` for native smoke because browser demo cannot exercise Tauri invoke commands.

## Completion rule

Notchcode v1 can be considered complete under Mahiro's accepted read-only + dismiss + setup/control-plane scope. Do not expose **bridge-level** focus/end controls while `sessionActions.focusTerminal` and `sessionActions.endSession` are unavailable. The desktop-only Ghostty focus fallback may remain when it is labeled as native matching rather than a Letta capability.
