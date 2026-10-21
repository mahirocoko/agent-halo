# Keep display and system awake

Setup → Display owns two independent persisted controls: **Keep display awake** and **Keep system awake**. Both are independent of Focus timers and battery sleep.

Each control is one **On | Agent | Off** segmented native radio group, with one selected mode highlighted. Native radio keyboard navigation and associated labels are preserved; there is no dropdown or custom arrow-key state machine. Choosing one control never changes the other.

- **On:** prevent the corresponding user-idle sleep continuously while Agent Halo is running.
- **Agent:** prevent the corresponding user-idle sleep while any genuine session is working, including when another session needs attention. Idle, attention-only, completed, errored and inactive sessions do not hold the assertion. Motion mappings and Focus tools do not change this activity policy.
- **Off:** follow normal macOS idle settings for that assertion.

Display's fresh default remains **Off**. System's fresh default is **Agent**, allowing agent work to continue while the display sleeps. A system assertion does not itself keep the display lit; a display assertion may also affect system idling under macOS power policy, so these are independent assertion owners, not a promise to force system sleep while the display is held awake.

## Persistence

The main app owns both settings across Setup unmount/remount; Setup receives controlled values and callbacks and never reloads stale settings on mount.

- Display stores `agent-halo.keep-awake-mode` as `on`, `agent` or `off`. When absent, the legacy `agent-halo.keep-awake-while-working` value `true` migrates to Agent; every other legacy value migrates to Off. A malformed current mode fails closed to Off, never reviving the old toggle. This migration is unchanged.
- System stores `agent-halo.system-keep-awake-mode` as `on`, `agent` or `off`. An absent value defaults to Agent. A malformed value fails closed to Off. It never reads/migrates the display or legacy keys.
- Storage read failures fail closed to Off. Write failures leave the current app-owned runtime state usable but do not guarantee persistence.

## Confirmed state and native lifetime

The selected modes and confirmed native states are separate: **Active** means that assertion is confirmed; **Standby** means it is not active. Browser-only demo shows **Desktop runtime required** for enabled modes, and exhausted native retries show **Unavailable** rather than claiming Active. Release errors remain visible even with Off selected.

Each assertion has its own serialized command queue, idempotent native state, and bounded retries (initial attempt plus retries after 750 ms and 2.5 s). Mode/activity changes cancel stale retry timers and ignore stale results, with subsequent native operations queued behind in-flight operations. No recurring poller is added.

- Existing `set_keep_awake` acquires/releases one macOS `PreventUserIdleDisplaySleep` IOKit assertion.
- New `set_system_keep_awake` independently acquires/releases one macOS `PreventUserIdleSystemSleep` IOKit assertion.
- Native main-window destruction, app exit and state drop clean up both; cleanup always attempts both releases even if one fails.
- No `PreventSystemSleep`, `caffeinate`, lock bypass, or timer-specific assertion is used. Manual sleep and lid close remain allowed, screen locking is unchanged, and explicit low-battery sleep is not overridden.

Implementation owners: `apps/desktop/src/features/keep-awake/preferences.ts` (mode/persistence/policy), `use-keep-awake-sync.ts` in that feature (independent serialized synchronization), `apps/desktop/src/main.tsx` (app-owned settings/activity), `apps/desktop/src/features/setup/setup-panel.tsx` (controls/status), and `apps/desktop/src-tauri/src/keep_awake.rs` (IOKit lifetime).

## Verification boundary

Targeted browser tests cover defaults/malformed values, preserved display migration, independent `A → B → Setup unmount/remount → B` and reload for both controls, native-radio keyboard behavior, Agent idle/attention/working policy, mocked native releases and bounded failures. Native Rust coverage exercises assertion transitions, independent real IOKit IDs, idempotence and cleanup. Browser IPC mocks cannot establish installed Tauri behavior, actual idle-sleep timing, screen locking, manual sleep/lid-close behavior, or human visual acceptance. The installed native build must still be verified separately before claiming complete persistence/product acceptance.
