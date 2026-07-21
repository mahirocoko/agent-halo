# Completion Pet

## Phase 1 contract

Agent Halo uses **Pet** as the product-facing companion concept. The global roster now contains the original 15 pixel companions plus **Ember Starling**, the default global Pet. It remains an event/state projection rather than a persistent desktop-pet simulation.

The Completion Pet is event-only:

- a naturally completed Focus phase may summon one floating Pet;
- Skip, Restart phase, Reset all, Pause, break completion, and app launch do not summon it;
- the Pet appears in a separate transparent Tauri window without activating or focusing Agent Halo;
- clicking the Pet opens transparent radial **Start Short break** (or **Start Long break**), **Later**, and **Close** controls;
- when Movement Break is enabled, those controls also offer an explicit **10 Squats** action; it is the only Pet path that may request camera access;
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

The native Pet window stores the latest summon and one bounded pending action. The hidden Pet renderer reads this projection; the main renderer consumes actions and validates that the requested Short/Long break is still idle before starting it. Movement Break reuses this boundary: explicit entry creates a summon-bound native attempt token, the isolated Pet WebView runs one local camera stream through bundled shoulder tracking, and only that current attempt may queue a `movement-complete` action for the main renderer to revalidate. See `docs/movement-break.md`.

## Notification fallback

When Pet is enabled, Focus start schedules the existing silent notification five seconds after the true deadline. A three-second Pet handoff window leaves margin for notification ownership and local window placement before that fallback can fire. At natural completion the main renderer first claims the handoff by awaiting a deadline-checked native cancellation, then attempts one Pet summon:

- cancellation cannot be claimed before the handoff deadline -> keep the original fallback and do not show Pet;
- cancellation succeeds and Pet shows inside the handoff window -> Pet owns completion delivery;
- cancellation succeeds but Pet cannot show or becomes stale -> schedule a fresh near-immediate silent fallback;
- wake/reload reconciliation after the fallback window does not also summon Pet.

This keeps the OS-owned fallback available when the renderer/app is unavailable without delivering both Pet and notification during a normal foreground completion.

## Window and interaction

- Original-roster companion frame: `116 × 88` logical px. The default `2×` presentation is a centered continuously animated `104 × 78` Pet body; smaller Setup choices remain centered inside the same bounded native surface.
- Ember Starling follows the existing floating-size choice with a tight surface per scale: `1×` uses `56 × 66`, `1.5×` uses `78 × 93`, and `2×` uses `100 × 120`; its radial surface is `260 × 270` so real break actions and their visible state label remain clear of the body.
- Original-roster radial-menu frame: `260 × 230` logical px. Three circular actions orbit the Pet on a transparent surface; the dashed orbit and circular controls make the deliberate interaction area visible even without a backing card.
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

The preference key is `agent-halo.pet`. When absent, Agent Halo reads the legacy `agent-halo.mascot` value and writes the normalized Pet preference. Fresh installs default to Ember Starling; every existing valid selection, including Scorpion, remains intact until the user changes it in Setup. Product UI, accessibility copy, types, and settings use **Pet**.

## Global Ember Starling

Ember Starling is one global identity across ambient, session, group, detail, Setup, and real Completion Pet surfaces:

- compact surfaces use a Mahiro-selected `144 × 144` smooth cut-paper source family delivered at `30 × 30` ambient and `36 × 36` session/detail sizes;
- Idle, Working, Attention, Done, and Error have separately generated body strips; Signal V4 remains the independent semantic icon layer;
- the floating Completion form uses the larger four-frame body and the existing `1×` / `1.5×` / `2×` setting;
- Setup **Show Pet** remains preview-only, but a naturally completed Focus now summons Ember with the real Start break, optional Movement, Later, and Close actions;
- original pixel companions remain selectable and continue using their existing compact and Completion body families.

## Verification

- Pet route does not mount main Pomodoro/session/bridge ownership.
- Natural Focus completion summons exactly once; non-natural transitions do not.
- Start break action is validated and consumed exactly once by main.
- `×`, Not now, disable, and show failure leave no invisible hitbox.
- Passive show preserves the current macOS foreground app and keyboard focus.
- Drag/restore/clamp passes on the selected display, Retina coordinates, and disconnected-display fallback.
- Browser state/action/accessibility tests, Rust position/state tests, performance budgets, release install/restart, and native foreground smoke pass.
