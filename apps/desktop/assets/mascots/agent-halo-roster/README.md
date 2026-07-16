# Agent Halo project mascot roster

This folder preserves the human-approved replacement direction for Agent Halo's mascot system.

## Current integration candidate

- Main/default identity: **Scorpion** from `finalists-15-motion-audition-v1`.
- Human decision: return to the original 15 robot/companion finalists and let the user choose one global mascot. Workspace/project hashing is retired; every ambient, session, group, and detail surface uses the same persisted selection.
- The preference key is `agent-halo.mascot`. Missing, invalid, or inaccessible storage falls back to Scorpion.
- Native body frame: `24×18`; session/detail display: `48×36`; collapsed ambient display: `40×30`; anchor: `[12,16]`.
- The smaller ambient delivery fits the native 30px closed notch without changing the approved session/detail rendering.
- Mascot and color randomization are disabled. Every robot keeps the authored cyan palette; the body changes only for truthful Attention/Done/Error state treatment.
- Accepted animated states for every roster entry: Idle (3 frames), Working (3), and Done (4).
- Attention and Error use separately human-approved three-frame loops derived from the compatible static proof frames with bounded one-pixel native-grid edits.
- The detached semantic signal family uses the human-directed Gemini V3 correction: loading, command prompt, pencil, flag, delegation branches, eye, memory chip, top-down question mark, check, and saturated-red error. Source frames remain direct-native `12×12` and render at `16×16` beside the robot.

Mahiro reviewed the repaired robot animation gallery and kept Scorpion as the default/main mascot. The later compact creature and dragon explorations remain review history only and must not replace these assets.

## Source and QA

- `source/frames/<mascot>/` contains every accepted roster raster frame plus the static Attention/Error proofs.
- `source/mahiro-main-and-roster-selection.json` is the human decision receipt.
- `source/motion-audition-manifest.json` preserves source hashes and provenance.
- `source/author-semantic-signals-v3.py` and `source/semantic-signals-v3-review-manifest.json` preserve the enlarged Signal V3 delivery source and review hashes.
- `qa/` contains target-size and zoom contact sheets generated from the exact promoted strips.

## Production approval

The robot animation art remains foreground-approved. The new global selection flow and enlarged Signal V3 integration are candidates until browser checks, native release install/restart, and fresh foreground review pass.

Mahiro separately foreground-approved the review-only Attention/Error motion extension. Those loops preserve each accepted frame-0 identity, palette, baseline, and semantic-signal separation; the exact review generator, manifest, QA report, and contacts are retained under `source/` and `qa/`.
