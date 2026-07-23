# Completion Pet

Production workflow for future identities and Halo Bot loadouts: [`pet-production.md`](pet-production.md).

## Phase 1 contract

Agent Halo uses **Pet** as the product-facing companion concept. The selectable global roster contains only **Halo Bot** and **Haloform**. Halo Bot remains the fresh/default identity and has ten curated user-selectable loadouts; Haloform is the approved provider-derived CRT companion built from a native96 master and explicit semantic masks. Both remain event/state projections rather than persistent desktop-pet simulations.

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

- The collapsed companion frame remains `116 × 88` logical px. Halo Bot and Haloform use the same square Completion geometry: `1×` renders `39 × 39`, `1.5×` renders `59 × 59`, and `2×` renders `78 × 78`.
- Compact ambient/session delivery remains `30 × 30` / `36 × 36`. Haloform is authored from its tracked native96 source and deterministic delivery strips; Halo Bot preserves the selected loadout.
- The radial-menu frame is `260 × 230` logical px. Three circular actions orbit the Pet on a transparent surface; the dashed orbit and circular controls make the deliberate interaction area visible even without a backing card.
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

The preference key is `agent-halo.pet`. When absent, Agent Halo reads the legacy `agent-halo.mascot` value and writes the normalized Pet preference. Fresh installs default to Halo Bot. Only `halo-bot` and `haloform` are valid; retired, unknown, or malformed stored values normalize and rewrite to Halo Bot. Halo Bot's independent `agent-halo.halo-bot-loadout` key accepts only `3051`, `1462`, `5324`, `c160`, `2515`, `4232`, `d351`, `6124`, `9132`, or `f061` and defaults to `3051`. The loadout is global, user-selected, and never project-hashed or randomized. Product UI, accessibility copy, types, and settings use **Pet**.

`agent-halo.pet-motion-map` stores one validated presentation mapping from each truthful Letta body state (`idle`, `working`, `attention`, `done`, `error`) to one of those five motion families. The default mapping is identity. Changing the mapping affects only the body strip and playback—for example, `working → idle` keeps semantic `data-state="working"`, Working copy/status precedence, Keep display awake behavior, and the independent Signal V4 activity icon unchanged.

## Global Halo Bot

Halo Bot uses the MIT Pixabots layered character system pinned in the tracked asset provenance. One four-part rig composes face/eyes, head shell, body/outfit, and top accessory; Agent Halo preserves the authored palettes and adds deterministic layered `idle`, `working`, `attention`, `done`, and `error` motion. The ten approved loadouts share that motion contract while remaining one persisted Pet identity. Signal V4 stays a detached semantic layer and is never baked into the body strips.

## Global Haloform

Haloform is one global identity across ambient, session, group, detail, Setup, and real Completion Pet surfaces:

- the source is one hash-bound standalone provider image normalized to an approved `96 × 96` canonical master; it is not claimed as provider-native 96px art;
- explicit body/head/face/top masks and reconstructed hidden surfaces make deterministic integer-offset motion possible without changing the neutral canonical image;
- tracked strips deliver `30 × 30` ambient, `36 × 36` session/detail, and `96 × 96` Completion source cells for Idle, Working, Attention, Done, and Error;
- Signal V4 remains an independent truthful semantic layer and is never baked into the body strips;
- provenance, masks, QA, approval receipt, and deterministic builder live at `apps/desktop/assets/mascots/agent-halo-roster/source/haloform-motion-v1/`.

## Verification

- Pet route does not mount main Pomodoro/session/bridge ownership.
- Natural Focus completion summons exactly once; non-natural transitions do not.
- Start break action is validated and consumed exactly once by main.
- `×`, Not now, disable, and show failure leave no invisible hitbox.
- Passive show preserves the current macOS foreground app and keyboard focus.
- Drag/restore/clamp passes on the selected display, Retina coordinates, and disconnected-display fallback.
- Release evidence must cover browser state/action/accessibility tests, Rust position/state tests, performance budgets, release install/restart, installed-binary equality, and a native foreground smoke; each promotion reports this evidence explicitly rather than treating the Phase 1 contract as a blanket PASS.
