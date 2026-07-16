# Agent Halo project mascot roster

This folder preserves the human-approved replacement direction for Agent Halo's mascot system.

## Current integration candidate

- Main/default identity: **Scorpion** from `finalists-15-motion-audition-v1`.
- Human decision: return to the original 15 robot/companion finalists and let the user choose one global mascot. Workspace/project hashing is retired; every ambient, session, group, and detail surface uses the same persisted selection.
- The preference key is `agent-halo.mascot`. Missing, invalid, or inaccessible storage falls back to Scorpion.
- Native body frame: `24×18`; Signal V4 candidate reduces session/detail display to `44×33` and collapsed ambient display to `36×27`, both offset 3px from the wrapper top.
- Delivery wrappers are `66×36` session/detail and `58×30` ambient. The 2px horizontal gap gives the signal more visual authority without colliding with the smaller robot.
- Mascot and color randomization are disabled. Every robot keeps the authored cyan palette; the body changes only for truthful Attention/Done/Error state treatment.
- Accepted animated states for every roster entry: Idle (3 frames), Working (3), and Done (4).
- Attention and Error use separately human-approved three-frame loops derived from the compatible static proof frames with bounded one-pixel native-grid edits.
- The detached semantic signal family uses the human-directed Gemini V4 bold correction: loading, command prompt, pencil, flag, delegation branches, eye, memory chip, top-down question mark, check, and saturated-red error. Every signal is redrawn as a full direct-native `20×20` frame with normally 2px primary strokes; runtime does not scale it.

Mahiro reviewed the repaired robot animation gallery and kept Scorpion as the default/main mascot. The later compact creature and dragon explorations remain review history only and must not replace these assets.

## Source and QA

- `source/frames/<mascot>/` contains every accepted roster raster frame plus the static Attention/Error proofs.
- `source/mahiro-main-and-roster-selection.json` is the human decision receipt.
- `source/motion-audition-manifest.json` preserves source hashes and provenance.
- `source/author-semantic-signals-v3.py` and `source/semantic-signals-v3-review-manifest.json` preserve the enlarged Signal V3 delivery source and review hashes.
- `source/author-semantic-signals-v4.py`, `source/semantic-signals-v4-assets/`, and `source/semantic-signals-v4-review-manifest.json` preserve the bold direct-native 20px candidate and its V3 comparison inputs.
- `qa/` contains target-size and zoom contact sheets generated from the exact promoted strips.

## Production approval

The robot animation art and global selection flow are committed in `c966044`. The smaller-body/bold Signal V4 proportion pass remains an integration candidate until browser checks, native release install/restart, and fresh foreground review pass.

Mahiro separately foreground-approved the review-only Attention/Error motion extension. Those loops preserve each accepted frame-0 identity, palette, baseline, and semantic-signal separation; the exact review generator, manifest, QA report, and contacts are retained under `source/` and `qa/`.
