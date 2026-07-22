# Pixabots attribution

- Upstream: https://github.com/pablostanley/pixabots
- Pinned revision: `b384de38a1ac34bdde443e375bb1782841507a75`
- License: MIT License, Copyright (c) 2026 Pablo Stanley; exact upstream license is retained as `LICENSE`.
- Selected contract: one Agent Halo Pet identity, `halo-bot`, with curated selectable loadouts `3051`, `1462`, `5324`, `c160`, `2515`, `4232`, `d351`, `6124`, `9132`, and `f061`; default loadout `3051`.
- Construction: deterministic layered compositor using exact copied Pixabots top → body → heads → eyes PNG parts, source-sheet frame selection, and native integer translations only.
- No-imagegen truth: no image-generation source or service was used. No smoothing, recoloring, gradients, or flattened face painting was used.
- Reproduction: the exact 26 source layer sheets are retained under `assets/parts/` and hash-bound by `copied-parts-manifest.json`. `build_pixabot_motion.py` consumes only those relative tracked inputs; a clean-directory rebuild reproduces all 50 runtime strips byte-for-byte.
- Signal boundary: Signal V4 remains a separate shared runtime layer and is not baked into these body strips.
