# Pomodoro contract

Agent Halo includes one local Pomodoro lane inside the desktop app. It is independent from Letta bridge/session state and does not change Keep display awake behavior.

## Cycle

- Focus: 25 minutes by default; customizable from 1–120 minutes
- Short break: 5 minutes by default; customizable from 1–60 minutes
- Long break: 15 minutes by default; customizable from 1–120 minutes
- Long break cadence: every four naturally completed Focus phases by default; customizable from 2–12
- The next phase is prepared but does not auto-start.
- Skipping Focus does not count as a completed Focus session.

## Persistence and reconciliation

Renderer state is stored under `agent-halo.pomodoro`. A running phase stores an absolute `endsAt` Unix timestamp. The UI derives remaining time from `endsAt - Date.now()` on every tick, mount, focus, and visibility change. Reloading, background throttling, or sleeping the Mac therefore does not extend the phase.

Settings are stored separately under `agent-halo.pomodoro-settings`. Each phase snapshots `phaseDurationMs` when it is prepared. Editing settings updates an idle phase immediately, but never changes a running or paused countdown; Reset or the next prepared phase uses the new values. Restoring Defaults returns to 25/5/15/every-4.

When a deadline has passed, the transition is applied once: completed Focus increments the focus count and prepares Short/Long break; a completed break prepares Focus. Completion remains visible briefly in the notch.

## Collapsed-notch precedence

1. Agent Attention or Error
2. Active, paused, or recently completed Pomodoro
3. Ordinary agent Working or recent Done
4. Idle

This keeps urgent Letta input/errors visible while preserving the user-requested countdown during ordinary agent work.

## macOS notifications

Starting a phase explicitly requests Alert permission when needed and immediately schedules one silent non-repeating local notification through `UNUserNotificationCenter`. No sound, badge, critical-alert, or time-sensitive permission is requested.

Pause, Reset, and Skip remove the stable `agent-halo.pomodoro` request. Renderer operations are serialized, and the Rust runtime assigns every schedule/cancel a monotonic native revision under one operation lock so stale work from a pre-reload WebView cannot restore an old request. Permission denial or native scheduling failure never blocks the timer; Agent Halo still shows the local completion state. macOS controls actual delivery under Notification settings and Focus modes.
