# Agent Halo Pet roster

Future Pet identity and Halo Bot loadout workflow: [`../../../../../docs/pet-production.md`](../../../../../docs/pet-production.md).

This asset family preserves active runtime provenance plus historical Pet source evidence.

## Current integration candidate

- Main/default identity: **Halo Bot**. **Haloform** is the only other selectable identity. Earlier companions remain historical source evidence but are removed from the public runtime roster.
- Human decision: one global Pet identity is used across ambient, session, group, detail, and Completion surfaces. Workspace/project hashing remains retired.
- The Pet preference key is `agent-halo.pet`; `agent-halo.mascot` remains a one-way legacy migration source. Fresh, retired, unknown, or malformed storage normalizes and rewrites to Halo Bot. Halo Bot loadout selection is separately persisted at `agent-halo.halo-bot-loadout`; it defaults to `3051` and allows only the ten curated loadouts, with no project hashing or randomization.
- Halo Bot and Haloform both display at `36×36` session/detail and `30×30` ambient inside the existing `66×36` / `58×30` wrappers. Haloform keeps a tracked `96×96` source/Completion master.
- Every active Pet delivers Idle (3 frames), Working (3), Done (4), Attention (3), and Error (3). Halo Bot uses its deterministic layered Pixabots rig; Haloform uses its approved provider-derived canonical master, explicit semantic masks, and deterministic integer offsets.
- `agent-halo.pet-motion-map` may redirect semantic states to body motions. This never changes status semantics or the detached Signal V4 layer.
- The detached semantic signal family uses the human-directed Gemini V4 bold correction: loading, command prompt, pencil, flag, delegation branches, eye, memory chip, top-down question mark, check, and saturated-red error. Every signal is redrawn as a full direct-native `20×20` frame with normally 2px primary strokes; runtime does not scale it.

Mahiro's earlier Scorpion and Ember decisions remain in source history. On 2026-07-23 Mahiro explicitly reduced the active roster to Halo Bot plus Haloform and approved Haloform's explicit-mask motion for runtime integration.

## Haloform provenance

The complete standalone provider raster, compact receipt, canonical native96 master, explicit visible/hidden masks, QA evidence, human approval receipt, deterministic builder, and delivery review live at `source/haloform-motion-v1/`. The source is provider-derived and manually normalized; it is not described as provider-native 96px art. The builder reproduces ambient, session, and Completion strips without depending on ignored `.agent-state` files.

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

The original robot animation art and global selection flow are committed in `c966044`; Ember Starling's historical path is committed in `cd568d7`; Halo Bot is committed in `3885825`. The current two-Pet roster and Haloform remain an integration candidate until release install/restart and fresh native foreground review pass.

Mahiro separately foreground-approved the review-only Attention/Error motion extension. Those loops preserve each accepted frame-0 identity, palette, baseline, and semantic-signal separation; the exact review generator, manifest, QA report, and contacts are retained under `source/` and `qa/`.
