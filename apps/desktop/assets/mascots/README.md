# Agent Halo session mascot assets

Runtime mascot assets are action-separated sprite sheets derived from Codex imagegen-generated original sprite concepts, then chroma-keyed, component-detected, normalized, and saved into the app runtime contract. Reference packs under `docs/sprites/reference/` are used only for animation grammar and QA vocabulary, not as pixel sources.

## Runtime contract

- Runtime source frame: `80×60` px
- Display frame: `40×30` px
- Runtime path: `apps/desktop/public/mascots/session-cat/<action>.{webp,png}`
- CSS animation uses `steps(<frame count>)` per action.
- Reference sprite packs in `docs/sprites/reference/` are durable comparison material; do not delete them as temporary files.
- Character direction: original white Agent Halo action-cat mascot. Keep identity in compact collar/accent details; do not put a literal floating halo above the head.

## Source/provenance

All current primary runtime actions now come from one-animation-at-a-time Codex imagegen sources, extracted from Codex session logs because this environment renders generated images inline and may not write fresh files under `~/.codex/generated_images`.

- `generated-images/agent-halo-idle.png` — 4-frame calm sit/blink/ear-tail micro idle loop.
- `generated-images/agent-halo-walk.png` — 6-frame tiny-person walking loop.
- `generated-images/agent-halo-work-laptop.png` — 8-frame typing notebook/laptop work loop.
- `generated-images/agent-halo-coffee.png` — 6-frame coffee/sip/chill loop.
- `generated-images/agent-halo-hurt.png` — 4-frame cute flustered error reaction.
- `generated-images/agent-halo-dust.png` — 6-frame tiny settle/puff transition loop.

Earlier all-action imagegen passes are kept as `agent-halo-sprite-sheet.png`, `agent-halo-sprite-sheet-v1.png`, and `agent-halo-sprite-sheet-v2.png` for QA provenance only.

## Cutting strategy

Generated images can look grid-like while still having slightly imperfect cell spacing. Runtime sheets are cut by detecting non-magenta connected components, using the large mascot components as per-frame anchors, then optionally merging nearby small components into the nearest frame before normalizing to `80×60`.

- `idle`, `walk`, and `hurt` intentionally keep only the mascot anchor component to avoid stray generated motion marks.
- `work`, `coffee`, and `dust` merge nearby small components because laptop sparks, steam, and foot-level dust are intentional.
- For important animations, prefer generating one action at a time instead of one large multi-action sheet. It produces more coherent poses and simpler post-processing.

| action | frames | runtime role | source |
| --- | ---: | --- | --- |
| idle | 4 | idle/done base pose | one-action Codex idle source |
| walk | 6 | locomotion vocabulary/reference | one-action Codex walk source |
| work | 8 | active working state | one-action Codex work-laptop source |
| coffee | 6 | waiting/cozy break state | one-action Codex coffee source |
| hurt | 4 | error state | one-action Codex hurt/error source |
| dust | 6 | settle/dust transition reference | one-action Codex dust/settle source |

## Runtime mapping

Currently wired status mapping:

- `working` → `work` (cat typing at notebook/laptop)
- `waiting` → `coffee` (cat holding/sipping coffee)
- `error` → `hurt`
- `idle` / `done` → `idle`

`walk` and `dust` have runtime assets and CSS background support, but are not automatically mapped to a live status yet. Use them later for focus/switching or transition states only if the product behavior needs it.

## QA

Use `session-cat-actions-preview.png` to inspect action separation at source scale and display scale on a dark surface. `session-cat-codex-sources-preview.png` shows the extracted Codex sources together.
