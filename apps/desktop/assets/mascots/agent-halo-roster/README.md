# Agent Halo project mascot roster

This folder preserves the human-approved replacement direction for Agent Halo's mascot system.

## Current integration candidate

- Main identity: **Scorpion** from `finalists-15-motion-audition-v1`.
- Human decision: all 15 finalists remain in the deterministic project roster, and every accepted audition identity is now present in the runtime asset namespace.
- Native body frame: `24×18`; session/detail display: `48×36`; collapsed ambient display: `40×30`; anchor: `[12,16]`.
- The smaller ambient delivery fits the native 30px closed notch without changing the approved session/detail rendering.
- Each workspace/project key hashes deterministically to one roster entry, so every session in the same project keeps the same mascot across reloads.
- Mascot/project color randomization is disabled. The shared cyan palette changes only for truthful Attention/Done/Error state treatment.
- Accepted animated states for every roster entry: Idle (3 frames), Working (3), and Done (4).
- Attention and Error use separately human-approved three-frame loops derived from the compatible static proof frames with bounded one-pixel native-grid edits.
- The existing human-approved semantic signal family is copied unchanged into the new shared roster namespace.

Mahiro reviewed the repaired animation gallery and exported Scorpion as main. That visual decision is authoritative. The later Gemini anatomy redraws and partial Codex imagegen masters are experiments only and must not replace these assets.

## Source and QA

- `source/frames/<mascot>/` contains every accepted roster raster frame plus the static Attention/Error proofs.
- `source/mahiro-main-and-roster-selection.json` is the human decision receipt.
- `source/motion-audition-manifest.json` preserves source hashes and provenance.
- `qa/` contains target-size and zoom contact sheets generated from the exact promoted strips.

## Production approval

Mahiro foreground-approved the installed native roster on 2026-07-16 after the collapsed ambient delivery was corrected from `48×36` to `40×30`, deterministic project assignment was activated, and project color randomization was removed. Browser layout, asset hashes, alpha, reduced motion, full demo regression, native release build/install/restart, and live bridge health passed before approval.

Mahiro separately foreground-approved the review-only Attention/Error motion extension. Those loops preserve each accepted frame-0 identity, palette, baseline, and semantic-signal separation; the exact review generator, manifest, QA report, and contacts are retained under `source/` and `qa/`.
