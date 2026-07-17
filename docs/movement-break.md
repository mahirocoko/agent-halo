# Movement Break contract

## Phase 1

Movement Break is an optional local Pomodoro completion action designed to interrupt long periods of sitting. Phase 1 offers one fixed **10 Squats** challenge after a naturally completed Focus phase.

The flow is deliberately user-driven:

1. Focus completes and the ordinary Completion Pet appears.
2. The user opens Pet controls and explicitly chooses **10 Squats**.
3. Only that click may request camera permission and start pose analysis.
4. Agent Halo counts one complete standing → squat depth → standing cycle at a time.
5. At 10 valid repetitions, the main renderer revalidates and starts the already prepared Short or Long break.

**Start break**, **Later**, and **Close** remain available. Movement Break never blocks a break and never opens automatically. Skip, Restart, Reset all, break completion, app launch, Pet preview, or passive Focus completion cannot start the camera.

## Privacy and camera ownership

- Movement Break is opt-in and defaults Off.
- Camera access is requested only after the user clicks **10 Squats**.
- One WebView `getUserMedia` stream feeds both the mirrored preview and bundled MediaPipe Pose Landmarker Lite model locally; preview and detector cannot select different cameras.
- Agent Halo does not record audio, save frames, encode video, retain a camera history, or send camera data over the network.
- The preview is rendered directly from the same in-memory stream used for detection. Frames are never drawn into a persistence/export canvas, encoded, written to disk, copied across native IPC, or sent over the network.
- Camera capture stops on completion, Cancel/Close, Pet disable, Reset all, app exit, session replacement, permission failure, or native error.
- Permission denial remains truthful and recoverable: the user may start the prepared break without exercise, close the surface, or enable Camera access later in macOS System Settings.

The packaged app must include a truthful `NSCameraUsageDescription`. Browser demo mocks can verify UI/state boundaries but cannot prove macOS TCC, WKWebView camera playback, bundled WASM/model loading, or real camera release.

## Pose and count contract

Phase 1 deliberately uses only the visible midpoint of the two shoulders. After a short standing calibration, a white line follows the shoulders and a green line marks the required drop. The right-side bar reports white-to-green progress. It does not judge knee form or provide medical, injury-prevention, or form-quality advice.

A repetition counts only after:

- one or both shoulders are visible with adequate confidence;
- seven stable standing samples calibrate the white-line start;
- the shoulder line reaches at least 90% of the green target with a short dwell;
- the user returns to the top 24% zone with another short dwell;
- minimum repetition timing prevents duplicate/noisy counts.

Tracking loss pauses the attempt and clears an incomplete repetition. The UI asks only that both shoulders stay visible. Pure shoulder-counter tests own threshold/state-machine regressions; Mahiro's real-camera foreground test remains the acceptance authority for useful counting.

## Ownership and action safety

`App` and `usePomodoro` remain the only Pomodoro owner.

```text
main Pomodoro state
  -> Completion Pet summon
  -> explicit 10 Squats action
  -> one local preview + bundled shoulder tracker
  -> one bounded movement-complete action
  -> main renderer validates completion id + prepared phase
  -> main renderer starts the break
```

The movement surface cannot mount `App`, write Pomodoro storage, schedule/cancel notifications, or start a timer directly. A completed challenge carries the active summon id and expected prepared phase through the same bounded Pet action queue as **Start break**. The main renderer accepts it only when the Pomodoro is still idle on the matching post-Focus break.

The existing 3-second Pet/notification handoff is unchanged. Camera permission and local pose-model startup occur later, after Pet already owns completion delivery, and never participate in fallback cancellation.

## Window and focus

- Passive Focus completion shows only the existing non-focusable Completion Pet.
- A deliberate Pet click may focus Pet controls.
- A deliberate **10 Squats** click may resize that same Pet window into the exercise surface and request camera access.
- The exercise surface is `600 × 420` logical px so the mirrored 4:3 live view, white shoulder line, green target line, repetition count, and live descent bar remain readable.
- Pose updates, permission callbacks, repetition completion, and errors must not reactivate Agent Halo or steal focus.
- Closing the surface leaves the prepared break idle and removes any transparent hitbox.

## Settings

Setup → Pet owns one **Movement break** On/Off preference, default Off. The preference applies to future Completion Pet summons; changing it does not dismiss a Pet that already owns completion delivery or remove its notification replacement. Phase 1 keeps the target fixed at 10 repetitions rather than adding premature exercise/cadence configuration. The setting copy must state that the camera opens only after an explicit challenge click and processing stays on this Mac.

## Verification

- No passive path invokes camera start or permission request.
- Pet preview never exposes Movement Break.
- Start break, Later, and Close remain available with Movement Break enabled.
- Camera denial/failure never corrupts Pomodoro state and still allows Start break.
- Only a complete 10-repetition session queues `movement-complete`, exactly once.
- Main revalidates summon id, completed Focus, idle status, and prepared break before starting.
- Cancel, hide, disable, Reset all, app exit, stale replacement, and completion stop capture.
- The Pet WebView command allowlist still blocks main-window commands.
- TypeScript, targeted Playwright tests, Rust unit tests/check, bundle checks, packaged `Info.plist` inspection, release install, focus smoke, permission smoke, and real squat-count smoke pass.
