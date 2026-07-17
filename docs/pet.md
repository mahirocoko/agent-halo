# Completion Pet

## Phase 1 contract

Agent Halo uses **Pet** as the product-facing companion concept. Phase 1 reuses the approved 15-companion roster and Scorpion default; it does not add new artwork or a persistent desktop-pet simulation.

The Completion Pet is event-only:

- a naturally completed Focus phase may summon one floating Pet;
- Skip, Restart phase, Reset all, Pause, break completion, and app launch do not summon it;
- the Pet appears in a separate transparent Tauri window without activating or focusing Agent Halo;
- clicking the Pet opens transparent radial **Start Short break** (or **Start Long break**), **Later**, and **Close** controls;
- **Close** and **Later** hide only the current summon;
- Setup owns one global Pet On/Off preference, default On;
- turning Pet Off hides any active summon immediately;
- Setup → Pet persists a floating-only `1×`, `1.5×`, or `2×` size (default `2×`) and can explicitly **Show Pet** without changing Pomodoro or the On/Off preference;
- successful Pet display replaces the completion notification;
- when Pet is disabled or cannot be displayed, the existing silent macOS notification remains the fallback.

## Ownership

The main renderer and `usePomodoro` remain the only Pomodoro state owner. The Pet WebView is projection-only: it never mounts `App`, never runs `usePomodoro`, never writes Pomodoro storage, and never schedules notifications.

```text
main Pomodoro state
  -> native Pet summon projection
  -> hidden/showing Pet WebView
  -> validated Pet action queue
  -> main renderer starts the prepared break
```

The native Pet window stores the latest summon and one bounded pending action. The hidden Pet renderer reads this projection; the main renderer consumes actions and validates that the requested Short/Long break is still idle before starting it.

## Notification fallback

When Pet is enabled, Focus start schedules the existing silent notification five seconds after the true deadline. A three-second Pet handoff window leaves margin for notification ownership and local window placement before that fallback can fire. At natural completion the main renderer first claims the handoff by awaiting a deadline-checked native cancellation, then attempts one Pet summon:

- cancellation cannot be claimed before the handoff deadline -> keep the original fallback and do not show Pet;
- cancellation succeeds and Pet shows inside the handoff window -> Pet owns completion delivery;
- cancellation succeeds but Pet cannot show or becomes stale -> schedule a fresh near-immediate silent fallback;
- wake/reload reconciliation after the fallback window does not also summon Pet.

This keeps the OS-owned fallback available when the renderer/app is unavailable without delivering both Pet and notification during a normal foreground completion.

## Window and interaction

- Companion-only frame: `116 × 88` logical px. The default `2×` presentation is a centered continuously animated `104 × 78` Pet body; smaller Setup choices remain centered inside the same bounded native surface.
- Radial-menu frame: `260 × 230` logical px. Three circular actions orbit the Pet on a transparent surface; the dashed orbit and circular controls make the deliberate interaction area visible even without a backing card.
- The frame remains tight because transparent WebViews still have rectangular native hitboxes.
- Default position: 20px from the selected display's visible bottom-right corner.
- Dragging persists a normalized companion anchor per display id/fingerprint and clamps to the current visible frame.
- The radial action surface grows around the Pet's screen-space center when space permits, clamps fully into the visible frame, and returns to the saved collapsed position when it closes.
- Pet is created and passively shown non-focusable; passive show never calls `set_focus` or application activation.
- A deliberate user click may explicitly make the Pet focusable and focus its controls.
- Setup preview is a separate summon purpose with dismiss-only radial controls. It never queues or starts a break.
- The companion body is the only drag surface; controls opt out.
- Reduced motion holds the existing final Done/check frames without sprite playback.

## Preference migration

The new preference key is `agent-halo.pet`. When absent, Agent Halo reads the legacy `agent-halo.mascot` value and writes the normalized Pet preference. Asset paths may remain under the legacy `/mascots/agent-halo-roster/` directory in Phase 1 because the pixel source contract is unchanged; product UI, accessibility copy, types, and settings use **Pet**.

## Verification

- Pet route does not mount main Pomodoro/session/bridge ownership.
- Natural Focus completion summons exactly once; non-natural transitions do not.
- Start break action is validated and consumed exactly once by main.
- `×`, Not now, disable, and show failure leave no invisible hitbox.
- Passive show preserves the current macOS foreground app and keyboard focus.
- Drag/restore/clamp passes on the selected display, Retina coordinates, and disconnected-display fallback.
- Browser state/action/accessibility tests, Rust position/state tests, performance budgets, release install/restart, and native foreground smoke pass.
