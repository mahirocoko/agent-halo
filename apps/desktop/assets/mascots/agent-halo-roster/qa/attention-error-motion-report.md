# Agent Halo Attention/Error Motion Review

Status: **review-candidate**  
Production approved: **no**  
Production manifest SHA-256: `44e678f42170d9688af8848daa40b3823a3db82ff434f3007407c352a572a118`

## Contract result

- 15 approved mascot identities; no selection or appearance changes.
- 2 body-only review motions per mascot: Attention and Error.
- 3 native 24×18 frames per motion: 90 PNG frames total.
- 30 horizontal 72×18 PNG strips.
- 30 native fixed-palette GIFs plus 30 ambient 40×30 and 30 session 48×36 GIF previews.
- GIF disposal mode 2, three frames each, transparent palette index 0.
- Binary alpha and source-palette-only checks pass.
- Frame 0 is RGBA-content-identical to each exact accepted Attention/Error source frame.
- Every adjacent pair, including the loop seam, has a non-zero delta.
- Bounds drift is at most one native pixel; no source baseline or whole-body transform is applied.
- Semantic signal remains separate; no signal glyph, X eyes, or red body pixels were added.

Machine-readable evidence: `qa.json` and `validation.json`.

## Actual-size visual inspection

Inspected the 40×30 ambient and 48×36 session contact previews, the 4× dark contact, and representative native GIFs.

### Identity drift

No clear identity drift is visible in the static contacts. Body mass, face language, palette, source scale, and baseline remain recognizable for all fifteen mascots. The bounded box technique can expose a one-pixel joint change while moving an appendage, so Bat ears/wings, Cactus arm, Turtle head, and Nautilus feeler deserve close animated review even though their still frames remain on-model.

### Weak or ambiguous loops

- **CRT, Lantern, Kettle, Pot, Crawler, and Giraffe Attention:** intentionally very restrained; at 40×30 the handle/antenna/head movement may be too quiet to register without the separate signal.
- **Cat, CRT, Lantern, and Kettle Error:** motion is readable mainly as a tremble in tail/stand/handle rather than a full slump. This protects identity but may be semantically weak.
- **Turtle and Cactus Error:** appendage motion can read as a twitch more than worry.
- **Squid Error:** tentacle movement risks reading as ordinary liveliness rather than distress.
- **Dragonfly Attention:** the largest delta in the set; it reads clearly but may feel closer to a wing flap than a restrained call/perk.
- **Jelly and Squid:** alternating narrow appendages create stronger silhouette delta than their pixel count suggests; check loop smoothness at native speed.

These are review caveats, not failures hidden by the automated checks. No loop is promoted or marked approved.

## Recommended human review order

1. Open `index.html` via `file://` and compare Attention/Error side by side at 48×36.
2. Check `contacts/attention-ambient-40x30-dark.png` and `contacts/error-ambient-40x30-light.png` for compact readability.
3. Closely judge Dragonfly Attention and the weak Error group (Cat, CRT, Turtle, Lantern, Kettle, Squid).
4. Accept only loops whose motion adds state affect without competing with the stationary semantic signal. Keep or revert individual weak loops rather than increasing deformation globally.
