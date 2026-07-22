# Agent Halo Pet roster

This legacy asset path preserves the human-approved source direction for Agent Halo's Pet system.

## Current integration candidate

- Main/default identity: **Halo Bot**. Ember Starling, the original Scorpion, and all sibling robot/companion finalists remain selectable or historically preserved.
- Human decision: one global Pet identity is used across ambient, session, group, detail, and Completion surfaces. Workspace/project hashing remains retired.
- The Pet preference key is `agent-halo.pet`; `agent-halo.mascot` remains a one-way legacy migration source. Fresh/missing/invalid storage falls back to Halo Bot while every valid existing selection remains intact. Halo Bot loadout selection is separately persisted at `agent-halo.halo-bot-loadout`; it defaults to `3051` and allows only the ten curated loadouts, with no project hashing, randomization, or automatic activity swapping.
- Original-roster native body frames remain `24×18`, displayed at `44×33` session/detail and `36×27` ambient. Ember uses smooth `144×144` source cells displayed at `36×36` and `30×30` respectively.
- Delivery wrappers are `66×36` session/detail and `58×30` ambient. The 2px horizontal gap gives the signal more visual authority without colliding with the smaller robot.
- Pet and color randomization are disabled. Original robots keep cyan; Ember preserves its charcoal and ember-orange palette; Halo Bot preserves each selected Pixabots loadout palette.
- Every Pet delivers Idle (3 frames), Working (3), Done (4), Attention (3), and Error (3). The original roster's Attention/Error loops use bounded native-grid edits; Halo Bot uses its promoted deterministic layered rig for all five states.
- The detached semantic signal family uses the human-directed Gemini V4 bold correction: loading, command prompt, pencil, flag, delegation branches, eye, memory chip, top-down question mark, check, and saturated-red error. Every signal is redrawn as a full direct-native `20×20` frame with normally 2px primary strokes; runtime does not scale it.

Mahiro reviewed the repaired robot animation gallery and historically kept Scorpion as its main. On 2026-07-21 Mahiro selected Ember Starling's cut-paper direction, compact master B, and complete five-state body family as the new global default without removing the original roster.

## Halo Bot provenance

On 2026-07-22, Mahiro explicitly approved the reviewed Pixabots motion family as the fresh/default main Pet. `halo-bot` is one Pet identity with ten user-selectable loadouts (`3051`, `1462`, `5324`, `c160`, `2515`, `4232`, `d351`, `6124`, `9132`, `f061`), not ten Pet identities; `3051` is the default. The body strips are exact `36×36` cell PNGs with binary alpha (three-frame `108×36` states and four-frame `144×36` Done), while Signal V4 remains a shared separate layer.

Tracked MIT source layers, copied-part receipts, deterministic compositor, review overview, and promotion receipt live at `source/pixabots-loadout-motion-v1/`. The source is [pablostanley/pixabots](https://github.com/pablostanley/pixabots) pinned to `b384de38a1ac34bdde443e375bb1782841507a75`; no image generation was used. A clean-directory rebuild from the tracked 26 layer sheets reproduces all 50 runtime strips byte-for-byte. The asset is human-approved for runtime integration but remains an overall integration candidate until native validation.

## Source and QA

- `source/frames/<pet>/` contains every accepted roster raster frame plus the static Attention/Error proofs.
- `source/mahiro-main-and-roster-selection.json` is the human decision receipt.
- `source/motion-audition-manifest.json` preserves source hashes and provenance.
- `source/author-semantic-signals-v3.py` and `source/semantic-signals-v3-review-manifest.json` preserve the enlarged Signal V3 delivery source and review hashes.
- `source/author-semantic-signals-v4.py`, `source/semantic-signals-v4-assets/`, and `source/semantic-signals-v4-review-manifest.json` preserve the bold direct-native 20px candidate and its V3 comparison inputs.
- `qa/` contains target-size and zoom contact sheets generated from the exact promoted strips.

## Production approval

The original robot animation art and global selection flow are committed in `c966044`; Ember Starling's later global Pet path is committed in `cd568d7`. Halo Bot remains the current integration candidate until release install/restart and fresh native foreground review pass.

Mahiro separately foreground-approved the review-only Attention/Error motion extension. Those loops preserve each accepted frame-0 identity, palette, baseline, and semantic-signal separation; the exact review generator, manifest, QA report, and contacts are retained under `source/` and `qa/`.
