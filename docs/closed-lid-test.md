# Keep awake with lid closed

**Setup → Display → Keep awake with lid closed** requests a machine-wide sleep override on battery or AC power, not just for T3 Code. Connecting or disconnecting the charger does not end the mode. The switch has no timer. The switch returning to Off means the override has been restored, not that any particular local job kept running.

## Use the switch

1. Keep the lid open. You can leave the charger connected and **Low-battery sleep** armed. On battery, Low-battery sleep takes priority below its saved threshold; there is no separate minimum percentage for closed-lid keep-awake.
2. Click **Keep awake with lid closed** to turn it on. Halo collapses immediately so you can respond to the macOS confirmation. Reopen **Setup → Display** to check that the switch is On before closing the lid. Keep the Mac on a hard surface, not in a bag.
3. On lid close, Halo requests display sleep without requesting system sleep. For immediate authentication on reopen, set **System Settings → Lock Screen → Require password after screen saver begins or display is turned off** to **Immediately**. Halo never changes that setting. Use **Control–Command–Q** before closing the lid if immediate locking has not been verified on your Mac.
4. Switch Off or quit Halo to restore normal sleep. Leave the lid open until restoration completes before storing the Mac.

If restoration does not complete, run `pmset -g`. `SleepDisabled 0` or no `SleepDisabled` row means the override is off. If Halo set it and it remains on, restore normal sleep from Terminal with `sudo /usr/bin/pmset -a disablesleep 0`.

## Native behavior

- The mode is not a saved preference and never turns on automatically. It is separate from the display and system idle assertions. While its own lease is active, Halo watches the lid and requests `pmset displaysleepnow` from the unprivileged GUI process after observing the lid close. Failed requests get a bounded retry while the lid remains closed. It does not directly lock the session, send keystrokes, or change the Lock Screen preference. Avoid concurrent sleep-override tools. A change in the active console account ends the override.
- Only the main Tauri window can request either transition. Turning on requires explicit confirmation and macOS administrator approval. A preexisting sleep override or closed lid prevents activation. Armed Low-battery sleep can coexist on AC or on battery at or above the saved threshold. Below that threshold on battery, Low-battery sleep takes priority. The installer rechecks the current power source and the armed threshold supplied before authorization; the native power monitor can revoke the lease during authorization or after activation. Current Halo copies using the same account and app config directory share one battery-power owner lock.
- The authorized launcher registers a restore-only root launchd job and records its recovery claim before enabling the override. Switching Off ends the unprivileged process Halo uses to hold the override; no second administrator prompt is needed. That process exits when Halo closes or crashes. The root job checks its PID, UID and start time, and also restores on a changed boot identity. Restoration may take longer if a command fails. The job verifies the effective setting before clearing its claim and never enables the override itself. An inert helper and lock file can remain under `/private/var/db/com.mahirocoko.agent-halo.closed-lid-test`.
- Browser tests cover the switch and mocked IPC. `node --test tests/closed-lid-test.test.mjs` covers the worker with fake power and launchd commands. Native authorization, actual display sleep and Lock Screen behavior on reopen, and T3 continuity across power changes still require a supervised hardware check.
