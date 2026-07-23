# Semantic Mask Anatomy & Refinement Analysis

## 1. Job Identification & Context
- **Job ID**: `20260723-haloforms-clarity-master96-semantic-v3`
- **Canonical Master**: `outbox/canonical-master.png` (96x96 RGBA, file SHA256: `cfe819f6c97cb8251f34eb5f55acdb3cbfe461ced285f109502ad4cbdc6565fb`)
- **Evaluation Lens**: Gemini 3.6 Flash High visual judgment. Do NOT defend previous PASS claims.

---

## 2. Why Prior Masks Failed
1. **Face Threshold & Dilation Flaw**:
   - Prior code used a naive `screen_delta > 35` color distance threshold to pick Face seed pixels, then ran a blind 1px 8-neighborhood expansion.
   - This missed dark eye rims and subtle feature shadows (RGB diff 8..27 from background), leaving them stuck on the `head.png` layer as stationary dark silhouettes ("eye ghosts").
   - When Face shifted (+2x, -2x), the eye/mouth lost its outer rim/shadow pixels and dragged incomplete feature edges across stationary eye ghost silhouettes on the screen.

2. **Top Antenna / CRT Crown Contamination**:
   - Prior code blindly assigned all pixels in `y=3..28`, `x=43..56` to Top.
   - This stole part of the cream CRT head shell crown and head vent/socket detail (y=19..27), while leaving the sides on Head.
   - When Top moved up (-3y) or sideways (+2x), Top dragged chunks of the CRT head shell with it, carving a hole/notch in Head.

3. **Crude Neck Underlay**:
   - Prior code used a full-width flat teal rectangular bar under Head.
   - When Head moved up (-4y), the body-head junction appeared as a blocky horizontal slab instead of a contoured, shaded neck assembly matching chassis material.

---

## 3. Exact 96px Character Semantic Anatomy & Coordinate Bounds

| Component | Semantic Scope | Exact Pixel Bounds | Visible Count | Hidden Underlay Scope |
| :--- | :--- | :--- | :---: | :--- |
| **Top** | Antenna bulbs (top, left, right), stalk, connector base | `y=[3..18]`, `x=[33..64]` | 293 px | N/A |
| **Face** | Left/Right eyes, eye rims/shadows, mouth glow, cheek blush | `y=[44..60]`, `x=[24..58]` | 234 px | N/A (0 dark screen background pixels) |
| **Head** | Cream CRT shell, side ear modules, empty dark screen | `y=[19..67]`, `x=[15..80]` | 2321 px | Screen underlay behind Face; Cap underlay behind Top |
| **Body** | Chassis, arms, yellow core module, treads/tracks | `y=[68..92]`, `x=[18..78]` | 1379 px | Contoured shaded neck underlay under Head (`y=[60..67]`) |

---

## 4. Boundary Ambiguities & Occlusion Rules
1. **Top / Head Boundary (`y=18 / y=19`)**:
   - The dark seam at `y=19` is the top edge of the CRT head shell. Top is strictly bounded at `y=18`.
   - The hidden `head-cap-underlay` on Head extends behind Top at `y=17..18` (`x=45..53`) with plausible cream CRT shell (`RGB [253, 239, 195]`).

2. **Face / Head Screen Boundary (`y=44..60`)**:
   - Face visible mask contains 100% of authored eye, rim, shadow, mouth, glow, and cheek blush pixels (234 px).
   - Head layer under Face contains a reconstructed feature-free dark CRT screen surface sampled from surrounding screen pixels (`RGB [20, 22, 20]`).

3. **Head / Body Neck Boundary (`y=67 / y=68`)**:
   - Head bottom shell ends at `y=67`. Body starts at `y=68`.
   - Body neck underlay extends under Head from `y=60` to `y=67` (`x=42..55`) as a tapered, contoured assembly with dark outline (`RGB [20, 22, 20]`) and shaded teal body material (`RGB [58, 116, 118]`).

---

## 5. Verification & Visual Motion Gate Results
- **Canonical Master Preservation**: Preserved byte-for-byte (file SHA256: `cfe819f6c97cb8251f34eb5f55acdb3cbfe461ced285f109502ad4cbdc6565fb`).
- **Neutral Recomposition**: PASSED (`diffPixelCount = 0`).
- **Visible Ownership**: Exhaustive & Exclusive (293 + 234 + 2321 + 1379 = 4227 px).
- **Motion Acceptance**: Verified at 96px & 6x for 7 offset poses:
  1. Neutral pose: Byte-exact match.
  2. Face +2px X: Clean dark screen revealed, 0 eye ghosts.
  3. Face -2px X: Clean dark screen revealed, 0 eye ghosts.
  4. Top -3px Y: Smooth cream CRT shell cap revealed, 0 abandoned stalk/hole.
  5. Top +2px X: Smooth cream CRT shell cap revealed.
  6. Head -4px Y: Tapered contoured teal neck revealed, 0 flat slab.
  7. Error Opposition: No cross-layer contamination or clipping.

---

## 6. Status & Remaining Visual Risks
- **Status**: `needs-human-review`
- **Promotion Approved**: `false`
- **Remaining Visual Risks**: While explicit component masks eliminate feature ghosts and dark patches on all 7 synthetic offset poses, true runtime animation interpolation or sub-pixel scaling must be reviewed visually by Mahiro before production deployment.
