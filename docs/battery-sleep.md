# Battery sleep contract

Agent Halo includes an optional, one-shot low-battery emergency sleep control located in the **Setup** (Display) panel next to Keep display awake.

## Behavior

- **Default**: Off, with a **10%** threshold.
- **Threshold**: A native-persisted whole percentage from **1–100%**. Edit while Off; Enter or leaving the numeric field saves it. Both UI and native commands reject editing while armed. Editing alone never arms or requests sleep. Invalid or unsaved drafts cannot arm monitoring.
- **Arming**: Explicit user activation arms one-shot monitoring.
- **Trigger**: Armed state triggers system sleep strictly when:
  1. The Mac is running on **battery power** (not external/AC power).
  2. The battery level drops strictly **below the saved threshold** (`percentage < thresholdPercent`). Equality does not trigger.
- **Already-low on arm**: If armed while already on battery power below the saved threshold, system sleep triggers immediately. Save your work before testing with a threshold above the current battery level.
- **One-shot disarm**: Before invoking the native sleep API, the runtime durably persists the disarmed state (`armed: false`) to disk and emits the update to the UI. If disk persistence fails, system sleep is aborted to prevent repeat sleep loops on wake/reboot.
- **Sleep failure**: If system sleep execution fails, the state remains disarmed with a visible error string in the UI; rearming requires explicit user action.

## Native macOS implementation

- Native macOS code owns durable preference persistence (`battery-sleep-preference.json` in the app config directory) and power source monitoring independent of the renderer/panel lifecycle.
- The same preference stores `armed` and `thresholdPercent`. Legacy preferences missing the threshold use 10%; invalid stored thresholds fail closed rather than resuming an arm. Arm/disarm writes preserve the saved threshold.
- A threshold save writes Off explicitly. If persistence fails after file replacement, the runtime treats the save as uncertain and rejects arming until a successful save; it never arms against an old displayed threshold with a different saved value. Restart may restore the newly written threshold, but remains Off. A valid blur/Enter can retry a failed save even when it matches the displayed value.
- Monitoring utilizes IOKit power source change notifications via a CoreFoundation run loop source (`IOPSNotificationCreateRunLoopSource`) attached to the main run loop while armed. It avoids recurring polling timers and caffeinate assertions.
- On disarm, sleep consumption, or application exit, the run loop event source is removed and released cleanly without memory leaks.
- Native commands and notification-source mutations run on the macOS main run loop. A serialized engine transaction rechecks current power before consuming the armed state, preventing duplicate sleep requests from competing callbacks.
- Sleep execution calls native trusted IOKit power management (`IOPMSleepSystem`).
- The feature fails closed (reports unsupported/disabled) on non-macOS platforms, headless systems, or devices without a detected battery.

## State synchronization

- The desktop renderer maintains no private persistent shadow truth (does not use `localStorage` for armed status).
- On mount or panel remount/reload, the UI queries current native status (`get_battery_sleep_status`) and subscribes to native state broadcast events (`agent-halo://battery-sleep-status`).
- Every native status includes `thresholdPercent`. `set_battery_sleep_threshold(thresholdPercent)` validates and durably saves the threshold under the same serialized state transaction, only while Off. Pending saves disable both controls so an explicit arm cannot race ahead of an unsaved threshold.
- The main window requires `core:event:allow-listen` and `core:event:allow-unlisten` in the dedicated battery-sleep capability. No renderer emit permission or Pet-window access is granted. Listener failures must be visible even before battery support is known; browser IPC mocks do not prove this native ACL boundary.
- Asynchronous UI toggle requests are serialized through an operation promise chain to prevent out-of-order race conditions.
- The control exposes switch semantics (`aria-checked`) and is disabled outside the native runtime or when battery support is unavailable. An already armed control can still be turned off if battery information becomes unavailable.

## Verification boundary

Focused tests cover one-shot transitions and failure paths using fake sleep dependencies. A read-only native battery query smoke exercises the real IOKit data path without arming or sleeping. Browser-local IPC mocks establish UI synchronization only; they do not prove real system sleep or battery consumption overhead. Actual sleep at the threshold remains a hardware/user verification step.
