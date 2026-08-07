# Stopwatch contract

Agent Halo includes one local Stopwatch beside Pomodoro in the **Focus** tab. The two tools are independent and may run at the same time. Stopwatch state never changes Pomodoro phase, cadence, completion, Pet behavior, notification requests, or Keep display awake.

## Current run

Renderer state is stored under `agent-halo.stopwatch` with a versioned schema:

- **Start** begins a new session or resumes a paused one.
- **Pause** adds only the active interval to `accumulatedMs`.
- **Finish** saves one history entry and returns the current Stopwatch to idle.
- Confirmed **Discard** returns the current Stopwatch to idle without saving history.

A running session persists `runningSince` as an absolute Unix timestamp plus the already accumulated active duration. The UI derives elapsed time from that wall-clock anchor on every tick, mount, focus, and visibility change. Renderer reload, background throttling, and Mac sleep therefore do not lose elapsed time. Paused wall time is excluded.

## History

Finished entries are stored separately under `agent-halo.stopwatch-history`. Each entry contains an id, session start, finish time, and active duration. The local list:

- is ordered newest first and bounded to 500 entries;
- groups entries by their local finish date and shows the saved active total for each day;
- survives renderer reload;
- can be removed with a two-step **Clear history** action.

Clearing history never pauses, finishes, or discards the current Stopwatch. History remains local to the renderer and is not mixed with Pomodoro cycle progress or agent session history.

## Collapsed-notch precedence

1. Agent Attention or Error
2. Active, paused, or recently completed Pomodoro
3. Active or paused Stopwatch
4. Ordinary agent Working or recent Done
5. Idle

When Pomodoro and Stopwatch run together, the Pomodoro countdown remains the primary left-wing value and the Stopwatch elapsed time appears as secondary right-wing context. Stopwatch alone uses its own elapsed value and running/paused context. It never auto-opens the full panel or requests native focus.

## Native boundary

Stopwatch has no completion deadline and does not request or schedule macOS notifications. It is renderer-local and does not add Tauri commands or native process ownership.
