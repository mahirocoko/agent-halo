# Halo Soft Cube mascot

Halo Soft Cube is the production-approved Agent Halo mascot: an original rounded four-sided pixel pet with discrete pseudo-3D highlight, front-plane, and bottom/right shadow tones. It is 2D native-grid pixel art, not a 3D/voxel render.

## Selected identity

- Human-selected family: Candidate A, Balanced Rounded Cube.
- Forms: `core`, `cat-corner`, and `sprout`.
- Source frame: `16×12` with anchor `[8,10]` and baseline `y=10`.
- Display frame: `32×24`, nearest-neighbor only.
- Body and mote animate as independent layers.
- Vibe Island was used only to study tiny readability and low-frame motion grammar. No pixels, silhouettes, or exact timing were copied.

## Runtime assets

`apps/desktop/public/mascots/halo-soft-cube/` contains:

- 15 two-frame body strips: three forms × five presence states;
- five independent mote strips;
- `manifest.json` with cadence, palette, hashes, provenance, and candidate status.

Canonical runtime strips use one five-tone cyan palette. CSS hue/saturation filters provide deterministic working-session variation and attention/done/error overrides while preserving tonal depth. Visible status text/glyphs remain the semantic source of truth; color is supplementary.

## Source and QA

- `source/` retains the selected master frames, exact palette-index map, selection receipt, and procedural native-grid authoring script.
- `qa/` retains the all-state board, state recolor proof, restrained-glow simulation, and honest candidate report.
- Canonical rasters use binary alpha and contain no baked blur/glow.

## Promotion evidence

Mahiro selected Candidate A, approved deleting the legacy session cat, and accepted the installed refactor for commit after compact/row rendering, body/mote cadence, state colors, reduced motion, deterministic forms, overflow, equal padding, native release install/restart, and live bridge checks passed. The candidate-generation report remains historical evidence of the earlier pre-promotion state.
