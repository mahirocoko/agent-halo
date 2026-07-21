# Agent Halo Pet roster

This legacy asset path preserves the human-approved source direction for Agent Halo's Pet system.

## Current integration candidate

- Main/default identity: **Ember Starling**. The original Scorpion and all fourteen sibling robot/companion finalists remain selectable.
- Human decision: one global Pet identity is used across ambient, session, group, detail, and Completion surfaces. Workspace/project hashing remains retired.
- The Pet preference key is `agent-halo.pet`; `agent-halo.mascot` remains a one-way legacy migration source. Fresh/missing/invalid storage falls back to Ember Starling while every valid existing selection remains intact.
- Original-roster native body frames remain `24×18`, displayed at `44×33` session/detail and `36×27` ambient. Ember uses smooth `144×144` source cells displayed at `36×36` and `30×30` respectively.
- Delivery wrappers are `66×36` session/detail and `58×30` ambient. The 2px horizontal gap gives the signal more visual authority without colliding with the smaller robot.
- Pet and color randomization are disabled. Original robots keep cyan; Ember preserves its charcoal and ember-orange palette.
- Accepted animated states for every roster entry: Idle (3 frames), Working (3), and Done (4).
- Attention and Error use separately human-approved three-frame loops derived from the compatible static proof frames with bounded one-pixel native-grid edits.
- The detached semantic signal family uses the human-directed Gemini V4 bold correction: loading, command prompt, pencil, flag, delegation branches, eye, memory chip, top-down question mark, check, and saturated-red error. Every signal is redrawn as a full direct-native `20×20` frame with normally 2px primary strokes; runtime does not scale it.

Mahiro reviewed the repaired robot animation gallery and historically kept Scorpion as its main. On 2026-07-21 Mahiro selected Ember Starling's cut-paper direction, compact master B, and complete five-state body family as the new global default without removing the original roster.

## Source and QA

- `source/frames/<pet>/` contains every accepted roster raster frame plus the static Attention/Error proofs.
- `source/mahiro-main-and-roster-selection.json` is the human decision receipt.
- `source/motion-audition-manifest.json` preserves source hashes and provenance.
- `source/author-semantic-signals-v3.py` and `source/semantic-signals-v3-review-manifest.json` preserve the enlarged Signal V3 delivery source and review hashes.
- `source/author-semantic-signals-v4.py`, `source/semantic-signals-v4-assets/`, and `source/semantic-signals-v4-review-manifest.json` preserve the bold direct-native 20px candidate and its V3 comparison inputs.
- `qa/` contains target-size and zoom contact sheets generated from the exact promoted strips.

## Production approval

The original robot animation art and global selection flow are committed in `c966044`. Ember Starling remains a runtime integration candidate until release install/restart and fresh native foreground review pass.

Mahiro separately foreground-approved the review-only Attention/Error motion extension. Those loops preserve each accepted frame-0 identity, palette, baseline, and semantic-signal separation; the exact review generator, manifest, QA report, and contacts are retained under `source/` and `qa/`.
