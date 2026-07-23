# QA Report — Native96 Animation-Ready Semantic Decomposition

## Summary
- **Job ID**: 20260723-haloforms-clarity-master96-semantic-v3
- **Source Asset**: `assets/call_TJam6nD90EGODPCWIlZHJxVr.png`
- **Source SHA256**: `eb7d1d8abfcdcb5c41fa279fb0b9851d2571d5ba9c688cce0e30ee35d8067b98` (EXACT MATCH)
- **Target Dimensions**: `96x96` RGBA, binary alpha `{0, 255}`
- **Palette Size**: 48 colors (Limit <= 64 colors)
- **Perimeter Margin**: >= 3px transparent on all edges (Limit >= 2px)

## Semantic Layer Structure
1. `body.png`: Chassis, arms, core, tracks + contoured shaded neck underlay (`y=60..67`, `x=42..55`).
2. `head.png`: Cream CRT shell, ears, feature-free dark CRT screen underlay + cream shell top cap underlay (`y=17..18`, `x=45..53`).
3. `face.png`: Eyes, eye rims/shadows, mouth glow, cheek blush only (234 px, 0 dark screen background pixels).
4. `top.png`: Antenna bulbs, stalk, connector base (`y=3..18`, 293 px).

## Gate Verification Results
- **Source Hash Gate**: PASSED
- **Dimensions & Alpha Gate**: PASSED (96x96 RGBA, binary alpha `{0, 255}`)
- **Palette Budget Gate**: PASSED (48 colors <= 64)
- **Visible Ownership Gate**: PASSED (Exhaustive & Exclusive, 4227 px)
- **Neutral Recomposition Gate**: PASSED (Byte-exact, `diffPixelCount = 0`)
- **Motion Acceptance Gate**: REFINED & TESTED at 96px & 6x for 7 offset poses (no ghosts, dark patch dragging, hole carving, or flat neck bars).

## Final Gate Status
- **Status**: `needs-human-review`
- **Promotion Approved**: `false`
- **Reason**: Refined semantic masks visually accepted under automated synthetic motion suite; held for human review as requested.
