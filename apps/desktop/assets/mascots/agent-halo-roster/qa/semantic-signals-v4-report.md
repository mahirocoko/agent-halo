# Agent Halo Semantic Signals V4 QA Report

Generated at: 2026-07-16T09:47:16.027385+00:00
Lineage: `gemini` source lane | direct-native 20x20 bold grids | V4 Review

## Status Summary

| Signal | Alpha (Binary) | Palette | Bounds (1px Safety) | Stroke 2px Intent | Adjacent Deltas | Duplicate Frames | Mascot Overlap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `thinking-model` | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS (2px) | 50, 50, 50, 50 | None | 0px (None) |
| `shell-tool-skill` | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS (2px) | 20, 20, 20 | None | 0px (None) |
| `editing` | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS (2px) | 95, 95, 137 | None | 0px (None) |
| `planning-goal` | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS (2px) | 4, 17, 16 | None | 0px (None) |
| `delegating` | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS (2px) | 32, 48, 48 | None | 0px (None) |
| `visual` | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS (2px) | 52, 64, 52 | None | 0px (None) |
| `memory` | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS (2px) | 16, 36, 36 | None | 0px (None) |
| `attention-asking` | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS (2px) | 12, 10, 12, 32 | None | 0px (None) |
| `done` | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS (2px) | 24, 26, 11, 57 | None | 0px (None) |
| `error` | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS (2px) | 156, 168, 156 | None | 0px (None) |

## Design Rationale and Verification Notes

### 1. thinking-model
- **Concept**: 4-frame thick segmented loading ring (18x18 outer bounds, 2px thick core, 1px canvas safety). Bright segment (CW) advances clockwise each frame.
- **Timings**: 4 frames, clockwise loop, 200ms per frame.

### 2. shell-tool-skill
- **Concept**: 3-frame large bold hollow `>` prompt on the left, with a 2px thick core. Underscore cursor `_` at the bottom right blinks and moves horizontally.
- **Timings**: 3 frames, loop, 200ms per frame.

### 3. editing
- **Concept**: 3-frame diagonal pencil (orange O core, cyan C tip, navy D outline) shifting right, leaving a growing cyan C stroke at the bottom (row 16).
- **Timings**: 3 frames, writing stroke loop, 200ms per frame.

### 4. planning-goal
- **Concept**: Checkpoint flag. Waving cloth (7 rows high, S-curve wave, cyan core, moving white highlight) on a bold 2px pole with base pedestal.
- **Timings**: 3 frames, waving loop, 200ms per frame.

### 5. delegating
- **Concept**: Top node splitting into two thick branch lanes and bottom nodes. Flow is animated by a pulse: top node active (frame 0), branches active (frame 1), and bottom nodes active (frame 2).
- **Timings**: 3 frames, loop, 200ms per frame.

### 6. visual
- **Concept**: Almond eye outline (2px thick). Pupil moves center (frame 0), left (frame 1), and right (frame 2) to scan the workspace.
- **Timings**: 3 frames, scan loop, 200ms per frame.

### 7. memory
- **Concept**: Square microchip with side pins (2px body outline). Core pulses outwards in three rings.
- **Timings**: 3 frames, pulse loop, 200ms per frame.

### 8. attention-asking
- **Concept**: Orange question mark. Draws hook first (frame 0), descender (frame 1), stem (frame 2), and detached dot appears in frame 3.
- **Timings**: 4 frames, sequence loop, 200ms per frame.

### 9. done
- **Concept**: Green checkmark (2px core). Elbow/short leg appears (frame 0), long leg begins (frame 1), extends (frame 2), and check completes with a bright white highlight tip (frame 3). Frame 3 holds for 600ms.
- **Timings**: 4 frames: frame 0 (200ms), frame 1 (200ms), frame 2 (200ms), frame 3 (600ms hold).

### 10. error
- **Concept**: Saturated red cross X (2px core, 1px navy edge). Shakes center (frame 0), left by 2px (frame 1), and right by 2px (frame 2).
- **Timings**: 3 frames, shake loop, 200ms per frame.
