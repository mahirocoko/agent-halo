# Completion Pet

Production workflow for future identities and Halo Bot loadouts: [`pet-production.md`](pet-production.md).

## Phase 1 contract

Agent Halo uses **Pet** as the product-facing companion concept. The selectable global roster contains only **Halo Bot** and **Haloform**. Halo Bot remains the fresh/default identity and exposes all 10,752 combinations from the pinned Pixabots catalog; Haloform is the approved provider-derived CRT companion built from a native96 master and explicit semantic masks. Both remain event/state projections rather than persistent desktop-pet simulations.

The Pet uses schema-v2 summons with three explicit purposes:

- **Focus completion** — a naturally completed Focus phase may summon one floating Pet. It retains **Start Short break** (or **Start Long break**), **Later**, **Close**, and, when **Offer movement after Focus** is enabled, a camera-free movement chooser. Skip, Restart phase, Reset all, Pause, and app launch do not create this purpose.
- **Break completion** — a naturally completed Short or Long break may summon one floating Pet with **Start Focus**, **Later**, and **Close**. It does not offer movement. Skip, Restart phase, Reset all, Pause, and app launch do not create this purpose.
- **Manual companion** — the Focus **Move** tab can show the companion at any time, including with a requested Squat or Overhead Reach. Its first pass reuses the five body motion families and mirrors the main-projected Pet state plus Signal V4; it persists until **Hide** and exposes **Focus**, **Choose move**, and **Hide**. It never prepares, starts, or otherwise changes Pomodoro. An automatic Focus completion does not replace a visible manual companion; the already scheduled macOS completion notification remains the fallback.
- **Setup preview** — **Show Pet** creates a separate preview with dismiss-only controls. It cannot queue a product action, start a break, or start movement; close emits only the bounded ownership-clearing dismissal acknowledgement.

The Pet appears in a separate transparent Tauri window without activating or focusing Agent Halo. A chooser is camera-free; only a specific **10 Squats** or **10 Overhead Reaches** click may request camera access. Setup owns automatic **Completion Pet** On/Off (default On), floating-only `1×`, `1.5×`, or `2×` size (default `2×`), and the **Offer movement after Focus** preference (default Off). Turning automatic Completion Pet Off hides an active Focus-completion or Break-completion summon; manual companion access and a visible manual companion remain available. A successful Focus or break completion display replaces its completion notification; disabled, unavailable, or manual-companion-preserving completion delivery leaves the silent macOS notification as fallback.

## Ownership

The main renderer and `usePomodoro` remain the only Pomodoro state owner. The Pet WebView is projection-only: it never mounts `App`, never runs `usePomodoro`, never writes Pomodoro storage, and never schedules notifications.

```text
main Pomodoro state
  -> native Pet summon projection
  -> hidden/showing Pet WebView
  -> validated Pet action queue
  -> main renderer starts the prepared break
```

The native Pet window atomically stores the initial schema-v2 summon plus main-renderer projection before showing the surface, then accepts live projection updates and one bounded pending action. The hidden Pet renderer reads that projection; it never independently derives session state. A manual companion therefore mirrors main-projected body state and detached Signal V4 until Hide. The main renderer consumes actions: it opens and deliberately focuses the Focus surface for `open-focus`, clears only the matching main-side owner for `dismiss`, only revalidates a Focus-completion `start-break` or `movement-complete` action before starting its prepared break, and only revalidates a Break-completion `start-focus` action before starting the prepared Focus. A manual movement completion returns to the manual companion and queues no Pomodoro action. See `docs/movement-break.md`.

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
- Dragging persists a normalized companion anchor with its source display id/fingerprint and clamps to the current visible frame. The current Setup display selection remains authoritative: if it differs from the saved Pet display, Agent Halo applies the normalized anchor on the selected display rather than showing Pet on the old screen.
- The radial action surface grows around the Pet's screen-space center when space permits, clamps fully into the visible frame, and returns to the saved collapsed position when it closes.
- Pet is created and passively shown non-focusable; passive show never calls `set_focus` or application activation.
- A deliberate user click may explicitly make the Pet focusable and focus its controls.
- Setup preview is a separate summon purpose with dismiss-only radial controls. It never queues or starts a break; close only acknowledges dismissal so main-side ownership cannot remain stale.
- The companion body is the drag surface while the Pet is collapsed or expanded; controls opt out.
- While a movement exercise is open, the same window can be dragged from any non-control surface, or nudged with the arrow keys. Buttons stay clickable. Both paths use the Completion Pet move persistence, so the saved anchor follows the window the same way a companion drag does.
- Reduced motion holds the existing final Done/check frames without sprite playback.

## Preference migration

The preference key is `agent-halo.pet`. When absent, Agent Halo reads the legacy `agent-halo.mascot` value and writes the normalized Pet preference. Fresh installs default to Halo Bot. Only `halo-bot` and `haloform` are valid; retired, unknown, or malformed stored values normalize and rewrite to Halo Bot. Halo Bot's independent `agent-halo.halo-bot-loadout` key stores one four-character base36 ID in `eyes / heads / body / top` order and defaults to `3051`. Validation accepts the complete pinned catalog bounds (`16 × 8 × 7 × 12 = 10,752`) while malformed or out-of-range IDs normalize to the default. The loadout is global, user-selected, and never project-hashed or randomized. Product UI, accessibility copy, types, and settings use **Pet**.

`agent-halo.pet-motion-map` stores one validated presentation mapping from each truthful Letta body state (`idle`, `working`, `attention`, `done`, `error`) to one of those five motion families. The default mapping is identity. Changing the mapping affects only the body strip and playback—for example, `working → idle` keeps semantic `data-state="working"`, Working copy/status precedence, Keep display awake behavior, and the independent Signal V4 activity icon unchanged.

## Global Halo Bot

Halo Bot uses the MIT Pixabots layered character system pinned in the tracked asset provenance. One four-part rig composes face/eyes, head shell, body/outfit, and top accessory. The runtime ships the complete 43-part source catalog and composes the selected ID directly, so every one of the 10,752 combinations is available without pre-generating tens of thousands of state strips. Agent Halo preserves the authored palettes and applies deterministic presentation motion for `idle`, `working`, `attention`, `done`, and `error`; animated eye parts retain their own blink/sequence playback. Signal V4 stays a detached semantic layer and is never baked into the body.

## Global Haloform

Haloform is one global identity across ambient, session, group, detail, Setup, and real Completion Pet surfaces:

- the source is one hash-bound standalone provider image normalized to an approved `96 × 96` canonical master; it is not claimed as provider-native 96px art;
- explicit body/head/face/top masks and reconstructed hidden surfaces make deterministic integer-offset motion possible without changing the neutral canonical image;
- tracked strips deliver `30 × 30` ambient, `36 × 36` session/detail, and `96 × 96` Completion source cells for Idle, Working, Attention, Done, and Error;
- Signal V4 remains an independent truthful semantic layer and is never baked into the body strips;
- provenance, masks, QA, approval receipt, and deterministic builder live at `apps/desktop/assets/mascots/agent-halo-roster/source/haloform-motion-v1/`.

## Verification

- Pet route does not mount main Pomodoro/session/bridge ownership.
- Natural Focus completion summons exactly once; natural Short or Long break completion summons the break Pet exactly once. Skip, restart, reset, pause, and app launch do not.
- Start break action is validated and consumed exactly once by main.
- `×`, Later, automatic-completion disable, and show failure leave no invisible hitbox; a pinned manual companion is dismissed only by **Hide** or app shutdown.
- Passive show preserves the current macOS foreground app and keyboard focus.
- Drag/restore/clamp passes on the selected display, Retina coordinates, and disconnected-display fallback.
- Release evidence must cover browser state/action/accessibility tests, Rust position/state tests, performance budgets, release install/restart, installed-binary equality, and a native foreground smoke; each promotion reports this evidence explicitly rather than treating the Phase 1 contract as a blanket PASS.
