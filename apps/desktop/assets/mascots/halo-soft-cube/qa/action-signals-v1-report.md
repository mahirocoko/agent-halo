# Halo Soft Cube semantic action signals v1

## Contract

- The Soft Cube body continues to express broad affect: `idle`, `working`, `attention`, `done`, or `error`.
- The detached right-side layer is a semantic action/status signal, not a tail or decorative mote.
- Idle/inactive has no signal asset or DOM layer.
- Ten grouped signals cover the existing `ActivityKind` union without inventing one icon per raw tool.
- Frame 0 is the static/reduced-motion source of truth; frame 1 changes only a restrained accent, cursor, pupil, packet, or sparkle.

## Candidate comparison

The previous `4×4` native source was tested as a control and rejected for this vocabulary. At 2× display blocks, terminal/editing/memory converged into similar rectangles, delegating/visual became dots or bars, and done/error lost useful motion or silhouette detail. The first `8×8` display candidate separated the meanings but Mahiro found it too small in the installed app.

Selected runtime Candidate C uses a `6×6` native binary-alpha frame displayed at exact 2× as `12×12`, origin `[26,6]`. It keeps the wrapper at `32×24`, extends right by 6 visible pixels, provides a 4px visual gap after the body silhouette, and has zero body-alpha overlap across 600 form/state/frame/signal combinations. Thought, terminal, document/pencil, flag, branch, eye, storage, question, check, and X are larger while sharing the body's 2px logical display grid.

## Evidence

- `action-signals-v1-dark-1x.png` — actual target-size dark-surface contact sheet.
- `action-signals-v1-dark-4x.png` — nearest-neighbor dark inspection.
- `action-signals-v1-light-4x.png` — light-background edge inspection.
- `action-signals-v1-checker-4x.png` — alpha-edge inspection.
- Every runtime strip is `24×12`: two `12×12` display frames authored from `6×6` native sources.
- Alpha values are binary (`0` or `255`); there is no blur, antialiasing, glow, imagegen, or third-party pixel source.
- Source is deterministic coordinate authoring in `source/author-action-signals-v2.py`; `v1` preserves the smaller comparison candidates.

## Promotion state

This signal family is production-approved. TypeScript, 28 demo/accessibility regressions, 5 hook integrations, 3 Rust tests, performance budgets, source/runtime/dist hash parity, repeated release build/install/restart, zero-overlap geometry, and dark/light/checker/native rendering passed. Mahiro accepted the final installed `12×12` Candidate C at `[26,6]` with a 4px visual gap.

## Human correction pass

Mahiro found the first enlarged done glyph too noisy to read as a check and supplied tiny working/question/unknown status snippets as visual-language reference. The corrected source keeps original pixels: thinking/model now uses a compact blue sparkle/cross, attention uses a cleaner question silhouette, and done uses one continuous check with reduced shadow noise. The unknown green reference was intentionally not adopted because its semantics were not established.
