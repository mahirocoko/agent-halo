# Keep display awake

Setup → Display owns three persisted modes, independent of Focus timers and battery sleep:

The control is one **On | Agent | Off** segmented native radio group, with one selected mode highlighted. Native radio keyboard navigation and associated labels are preserved; there is no dropdown or custom arrow-key state machine.

- **On:** prevent idle display sleep continuously while Agent Halo is running.
- **Agent:** prevent idle display sleep while any genuine session is working, including when another session needs attention. Idle, attention-only, completed, errored and inactive sessions do not hold the assertion.
- **Off:** follow normal macOS display idle settings. This is the fresh default.

The renderer stores `agent-halo.keep-awake-mode` as `on`, `agent` or `off`. When absent, the legacy `agent-halo.keep-awake-while-working` value `true` migrates to Agent; every other legacy value migrates to Off. A malformed current mode fails closed to Off, never reviving the old toggle. Storage failures leave the current runtime usable but do not guarantee persistence.

The selected mode and confirmed native state are separate: **Active** means the native assertion is confirmed; **Standby** means it is not active. Browser-only demo shows **Desktop runtime required** for enabled modes, and exhausted native retries show **Unavailable** rather than claiming Active.

The existing serialized `set_keep_awake` command acquires/releases one macOS `PreventUserIdleDisplaySleep` IOKit assertion. No `caffeinate` process or computer-sleep assertion is introduced. Repeated requests are idempotent, transient failures have bounded retries, and native window destruction/app exit/state drop release the assertion. Manual sleep and lid close remain allowed; battery sleep is not overridden.

Implementation owners: `apps/desktop/src/features/keep-awake/preferences.ts` (mode/persistence/policy), `apps/desktop/src/main.tsx` (activity and serialized synchronization), `apps/desktop/src/features/setup/setup-panel.tsx` (control/status), and `apps/desktop/src-tauri/src/keep_awake.rs` (IOKit lifetime).
