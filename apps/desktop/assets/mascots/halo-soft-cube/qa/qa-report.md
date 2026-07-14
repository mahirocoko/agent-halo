# Halo Soft Cube layered animation v2 — QA report

## Gate and provenance

- Candidate A — Balanced Rounded Cube only.
- Source lane: `manual`; usage: `source-candidate`.
- Authoring: local procedural indexed-pixel reconstruction from the immutable `palette-index.json` rows, validated pixel-for-pixel against all three immutable PNG sources before output.
- `productionApproved=false`. No tracked/runtime files were written.
- Canonical body and mote strips contain no glow. `qa/restrained-glow-simulation.png` is preview-only.

## Contract results

- 15 body strips: exact `32×12`, two `16×12` frames each.
- 5 mote strips: exact native `4×4` cells with counts `3/4/4/2/3` for idle/working/attention/done/error.
- 15 composite GIFs: exact target frame `32×24`, nearest-neighbor 2× scaling.
- Indexed PNG palette: opaque indices `0..4`, transparent index `255`; decoded alpha values are binary `0/255` only.
- Body reserve `x=12..15` is clear in every frame. The extracted static source mote is preserved as `outbox/mote-source-reserve.png` and all animated motes have independent lineage.
- Bounds are stable by form: core `[1,2,11,10]`; cat-corner `[1,0,11,10]`; sprout `[1,0,11,10]`.
- Baseline is `y=10` and anchor is `[8,10]` for all body frames.
- Silhouette alpha masks, appendages, scale, translation, rotation, and plane geometry are unchanged between source and authored body frames.
- All state recolor palettes pass strict `bright > light > base > shadow > deep` relative-luminance ordering. Canonical palette indices are preserved exactly; recolors are QA composites only.

## Changed opaque palette pixels from cleared source

| form | state | frame 0 | frame 1 |
| --- | --- | ---: | ---: |
| core | idle | 0 | 3 |
| core | working | 1 | 3 |
| core | attention | 1 | 3 |
| core | done | 0 | 3 |
| core | error | 2 | 4 |
| cat-corner | idle | 0 | 3 |
| cat-corner | working | 1 | 3 |
| cat-corner | attention | 1 | 3 |
| cat-corner | done | 0 | 3 |
| cat-corner | error | 2 | 4 |
| sprout | idle | 0 | 3 |
| sprout | working | 1 | 3 |
| sprout | attention | 1 | 3 |
| sprout | done | 0 | 3 |
| sprout | error | 2 | 4 |

Edits are limited to face, top specular, and one interior lower-right deep-shadow accent in error frame 1. No alpha pixel changes occur inside the body lineage.

## Cadence and loop notes

- Body: idle 500ms loop; working 320ms loop; attention 380ms loop; done 500ms one-shot/hold-final; error 300ms loop.
- Mote: idle 450ms ×3; working 180ms ×4; attention 220ms ×4; done 300ms ×2 one-shot/hold-final; error 160ms ×3.
- Composite GIFs preserve independent body/mote event timing over the exact least-common-multiple cycle for looping states. Resulting cycle lengths are idle 27000ms, working 5760ms, attention 16720ms, and error 2400ms. Done is a bounded 1000ms one-shot preview with the final body/mote held through the end; GIF metadata repeats once only because GIF has no universal hold-final playback primitive.
- The all-state GIF is a compact comparison surface, not cadence proof; inspect the 15 per-state composites for timing.

## QA surfaces

- `qa/source-light-qa.png`, `qa/source-dark-qa.png`, `qa/source-checker-qa.png`
- `qa/state-palette-recolor-qa.png`
- `qa/restrained-glow-simulation.png`
- `qa/adjacent-frames/*.png`
- `qa/all-state-board.png`, `qa/all-state-preview.gif`
- `qa/validation.json`

## Visual caveats

- At `32×24`, the attention mote reads as a tiny alert/question-like mark, but its semantic punctuation is intentionally abstract to avoid dominating the cube.
- Idle’s exact independent cadence creates a long 27-second composite cycle; the visible motion remains sparse and calm, but runtime integration may prefer separate body/mote clocks rather than a precomposed GIF.
- The error brow uses two existing interior pixels above the eyes; it reads worried at target size without changing silhouette, but should receive Mahiro motion review on the actual light and dark UI surfaces.
- The done smile is deliberately only two added deep-tone mouth pixels plus a one-pixel specular settle. Stronger motion was rejected because it compromised the stable square volume.
- Glow is intentionally absent from canonical assets. The glow QA is restrained simulation only and is not evidence for runtime blending behavior.
