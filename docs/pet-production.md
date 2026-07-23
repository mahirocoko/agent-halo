# Pet and loadout production

This document describes how Agent Halo should add a future Pet identity or Halo Bot loadout without losing source provenance, motion quality, runtime truth, or release reproducibility.

## Choose the correct lane

Use a **new Pet identity** when the character has its own silhouette, authored materials, semantic anatomy, and source lineage. Haloform is the current example.

Use a **Halo Bot loadout** when the result remains the same Halo Bot identity and motion rig, but selects a different compatible face/head/body/top composition. A loadout is not a separate Pet and must not change automatically with Letta activity.

Do not use a new identity merely to expose palette variants, project hashing, or activity-specific costumes. Agent Halo keeps one global user-selected Pet, one separately selected Halo Bot loadout, and one presentation-only state-to-motion map.

## Shared runtime contract

Every selectable Pet must provide these five motion families:

| Motion | Frames | Playback |
| --- | ---: | --- |
| `idle` | 3 | loop |
| `working` | 3 | loop |
| `attention` | 3 | loop |
| `done` | 4 | play once and hold the final frame |
| `error` | 3 | loop |

Current delivery surfaces are:

- ambient: `30 × 30` source cells;
- session/detail: `36 × 36` source cells;
- Completion Pet: square source cells, currently `96 × 96` for Haloform and `36 × 36` for Halo Bot before CSS presentation scaling;
- binary alpha with transparent background;
- shared detached Signal V4 at `20 × 20`.

The semantic state and selected body motion are intentionally different values:

```text
truthful Letta state -> data-state / status / copy / Signal V4 / Keep awake
user motion mapping  -> data-motion / body strip / body playback only
```

Never use the motion mapping to change status priority, accessibility copy, Pomodoro ownership, Keep display awake, or Signal V4. Completion Pet is a separate Pomodoro projection and keeps its own Working presentation.

## Lane A: create a new Pet identity

### 1. Freeze source authorship and provenance

Choose one explicit source mode before editing:

- `imagegen-required`: keep the untouched provider raster, provider receipt, prompt/job identity, dimensions, and SHA-256;
- licensed source: pin repository/revision/license and copy the exact source parts used;
- manual original: retain the authored source file and a truthful authorship note.

Reference images are not source pixels. Never silently switch from the selected standalone source to a crop from an exploded sheet or review composition.

For provider-backed work, preserve:

```text
provider/raw/<untouched-raster>
provider/upstream-provider-receipt.json
provider/selected-source-receipt.json
```

### 2. Establish the canonical master

Normalize from the selected source into one explicit native master. Record:

- source hash and crop/foreground bounds;
- target dimensions and safe transparent perimeter;
- alpha policy and palette budget;
- every bounded cleanup/retouch class and pixel count;
- truthful wording such as “provider-derived native96 normalization,” not “provider-native 96px art.”

Review the character at actual target size and zoom. Mechanical palette/alpha checks do not prove that the silhouette, face, materials, or small-scale readability survived normalization.

Haloform lesson: native48 was rejected because it lost source clarity. The accepted lane uses a canonical native96 master and derives smaller runtime deliveries from that tracked master.

### 3. Define semantic anatomy before motion

Create explicit same-canvas layers in this order:

```text
body -> head -> face -> top
```

Each layer must own the intended visible pixels exactly once. Reconstruct hidden surfaces that motion may reveal:

- body: a shaped, shaded neck/chassis continuation under Head;
- head: a complete feature-free screen under Face;
- head: a plausible cap under Top;
- face: feature components only, never a copied screen rectangle;
- top: the complete bulbs/stalk/mount assembly.

Create explicit visible and hidden-surface masks plus a labeled ownership overlay. Broad coordinate rectangles or color thresholds are useful diagnostics, not final semantic masks.

Neutral recomposition must be byte-exact, but `diff = 0` is only a neutral-pose gate. It does not prove animation-ready masks.

### 4. Run a motion-mask acceptance gate

Before authoring state strips, render offsets that deliberately expose every hidden boundary. Haloform used:

- Face `+2px` and `-2px` X;
- Top `-3px` Y and `+2px` X;
- Head + Face + Top `-4px` Y;
- Error opposition: Body `+3px` X, Head/Face `-3px` X, Top `-4px` X.

Inspect actual native size and nearest-neighbor zoom. Reject the masks if any pose reveals:

- old eye/feature ghosts;
- a screen patch moving with Face;
- abandoned stalk or mount pixels;
- flat underlay slabs;
- transparent holes or broken seams;
- clipped anatomy, chroma fringe, or cross-layer contamination.

A visual model may propose mask boundaries, but its PASS claim is not acceptance evidence. Keep the analysis overlay and motion grid, then inspect the rendered pixels directly and require Mahiro's review.

### 5. Author deterministic motion

Prefer integer layer translations over redrawing the approved identity when the anatomy supports them. Keep recipes as data and make the builder deterministic.

The review HTML should show:

- every state and frame strip;
- actual native size plus runtime sizes;
- enlarged nearest-neighbor view;
- frame timing and playback mode;
- exact per-layer offsets;
- a truthful source/authorship note.

Do not promote motion from hashes alone. Human review must cover readability, identity preservation, seams, silhouette, and whether each state communicates at runtime size.

### 6. Promote a self-contained tracked package

Promotion must not depend on ignored `.agent-state` files. Track a package shaped like:

```text
apps/desktop/assets/mascots/agent-halo-roster/source/<pet>-motion-vN/
  provider/ or licensed-source/
  canonical/
  layers/
  masks/
  motion/
  evidence/
  review/
  human-approval-receipt.json
  build_<pet>_motion.py
```

Runtime files belong under:

```text
apps/desktop/public/mascots/agent-halo-roster/body/<pet>/
  ambient/{idle,working,attention,done,error}.png
  session/{idle,working,attention,done,error}.png
  completion/{idle,working,attention,done,error}.png
  manifest.json
```

The tracked builder must reproduce every strip and manifest hash from the tracked package alone.

## Lane B: add a Halo Bot loadout

Halo Bot is one identity backed by the pinned MIT Pixabots layered rig. A new loadout should:

1. use the existing pinned source revision and license;
2. select one compatible face/eyes, head, body/outfit, and top accessory combination;
3. add a stable short loadout ID and user-facing label;
4. reuse the shared deterministic five-state Halo Bot motion rig;
5. preserve the authored source palette without random hue or project assignment;
6. rebuild all five strips at `36 × 36` source cells;
7. add source-part hashes and the composed-strip hashes to the tracked receipt;
8. add the ID to both TypeScript and Rust allowlists;
9. verify Setup selection, persistence, Completion projection, and invalid-value fallback.

Update these active contracts together:

```text
apps/desktop/src/features/session/haloBot.ts
apps/desktop/src-tauri/src/pet_window.rs
apps/desktop/public/mascots/agent-halo-roster/manifest.json
apps/desktop/assets/mascots/agent-halo-roster/source/pixabots-loadout-motion-v1/
apps/desktop/tests/demo-pet.spec.ts
apps/desktop/tests/demo-completion-pet.spec.ts
```

Do not create a new Pet ID for each loadout and do not swap loadouts from semantic state or `agent-halo.pet-motion-map`.

## Runtime integration checklist

Adding or removing a Pet identity is cross-layer. Keep these surfaces aligned:

- TypeScript roster, body URL resolution, and semantic/motion data attributes: `features/session/HaloPet.tsx`;
- Pet preference normalization/migration: `features/session/petPreference.ts`;
- motion mapping validation/persistence: `features/session/petMotion.ts`;
- Setup picker and mapping controls: `features/setup/SetupPanel.tsx`;
- main ambient/session/detail propagation: `main.tsx` and `features/session/components.tsx`;
- Completion projection: `features/pet/PetApp.tsx` and `features/pet/types.ts`;
- native summon allowlist/loadout validation: `src-tauri/src/pet_window.rs`;
- ambient/session/Completion geometry and playback: `styles/notch-surface-motion.css`, `styles/pet.css`, and `styles/setup.css`;
- public roster manifest, docs, tests, and explicit performance asset lane.

Retired IDs should normalize and rewrite to the default Pet. Remove retired public runtime files only after that migration is implemented; historical source/provenance may remain outside the public bundle.

## Human approval gates

Use separate, explicit decisions:

1. source identity selected;
2. canonical native master accepted;
3. semantic masks and hidden surfaces accepted under motion;
4. five-state motion accepted at target size;
5. runtime footprint selected;
6. tracked promotion and runtime integration approved;
7. native foreground feel accepted after install.

A script pass, model verdict, or neutral hash cannot substitute for a visual decision. Record what was approved and what remains unapproved in the receipt/status files.

## Verification and release

Minimum validation for a Pet or loadout promotion:

```bash
/usr/bin/python3 <tracked-builder>
pnpm check
pnpm exec playwright test apps/desktop/tests/demo-pet.spec.ts apps/desktop/tests/demo-completion-pet.spec.ts --workers=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm test:performance
pnpm desktop:install
```

Also verify:

- deterministic rebuild and every public manifest hash;
- no retired public body directories when the roster is intentionally reduced;
- semantic `data-state` remains truthful when `data-motion` is remapped;
- Signal V4 remains independent;
- reduced motion behavior;
- installed binary equals the built release binary;
- the installer actually quit/relaunched stale running code;
- passive launch does not steal foreground focus;
- bridge reconnects after restart;
- native Completion show/expand/drag/actions still behave correctly.

Browser demo proves layout/state logic, not native Tauri positioning, focus, drag, or AppKit behavior. Keep native foreground acceptance as a separate final gate.
