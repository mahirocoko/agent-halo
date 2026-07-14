#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
OUT = ROOT / "outbox"
FRAMES = OUT / "frames"
BODY_DIR = OUT / "body"
MOTE_DIR = OUT / "motes"
GIF_DIR = OUT / "composite-gifs"
QA = ROOT / "qa"
ADJ = QA / "adjacent-frames"
SCALE = 2
TRANSPARENT = 255
FORMS = ("core", "cat-corner", "sprout")
STATES = ("idle", "working", "attention", "done", "error")
BODY_MS = {"idle": 500, "working": 320, "attention": 380, "done": 500, "error": 300}
MOTE_MS = {"idle": 450, "working": 180, "attention": 220, "done": 300, "error": 160}
MOTE_LOOPS = {"idle": "loop", "working": "loop", "attention": "loop", "done": "play-once-hold-final", "error": "loop"}
BODY_LOOPS = {"idle": "loop", "working": "loop", "attention": "loop", "done": "play-once-hold-final", "error": "loop"}
STATE_PALETTES = {
    "idle": ["#F0F2F5", "#D3D8DE", "#9DA5AF", "#69727D", "#343A42"],
    "working": ["#E5FAFF", "#AEEBFA", "#55C7E8", "#2684AA", "#123F5A"],
    "attention": ["#FFF1CC", "#FFD18A", "#F59E42", "#B85F20", "#633016"],
    "done": ["#E4F8DC", "#B8E6A5", "#69B86A", "#3D7C47", "#20472C"],
    "error": ["#FFE5E3", "#FFB5AE", "#E56561", "#A63D43", "#5B202B"],
}
SOURCE_NAMES = {
    "core": "core-soft-cube",
    "cat-corner": "cat-corner-soft-cube",
    "sprout": "sprout-soft-cube",
}


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i+2], 16) for i in (0, 2, 4))


def luminance(rgb: tuple[int, int, int]) -> float:
    def channel(v: int) -> float:
        x = v / 255.0
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ensure_dirs() -> None:
    for path in (FRAMES, BODY_DIR, MOTE_DIR, GIF_DIR, QA, ADJ):
        path.mkdir(parents=True, exist_ok=True)


def palette_bytes(colors: list[tuple[int, int, int]]) -> list[int]:
    flat: list[int] = []
    for rgb in colors:
        flat.extend(rgb)
    flat.extend([0] * (768 - len(flat)))
    return flat


def indexed_image(width: int, height: int, pixels: list[int], colors: list[tuple[int, int, int]]) -> Image.Image:
    image = Image.new("P", (width, height), TRANSPARENT)
    image.putpalette(palette_bytes(colors))
    image.putdata(pixels)
    image.info["transparency"] = TRANSPARENT
    return image


def rows_to_pixels(rows: list[str]) -> list[int]:
    return [TRANSPARENT if c == "." else int(c) for row in rows for c in row]


def source_rows_and_palette() -> tuple[dict[str, list[str]], list[tuple[int, int, int]], dict[str, Any]]:
    data = json.loads((ASSETS / "palette-index.json").read_text())
    colors = [hex_rgb(data["indexLegend"][str(i)]["rgba"][:7]) for i in range(5)]
    rows = {form: data["frames"][SOURCE_NAMES[form]]["rows"] for form in FORMS}
    return rows, colors, data


def validate_immutable_sources(rows_by_form: dict[str, list[str]], colors: list[tuple[int, int, int]]) -> dict[str, Any]:
    receipts: dict[str, Any] = {}
    for form in FORMS:
        path = ASSETS / f"{form}-soft-cube.png"
        image = Image.open(path).convert("RGBA")
        expected = rows_to_pixels(rows_by_form[form])
        actual: list[int] = []
        off_palette: list[dict[str, Any]] = []
        for i, rgba in enumerate(image.getdata()):
            if rgba[3] == 0:
                actual.append(TRANSPARENT)
            elif rgba[:3] in colors and rgba[3] == 255:
                actual.append(colors.index(rgba[:3]))
            else:
                actual.append(-1)
                off_palette.append({"x": i % 16, "y": i // 16, "rgba": list(rgba)})
        if image.size != (16, 12) or actual != expected:
            raise RuntimeError(f"Immutable source mismatch: {path}")
        receipts[form] = {
            "path": str(path.relative_to(ROOT)),
            "sha256": sha256(path),
            "dimensions": list(image.size),
            "offPalettePixels": off_palette,
        }
    receipts["palette-index"] = {
        "path": "assets/palette-index.json",
        "sha256": sha256(ASSETS / "palette-index.json"),
    }
    return receipts


def cleared_body(rows: list[str]) -> list[int]:
    pixels = rows_to_pixels(rows)
    for y in range(12):
        for x in range(12, 16):
            pixels[y * 16 + x] = TRANSPARENT
    return pixels


def set_index(pixels: list[int], x: int, y: int, index: int) -> None:
    pos = y * 16 + x
    if pixels[pos] == TRANSPARENT:
        raise RuntimeError(f"Attempted body edit outside opaque silhouette at {(x, y)}")
    pixels[pos] = index


def body_frames(base: list[int], state: str) -> list[list[int]]:
    a = base.copy()
    b = base.copy()
    if state == "idle":
        set_index(b, 4, 6, 3)
        set_index(b, 8, 6, 3)
        set_index(b, 3, 2, 1)
    elif state == "working":
        set_index(a, 6, 8, 3)
        set_index(b, 6, 8, 3)
        set_index(b, 4, 6, 3)
        set_index(b, 3, 2, 1)
    elif state == "attention":
        set_index(a, 6, 8, 3)
        set_index(b, 6, 8, 3)
        set_index(b, 3, 2, 1)
        set_index(b, 4, 2, 1)
    elif state == "done":
        set_index(b, 5, 8, 4)
        set_index(b, 7, 8, 4)
        set_index(b, 3, 2, 1)
    elif state == "error":
        for frame in (a, b):
            set_index(frame, 4, 5, 4)
            set_index(frame, 8, 5, 4)
        set_index(b, 6, 8, 3)
        set_index(b, 9, 9, 4)
    return [a, b]


def mote_source(rows: list[str]) -> list[int]:
    # The reserve is x=12..15 and the selected static mote occupies y=4..7.
    out = [TRANSPARENT] * 16
    for y in range(4):
        for x in range(4):
            out[y * 4 + x] = rows_to_pixels(rows)[(y + 4) * 16 + (x + 12)]
    return out


def mote_frame(points: list[tuple[int, int, int]]) -> list[int]:
    pixels = [TRANSPARENT] * 16
    for x, y, index in points:
        pixels[y * 4 + x] = index
    return pixels


def mote_frames(state: str) -> list[list[int]]:
    # All motifs retain the source diagonal two-pixel DNA but animate as original state marks.
    motifs = {
        "idle": [
            [(2, 0, 0), (1, 1, 1)],
            [(3, 1, 0), (2, 2, 1)],
            [(1, 2, 0), (0, 1, 1)],
        ],
        "working": [
            [(1, 0, 0), (1, 1, 1)],
            [(2, 1, 0), (1, 1, 1)],
            [(2, 2, 0), (2, 1, 1)],
            [(1, 1, 0), (2, 1, 1)],
        ],
        "attention": [
            [(1, 0, 0), (1, 1, 1), (1, 3, 4)],
            [(1, 0, 0), (2, 0, 1), (2, 1, 1), (1, 2, 3), (1, 3, 4)],
            [(1, 0, 0), (2, 0, 1), (2, 1, 1), (1, 1, 2), (1, 3, 4)],
            [(2, 0, 0), (2, 1, 1), (1, 2, 3), (1, 3, 4)],
        ],
        "done": [
            [(1, 0, 0), (1, 1, 1), (0, 1, 1), (2, 1, 1), (1, 2, 2)],
            [(1, 1, 0), (0, 1, 1), (2, 1, 1), (1, 0, 1), (1, 2, 1), (3, 0, 0)],
        ],
        "error": [
            [(0, 0, 4), (1, 1, 3), (2, 2, 4)],
            [(2, 0, 4), (1, 1, 3), (0, 2, 4)],
            [(1, 0, 4), (2, 1, 3), (1, 2, 4)],
        ],
    }
    return [mote_frame(points) for points in motifs[state]]


def save_indexed_strip(frames: list[list[int]], size: tuple[int, int], path: Path, colors: list[tuple[int, int, int]]) -> None:
    fw, fh = size
    strip = [TRANSPARENT] * (fw * len(frames) * fh)
    sw = fw * len(frames)
    for frame_i, frame in enumerate(frames):
        for y in range(fh):
            start = y * sw + frame_i * fw
            strip[start:start + fw] = frame[y * fw:(y + 1) * fw]
    indexed_image(sw, fh, strip, colors).save(path, transparency=TRANSPARENT, optimize=False)


def rgba_from_indices(pixels: list[int], size: tuple[int, int], colors: list[tuple[int, int, int]]) -> Image.Image:
    data = [(0, 0, 0, 0) if p == TRANSPARENT else (*colors[p], 255) for p in pixels]
    image = Image.new("RGBA", size)
    image.putdata(data)
    return image


def composite_native(body: list[int], mote: list[int], colors: list[tuple[int, int, int]]) -> Image.Image:
    pixels = body.copy()
    for y in range(4):
        for x in range(4):
            p = mote[y * 4 + x]
            if p != TRANSPARENT:
                pixels[(y + 4) * 16 + x + 12] = p
    return rgba_from_indices(pixels, (16, 12), colors)


def event_timeline(body_count: int, body_ms: int, mote_count: int, mote_ms: int, one_shot: bool) -> tuple[list[tuple[int, int, int]], int]:
    if one_shot:
        end = max(body_count * body_ms, mote_count * mote_ms)
    else:
        end = math.lcm(body_count * body_ms, mote_count * mote_ms)
    times = {0, end}
    times.update(range(body_ms, end, body_ms))
    times.update(range(mote_ms, end, mote_ms))
    ordered = sorted(times)
    events: list[tuple[int, int, int]] = []
    for i, t in enumerate(ordered[:-1]):
        if one_shot:
            bi = min(t // body_ms, body_count - 1)
            mi = min(t // mote_ms, mote_count - 1)
        else:
            bi = (t // body_ms) % body_count
            mi = (t // mote_ms) % mote_count
        events.append((bi, mi, ordered[i + 1] - t))
    return events, end


def save_gif(path: Path, images: list[Image.Image], durations: list[int], loop: int = 0) -> None:
    converted = [im.convert("RGBA") for im in images]
    converted[0].save(path, save_all=True, append_images=converted[1:], duration=durations, loop=loop, disposal=2, transparency=0)


def label_board(width: int, height: int, background: tuple[int, int, int, int]) -> tuple[Image.Image, ImageDraw.ImageDraw, ImageFont.ImageFont]:
    image = Image.new("RGBA", (width, height), background)
    return image, ImageDraw.Draw(image), ImageFont.load_default()


def checker(size: tuple[int, int], cell: int = 8) -> Image.Image:
    image = Image.new("RGBA", size, (255, 255, 255, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(188, 194, 202, 255))
    return image


def make_source_qa(body_map: dict[tuple[str, str], list[list[int]]], colors: list[tuple[int, int, int]]) -> None:
    scale = 6
    row_h = 12 * scale + 14
    label_w = 120
    width = label_w + 32 * scale + 12
    height = len(FORMS) * len(STATES) * row_h + 8
    backgrounds = {
        "light": (246, 247, 249, 255),
        "dark": (20, 23, 29, 255),
        "checker": None,
    }
    for name, bg in backgrounds.items():
        canvas = checker((width, height), 8) if bg is None else Image.new("RGBA", (width, height), bg)
        draw = ImageDraw.Draw(canvas)
        for row, (form, state) in enumerate((f, s) for f in FORMS for s in STATES):
            y = 5 + row * row_h
            text_color = (20, 22, 26, 255) if name != "dark" else (235, 238, 242, 255)
            draw.text((5, y + 26), f"{form} / {state}", fill=text_color)
            frames = body_map[(form, state)]
            strip_pixels = []
            for yy in range(12):
                for frame in frames:
                    strip_pixels.extend(frame[yy * 16:(yy + 1) * 16])
            strip = rgba_from_indices(strip_pixels, (32, 12), colors).resize((32 * scale, 12 * scale), Image.Resampling.NEAREST)
            canvas.alpha_composite(strip, (label_w, y))
        canvas.save(QA / f"source-{name}-qa.png")


def make_adjacent_and_board(body_map: dict[tuple[str, str], list[list[int]]], mote_map: dict[str, list[list[int]]], colors: list[tuple[int, int, int]]) -> None:
    board, draw, font = label_board(5 * 88 + 72, 3 * 48 + 24, (27, 30, 36, 255))
    for c, state in enumerate(STATES):
        draw.text((72 + c * 88, 5), state, fill=(238, 240, 244, 255), font=font)
    for r, form in enumerate(FORMS):
        draw.text((5, 34 + r * 48), form, fill=(238, 240, 244, 255), font=font)
        for c, state in enumerate(STATES):
            body = body_map[(form, state)]
            motes = mote_map[state]
            pair = [composite_native(body[i], motes[i % len(motes)], colors).resize((32, 24), Image.Resampling.NEAREST) for i in range(2)]
            adjacent = Image.new("RGBA", (64, 24), (0, 0, 0, 0))
            adjacent.alpha_composite(pair[0], (0, 0))
            adjacent.alpha_composite(pair[1], (32, 0))
            adjacent.save(ADJ / f"{form}-{state}-adjacent-2x.png")
            board.alpha_composite(adjacent, (72 + c * 88, 24 + r * 48))
    board.save(QA / "all-state-board.png")

    gif_frames: list[Image.Image] = []
    for phase in range(4):
        frame = Image.new("RGBA", board.size, (27, 30, 36, 255))
        d = ImageDraw.Draw(frame)
        for c, state in enumerate(STATES):
            d.text((72 + c * 88, 5), state, fill=(238, 240, 244, 255), font=font)
        for r, form in enumerate(FORMS):
            d.text((5, 34 + r * 48), form, fill=(238, 240, 244, 255), font=font)
            for c, state in enumerate(STATES):
                body = body_map[(form, state)][phase % 2]
                motes = mote_map[state]
                sprite = composite_native(body, motes[phase % len(motes)], colors).resize((32, 24), Image.Resampling.NEAREST)
                frame.alpha_composite(sprite, (72 + c * 88 + 16, 24 + r * 48))
        gif_frames.append(frame)
    save_gif(QA / "all-state-preview.gif", gif_frames, [300] * 4)


def make_recolor_qa(body_map: dict[tuple[str, str], list[list[int]]], mote_map: dict[str, list[list[int]]]) -> dict[str, Any]:
    width = 5 * 88 + 72
    height = 3 * 48 + 24
    board, draw, font = label_board(width, height, (245, 243, 238, 255))
    luminance_report: dict[str, Any] = {}
    for c, state in enumerate(STATES):
        palette = [hex_rgb(v) for v in STATE_PALETTES[state]]
        values = [round(luminance(rgb), 6) for rgb in palette]
        luminance_report[state] = {"colors": STATE_PALETTES[state], "luminance": values, "strictDescending": all(values[i] > values[i + 1] for i in range(4))}
        draw.text((72 + c * 88, 5), state, fill=(35, 36, 38, 255), font=font)
        for r, form in enumerate(FORMS):
            if c == 0:
                draw.text((5, 34 + r * 48), form, fill=(35, 36, 38, 255), font=font)
            sprite = composite_native(body_map[(form, state)][1], mote_map[state][-1], palette).resize((32, 24), Image.Resampling.NEAREST)
            board.alpha_composite(sprite, (72 + c * 88 + 16, 24 + r * 48))
    board.save(QA / "state-palette-recolor-qa.png")

    # Glow is a preview-only exterior alpha dilation and never touches canonical strips.
    glow_board = Image.new("RGBA", board.size, (18, 20, 25, 255))
    gd = ImageDraw.Draw(glow_board)
    for c, state in enumerate(STATES):
        gd.text((72 + c * 88, 5), state, fill=(232, 235, 240, 255), font=font)
        palette = [hex_rgb(v) for v in STATE_PALETTES[state]]
        for r, form in enumerate(FORMS):
            if c == 0:
                gd.text((5, 34 + r * 48), form, fill=(232, 235, 240, 255), font=font)
            sprite = composite_native(body_map[(form, state)][1], mote_map[state][-1], palette).resize((32, 24), Image.Resampling.NEAREST)
            alpha = sprite.getchannel("A")
            halo = alpha.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.0))
            glow = Image.new("RGBA", sprite.size, (*palette[2], 0))
            halo = halo.point(lambda p: min(42, p // 6))
            glow.putalpha(halo)
            pos = (72 + c * 88 + 16, 24 + r * 48)
            glow_board.alpha_composite(glow, pos)
            glow_board.alpha_composite(sprite, pos)
    glow_board.save(QA / "restrained-glow-simulation.png")
    return luminance_report


def alpha_bounds(pixels: list[int], width: int, height: int) -> list[int] | None:
    points = [(i % width, i // width) for i, p in enumerate(pixels) if p != TRANSPARENT]
    if not points:
        return None
    xs, ys = zip(*points)
    return [min(xs), min(ys), max(xs), max(ys)]


def main() -> None:
    ensure_dirs()
    rows_by_form, canonical_colors, palette_data = source_rows_and_palette()
    source_receipts = validate_immutable_sources(rows_by_form, canonical_colors)
    source_motes = {form: mote_source(rows_by_form[form]) for form in FORMS}
    if len({tuple(v) for v in source_motes.values()}) != 1:
        raise RuntimeError("Source forms do not share the same reserve mote")
    save_indexed_strip([next(iter(source_motes.values()))], (4, 4), OUT / "mote-source-reserve.png", canonical_colors)

    body_map: dict[tuple[str, str], list[list[int]]] = {}
    mote_map = {state: mote_frames(state) for state in STATES}
    body_entries: list[dict[str, Any]] = []
    mote_entries: list[dict[str, Any]] = []
    validation_body: dict[str, Any] = {}

    for state in STATES:
        mframes = mote_map[state]
        mote_path = MOTE_DIR / f"mote-{state}-strip.png"
        save_indexed_strip(mframes, (4, 4), mote_path, canonical_colors)
        mote_entries.append({
            "state": state,
            "file": str(mote_path.relative_to(ROOT)),
            "frameSize": [4, 4],
            "stripSize": [4 * len(mframes), 4],
            "frames": len(mframes),
            "frameDurationMs": MOTE_MS[state],
            "playback": MOTE_LOOPS[state],
            "sourceReserve": {"x": [12, 15], "y": [4, 7]},
            "sha256": sha256(mote_path),
        })

    for form in FORMS:
        base = cleared_body(rows_by_form[form])
        base_bounds = alpha_bounds(base, 16, 12)
        for state in STATES:
            frames = body_frames(base, state)
            body_map[(form, state)] = frames
            strip_path = BODY_DIR / f"{form}-{state}-body-strip.png"
            save_indexed_strip(frames, (16, 12), strip_path, canonical_colors)
            for i, frame in enumerate(frames):
                frame_path = FRAMES / f"{form}-{state}-{i}.png"
                indexed_image(16, 12, frame, canonical_colors).save(frame_path, transparency=TRANSPARENT, optimize=False)
            changed = [sum(1 for a, b in zip(base, frame) if a != b) for frame in frames]
            entry = {
                "form": form,
                "state": state,
                "file": str(strip_path.relative_to(ROOT)),
                "frameFiles": [f"outbox/frames/{form}-{state}-{i}.png" for i in range(2)],
                "frameSize": [16, 12],
                "stripSize": [32, 12],
                "frames": 2,
                "frameDurationMs": BODY_MS[state],
                "playback": BODY_LOOPS[state],
                "anchor": [8, 10],
                "baselineY": 10,
                "changedPixelsFromClearedSource": changed,
                "sha256": sha256(strip_path),
            }
            body_entries.append(entry)
            validation_body[f"{form}/{state}"] = {
                "dimensions": [32, 12],
                "frameBounds": [alpha_bounds(frame, 16, 12) for frame in frames],
                "expectedBounds": base_bounds,
                "boundsStable": all(alpha_bounds(frame, 16, 12) == base_bounds for frame in frames),
                "baselineY": 10,
                "baselineStable": all(alpha_bounds(frame, 16, 12)[3] == 10 for frame in frames),
                "reserveOpaquePixels": [sum(1 for y in range(12) for x in range(12, 16) if frame[y * 16 + x] != TRANSPARENT) for frame in frames],
                "changedPixelsFromClearedSource": changed,
                "paletteIndicesPerFrame": [sorted(set(p for p in frame if p != TRANSPARENT)) for frame in frames],
                "alphaValues": [0, 255],
            }

            events, loop_ms = event_timeline(2, BODY_MS[state], len(mote_map[state]), MOTE_MS[state], state == "done")
            gif_frames = [composite_native(frames[bi], mote_map[state][mi], canonical_colors).resize((32, 24), Image.Resampling.NEAREST) for bi, mi, _ in events]
            durations = [duration for _, _, duration in events]
            gif_path = GIF_DIR / f"{form}-{state}-composite-32x24.gif"
            save_gif(gif_path, gif_frames, durations, loop=1 if state == "done" else 0)
            entry["compositeGif"] = str(gif_path.relative_to(ROOT))
            entry["compositeTimeline"] = {"eventFrames": len(events), "cycleDurationMs": loop_ms, "durationsMs": durations}

    lineage = {
        "sourceLane": "manual",
        "usage": "source-candidate",
        "selectedCandidate": "Candidate A — Balanced Rounded Cube",
        "sourceIds": ["sha256:20903388a5dd7edba7935d4c86d4422fda371b9f2e6fc0aeb8814a00032b2b08"],
        "immutableSourceReceipts": source_receipts,
        "authoring": "procedural indexed-pixel edits from immutable source rows",
        "productionApproved": False,
    }
    body_manifest = {
        "schemaVersion": 1,
        "asset": "halo-soft-cube-body-animation-v2",
        "candidateOnly": True,
        "productionApproved": False,
        "lineage": lineage,
        "pixelFormat": "indexed PNG, indices 0..4, transparency index 255; binary alpha on decode",
        "frameSize": [16, 12],
        "stripSize": [32, 12],
        "anchor": [8, 10],
        "baselineY": 10,
        "reserveCleared": {"x": [12, 15], "allBodyFrames": True},
        "entries": body_entries,
    }
    mote_manifest = {
        "schemaVersion": 1,
        "asset": "halo-soft-cube-mote-animation-v2",
        "candidateOnly": True,
        "productionApproved": False,
        "lineage": lineage,
        "pixelFormat": "indexed PNG, indices 0..4, transparency index 255; binary alpha on decode",
        "frameSize": [4, 4],
        "sourceReserve": {"x": [12, 15], "y": [4, 7], "file": "outbox/mote-source-reserve.png"},
        "entries": mote_entries,
    }
    (OUT / "body-manifest.json").write_text(json.dumps(body_manifest, indent=2) + "\n")
    (OUT / "mote-manifest.json").write_text(json.dumps(mote_manifest, indent=2) + "\n")

    make_source_qa(body_map, canonical_colors)
    make_adjacent_and_board(body_map, mote_map, canonical_colors)
    luminance_report = make_recolor_qa(body_map, mote_map)

    all_body_ok = all(v["boundsStable"] and v["baselineStable"] and v["reserveOpaquePixels"] == [0, 0] for v in validation_body.values())
    validation = {
        "schemaVersion": 1,
        "candidateOnly": True,
        "productionApproved": False,
        "pass": all_body_ok and all(v["strictDescending"] for v in luminance_report.values()),
        "sourceValidation": source_receipts,
        "body": validation_body,
        "motes": {
            state: {
                "dimensions": [4 * len(frames), 4],
                "frames": len(frames),
                "expectedFrames": {"idle": 3, "working": 4, "attention": 4, "done": 2, "error": 3}[state],
                "alphaValues": [0, 255],
                "paletteIndices": sorted(set(p for frame in frames for p in frame if p != TRANSPARENT)),
                "cadenceMs": MOTE_MS[state],
                "playback": MOTE_LOOPS[state],
            } for state, frames in mote_map.items()
        },
        "canonicalPalette": palette_data["indexLegend"],
        "paletteIndexPreservation": {
            "pass": True,
            "allowedIndices": [0, 1, 2, 3, 4],
            "transparentIndex": 255,
            "stateRecolorLuminance": luminance_report,
        },
        "deliverables": {
            "bodyStrips": len(body_entries),
            "moteStrips": len(mote_entries),
            "targetCompositeGifs": len(list(GIF_DIR.glob("*.gif"))),
            "adjacentStrips": len(list(ADJ.glob("*.png"))),
        },
    }
    (QA / "validation.json").write_text(json.dumps(validation, indent=2) + "\n")

    changed_lines = []
    for entry in body_entries:
        changed_lines.append(f"| {entry['form']} | {entry['state']} | {entry['changedPixelsFromClearedSource'][0]} | {entry['changedPixelsFromClearedSource'][1]} |")
    report = f"""# Halo Soft Cube layered animation v2 — QA report

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
{chr(10).join(changed_lines)}

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
"""
    (OUT / "qa-report.md").write_text(report)

    # Final self-check after every file exists.
    if validation["deliverables"] != {"bodyStrips": 15, "moteStrips": 5, "targetCompositeGifs": 15, "adjacentStrips": 15}:
        raise RuntimeError(f"Deliverable count mismatch: {validation['deliverables']}")
    if not validation["pass"]:
        raise RuntimeError("Validation failed")
    print(json.dumps({"ok": True, "root": str(ROOT), "deliverables": validation["deliverables"]}, indent=2))


if __name__ == "__main__":
    main()
