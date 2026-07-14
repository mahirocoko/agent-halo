# Legacy Agent Halo session cat assets

The detailed session cat is superseded in the active renderer by the selected rounded-square Halo Soft Cube runtime candidate under `halo-soft-cube/`. Keep these files as rollback/history evidence until the replacement finishes native acceptance; do not treat this cat as the current visual target.

Runtime mascot assets are action-separated sprite sheets derived from Codex imagegen-generated original sprite concepts, then chroma-keyed, component-detected, normalized, and saved into the app runtime contract. Reference packs under `docs/sprites/reference/` are used only for animation grammar and QA vocabulary, not as pixel sources.

## Runtime contract

- Runtime source frame: `80×60` px
- Display frame: `40×30` px
- Runtime path: `apps/desktop/public/mascots/session-cat/<action>.{webp,png}`
- Runtime manifest: `apps/desktop/public/mascots/session-cat/manifest.json`
- CSS animation uses `steps(<frame count>)` per action.
- Reference sprite packs in `docs/sprites/reference/` are durable comparison material; do not delete them as temporary files.
- Character direction: original white Agent Halo action-cat mascot. Keep identity in compact collar/accent details; do not put a literal floating halo above the head.

## Source/provenance

The bulky generated source folder is intentionally not retained in the repo. Current maintained artifacts are the runtime strips, this manifest/README, and QA previews. The original action concepts were generated with Codex imagegen, extracted from real inline `image_generation_call.result` payloads when needed, then post-processed into the runtime sheets.

- `apps/desktop/assets/mascots/session-cat-identity-anchor-v2.png` — current canonical identity reference: dust-like silhouette/body shape plus clean bead-eye/tiny-mouth/orange-collar grammar. Use this as the character anchor for new generated actions.
- `idle` — 6-frame idle/done loop generated after clarifying “keep character, not exact position”; blink/tail/settle frames instead of repeating dust frames.
- `walk` — 6-frame creative v2 walk with a more purposeful 3/4 side-walk and clearer paw/tail rhythm.
- `plan` — 6-frame planning state with a creative side/3/4 crouched pose and tiny orange tile board.
- `work` — 8-frame character-first work/laptop recut; position may differ for action readability.
- `coffee` — 6-frame boss-coffee v2 after Mahiro asked for a humorous “like a boss” coffee break; simplified seated lower body so the cat no longer reads as having too many legs.
- `hurt` — 6-frame readable error/fluster loop generated after clarifying “keep character, not exact position.”
- `dust` — 6-frame transition/dust v2 where the cat pushes off, becomes partly hidden, then dust settles; use as a one-shot transition, not a persistent loop.

## Cutting strategy

Generated images can look grid-like while still having slightly imperfect cell spacing. Runtime sheets are cut by detecting non-magenta connected components, using the large mascot components as per-frame anchors, then optionally merging nearby small components into the nearest frame before normalizing to `80×60`.

- `idle`, `walk`, and `hurt` intentionally keep only the mascot anchor component to avoid stray generated motion marks.
- `work`, `plan`, `coffee`, and `dust` merge nearby small components because laptop sparks, planning tiles/board details, steam, and foot-level dust are intentional.
- For important animations, prefer generating one action at a time instead of one large multi-action sheet. It produces more coherent poses and simpler post-processing.

| action | frames | runtime role | source |
| --- | ---: | --- | --- |
| idle | 6 | idle/done base pose | character-generated 6-frame idle source |
| walk | 6 | locomotion vocabulary/reference | creative character-generated walk v2 source |
| plan | 6 | planning/update-plan state | creative character-generated planning source, component-cut with board/tile components merged |
| work | 8 | active working state | character-first recut from Codex work-laptop source; position may differ for action readability |
| coffee | 6 | waiting/boss coffee break state | creative boss-coffee v2 source, component-cut and chroma-cleaned |
| hurt | 6 | error state | character-generated 6-frame hurt/error source, component-cut and chroma-cleaned |
| dust | 6 | transition/focus handoff reference | creative character-generated dash/poof v2 source |

## Runtime mapping

Currently wired status mapping:

- `thinking` activity → `idle` (attentive idle)
- `planning` activity → `plan` (cat arranging orange plan tiles)
- shell/edit/tool activity → `work` (cat typing at notebook/laptop)
- `attention` / memory / goal / asking activity → `coffee` (cat holding/sipping coffee)
- delegating/subagent activity → `work` for now (avoid looping the one-shot dust vanish as a long-lived state)
- `error` → `hurt`
- `idle` / `done` → `idle`

`walk` and `dust` have runtime assets and CSS background support, but are not automatically mapped to a long-lived live status yet. Use `walk` later for focus/switching, and use `dust` only for a short transition/non-looping handoff state; looping `dust` as a persistent state makes the cat disappear repeatedly.

## QA

Use `session-cat-actions-preview.png` to inspect action separation at source scale and display scale on a dark surface. `session-cat-consistency-recheck.png` compares all runtime actions after the boss-coffee v2 pass. `session-cat-identity-anchor-v2.png` is the current canonical identity reference. `session-cat-idle-character-preview.png`, `session-cat-plan-character-preview.png`, `session-cat-coffee-boss-preview.png`, `session-cat-walk-character-preview.png`, `session-cat-dust-character-preview.png`, `session-cat-work-character-preview.png`, and `session-cat-hurt-character-preview.png` isolate the character-first runtime cuts that keep identity while allowing action-specific poses.
