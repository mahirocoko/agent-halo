# Movement Break contract

## Current exercise set

Movement Break is an optional local exercise lane designed to interrupt long periods of sitting. Its first pass reuses two fixed body motions:

- **10 Squats** — lower-body standing → squat depth → standing cycles.
- **10 Overhead Reaches** — both hands below the shoulders → both hands overhead → both hands lowered cycles.

There are two deliberate entry paths:

1. **Focus completion:** a naturally completed Focus phase may show the Completion Pet. When **Offer movement after Focus** is enabled, its controls open a camera-free chooser. A completed challenge may then hand the already prepared Short or Long break to the main renderer.
2. **Manual movement:** the Focus **Move** tab can either launch from the exact Squat/Reach button or show a manual companion, whose chooser offers both exercises. Manual companion controls are **Focus**, **Choose move**, and **Hide**; it persists until Hide. A manual challenge returns to that companion on completion and never changes Pomodoro.

Only a specific **10 Squats** or **10 Overhead Reaches** click may request camera permission and start pose analysis. No passive state, chooser opening, Pet preview, or Focus completion alone can start the camera. **Start break**, **Later**, and **Close** remain available on the Focus-completion purpose; Movement never blocks a break or opens automatically.

## Privacy and camera ownership

- **Offer movement after Focus** is opt-in and defaults Off; manual Movement remains available from Focus.
- Opening the exercise picker does not request camera access. Camera access is requested only after the user clicks a specific Squat or Overhead Reach challenge.
- One WebView `getUserMedia` stream feeds both the mirrored preview and bundled MediaPipe Pose Landmarker Lite model locally; preview and detector cannot select different cameras.
- Agent Halo does not record audio, save frames, encode video, retain a camera history, or send camera data over the network.
- The preview is rendered directly from the same in-memory stream used for detection. Frames are never drawn into a persistence/export canvas, encoded, written to disk, copied across native IPC, or sent over the network.
- Camera capture stops on completion, Cancel/Close, Hide, Pet disable, Reset all, app exit, session replacement, permission failure, or native error.
- Permission denial remains truthful and recoverable: a Focus-completion user may start the prepared break without exercise; a manual user can return to the companion, hide it, or enable Camera access later in macOS System Settings.

The packaged app must include a truthful `NSCameraUsageDescription`. Browser demo mocks can verify UI/state boundaries but cannot prove macOS TCC, WKWebView camera playback, bundled WASM/model loading, or real camera release.

## Pose and count contract

One bundled MediaPipe Pose Landmarker produces the landmark stream for both exercises. `MovementChallenge` owns the single camera/preview/inference lifecycle; exercise-specific trackers consume the same result and cannot open another stream or start Pomodoro directly. The progress guides are exercise-specific and do not judge form or provide medical, injury-prevention, or form-quality advice.

### Squat

Squat deliberately uses only the visible midpoint of the two shoulders. After a short standing calibration, a white line follows the shoulders while the green target stays fixed at 86% of the camera frame; the user adjusts camera framing rather than letting the target drift. The right-side bar reports white-to-green progress.

A repetition counts only after:

- one or both shoulders are visible with adequate confidence;
- seven stable standing samples calibrate the white-line start;
- the shoulder line reaches at least 90% of the green target with a short dwell;
- the user returns to the top 24% zone with another short dwell;
- bottom and return dwell gates prevent duplicate/noisy counts.

Tracking loss pauses the attempt and clears an incomplete repetition. The UI asks only that both shoulders stay visible. Pure shoulder-counter tests own threshold/state-machine regressions; Mahiro's real-camera foreground test remains the acceptance authority for useful counting.

### Overhead Reach

Overhead Reach requires both shoulders and both wrists to remain visible. The white line follows the midpoint of the hands and the green target sits above the current shoulder line. A repetition counts only after:

- both hands begin at least 5% of the normalized camera height below their corresponding shoulders;
- both hands reach at least 8% above their corresponding shoulders with a short dwell;
- both hands return below the shoulders with another short dwell;
- one raised hand cannot count as a completed reach.

Tracking loss clears an incomplete reach and requires both hands to return below the shoulders before another attempt. Pure counter tests own threshold/state-machine regressions; Mahiro's real-camera foreground test remains the acceptance authority for useful counting and camera framing.

## Ownership and action safety

`App` and `usePomodoro` remain the only Pomodoro owner.

```text
Focus-completion summon
  -> camera-free exercise picker
  -> explicit Squat or Overhead Reach action
  -> one local preview + bundled pose tracker
  -> selected exercise counter
  -> bounded movement-complete action
  -> main renderer validates completion id + prepared phase
  -> main renderer starts the break

Manual companion (from Focus Move or its chooser)
  -> explicit Squat or Overhead Reach action
  -> the same local preview + bundled pose tracker
  -> selected exercise counter
  -> return to manual companion; no Pomodoro action
```

The movement surface cannot mount `App`, write Pomodoro storage, schedule/cancel notifications, or start a timer directly. It owns one local camera/preview/runtime lifecycle per active attempt. A Focus-completion challenge carries its summon id and expected prepared phase through the bounded Pet action queue; the main renderer accepts it only when Pomodoro is still idle on the matching post-Focus break. Manual movement queues no `movement-complete` action and returns to the manual companion.

The existing 3-second Pet/notification handoff applies only to Focus completion. Camera permission and local pose-model startup occur later, after the completion Pet owns delivery, and never participate in fallback cancellation; manual movement has no notification handoff.

## Window and focus

- Passive Focus completion shows only the existing non-focusable Completion Pet.
- A deliberate Pet click may focus Pet controls. The Focus Move tab deliberately launches its manual companion without changing Pomodoro.
- A deliberate **10 Squats** or **10 Overhead Reaches** click may resize that same Pet window into the exercise surface and request camera access. Opening or closing a chooser cannot.
- The exercise surface is `600 × 420` logical px so the mirrored 4:3 live view, white tracked line, green exercise target, repetition count, and live progress bar remain readable.
- That surface can be moved around the selected display. Pointer drags start from the camera, progress column, header, or footer, and they skip buttons. Arrow keys nudge it 16px, and Shift plus an arrow nudges 48px. Position persists through the Completion Pet anchor.
- Pose updates, permission callbacks, repetition completion, and errors must not reactivate Agent Halo or steal focus.
- Closing a Focus-completion surface leaves the prepared break idle; cancelling or completing a manual surface returns to the companion. Hide removes the transparent hitbox.

## Settings

Setup → Pet owns one **Offer movement after Focus** On/Off preference, default Off. It applies only to future Focus-completion Pet summons; manual Movement remains available regardless, and changing the preference does not dismiss a Pet that already owns completion delivery or remove its notification replacement. Both current exercises stay fixed at 10 repetitions rather than adding premature exercise/cadence configuration. The setting copy must state that the camera opens only after a specific exercise click and processing stays on this Mac.

## Verification

- No passive path invokes camera start or permission request.
- Opening the exercise picker does not mount the camera surface or create a native movement attempt.
- Pet preview never exposes Movement Break.
- Focus-completion Start break, Later, and Close remain available when its movement offer is enabled.
- Camera denial/failure never corrupts Pomodoro state; Focus completion still allows Start break and manual movement returns to the companion.
- Squat still requires its calibrated down/up traversal; Overhead Reach requires both hands to complete a down/up/down traversal.
- Only a complete 10-repetition **Focus-completion** session queues `movement-complete`, exactly once; a complete manual session returns to the companion with no Pomodoro action.
- Main revalidates summon id, completed Focus, idle status, and prepared break before starting a Focus-completion break.
- Cancel, Hide, disable, Reset all, app exit, stale replacement, and completion stop capture.
- The Pet WebView command allowlist still blocks main-window commands.
- Release promotion requires TypeScript, targeted Playwright tests, Rust unit tests/check, bundle checks, packaged `Info.plist` inspection, release install, focus smoke, and permission smoke to pass. Useful real Squat/Overhead Reach counting remains a separate Mahiro-owned foreground acceptance gate.
