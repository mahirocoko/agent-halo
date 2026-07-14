#!/usr/bin/python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
REPO = next(parent for parent in ROOT.parents if (parent / ".git").exists())
JOB = REPO / ".agent-state/sprite-workflow/generated/halo-soft-cube-action-signals-v2"
RUNTIME = REPO / "apps/desktop/public/mascots/halo-soft-cube"
OUT = JOB / "outbox/candidates/c-6x6-native-2x"
QA = JOB / "qa"

SIGNALS = [
    "thinking-model",
    "shell-tool-skill",
    "editing",
    "planning-goal",
    "delegating",
    "visual",
    "memory",
    "attention-asking",
    "done",
    "error",
]
FORMS = ["core", "cat-corner", "sprout"]
STATES = ["idle", "working", "attention", "done", "error"]
ORIGINS = [(26, 6), (24, 6), (22, 6), (20, 6)]
RECOMMENDED_ORIGIN = (26, 6)

PALETTE = {
    ".": (0, 0, 0, 0),
    "D": (18, 63, 90, 255),
    "B": (85, 199, 232, 255),
    "W": (229, 250, 255, 255),
}

# These are authored directly on the 6x6 native grid. Frame 0 carries the complete
# semantic silhouette; frame 1 changes only a restrained accent while retaining it.
GLYPHS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "thinking-model": (
        ("..B...", "..W...", "BWWW.B", "..W...", "..B...", ".....B"),
        ("..B...", "..W...", "BWWW..", "..W...", "..B.B.", "......"),
    ),
    "shell-tool-skill": (
        (".DDDDD", ".D...D", ".DW..D", ".D.WBD", ".DDDDD", "......"),
        (".DDDDD", ".D...D", ".DW..D", ".D.W.D", ".DDDDD", "......"),
    ),
    "editing": (
        (".DDDD.", ".DB.D.", ".DB.DW", ".DB.DW", ".DDDW.", "...W.."),
        (".DDDD.", ".DB.D.", ".DB.D.", ".DB.DW", ".DDDDW", "....W."),
    ),
    "planning-goal": (
        ("..D...", "..DWWW", "..DBBW", "..DWWW", "..D...", ".DDD.."),
        ("..D...", "..DWWW", "..DBWW", "..DWWW", "..D...", ".DDD.."),
    ),
    "delegating": (
        ("...DD.", "...WD.", "...B..", "..BBB.", ".D...D", ".WW.WW"),
        ("...DD.", "...WD.", "...W..", "..BBB.", ".D...D", ".WW.WW"),
    ),
    "visual": (
        ("..DD..", ".DWWD.", ".WBWBD", ".DWWD.", "..DD..", "......"),
        ("..DD..", ".DWWD.", ".BWBWD", ".DWWD.", "..DD..", "......"),
    ),
    "memory": (
        ("..DDDD", ".DWWWD", "..DDDD", ".DBBBD", "..DDDD", "...D.D"),
        ("..DDDD", ".DBBBD", "..DDDD", ".DWWWD", "..DDDD", "...D.D"),
    ),
    "attention-asking": (
        ("..WWD.", ".W..WD", "....WD", "...WD.", "......", "...W.."),
        ("..WWD.", ".W..WD", "....WD", "...WD.", "......", "...WB."),
    ),
    "done": (
        (".....W", "....WD", "...WD.", "W.WD..", ".WD...", "..D..."),
        ("B....W", "....WD", "...WD.", "W.WD..", ".WD...", "..D..."),
    ),
    "error": (
        (".W...W", "..W.W.", "...D..", "...D..", "..W.W.", ".W...W"),
        (".B...W", "..W.W.", "...D..", "...D..", "..W.W.", ".W...B"),
    ),
}


def png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=False)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def render(rows: tuple[str, ...]) -> Image.Image:
    if len(rows) != 6 or any(len(row) != 6 for row in rows):
        raise ValueError(f"invalid 6x6 glyph: {rows}")
    image = Image.new("RGBA", (6, 6), PALETTE["."])
    for y, row in enumerate(rows):
        for x, value in enumerate(row):
            image.putpixel((x, y), PALETTE[value])
    return image


def background(kind: str, size: tuple[int, int], checker_cell: int = 2) -> Image.Image:
    if kind == "dark":
        return Image.new("RGBA", size, (15, 17, 21, 255))
    if kind == "light":
        return Image.new("RGBA", size, (248, 249, 250, 255))
    image = Image.new("RGBA", size)
    colors = ((205, 209, 216, 255), (244, 246, 249, 255))
    for y in range(size[1]):
        for x in range(size[0]):
            image.putpixel((x, y), colors[((x // checker_cell) + (y // checker_cell)) % 2])
    return image


def body_frame(form: str, state: str, frame: int) -> Image.Image:
    strip = Image.open(RUNTIME / f"body/{form}/{state}.png").convert("RGBA")
    native = strip.crop((frame * 16, 0, frame * 16 + 16, 12))
    return native.resize((32, 24), Image.Resampling.NEAREST)


def runtime_signal_frame(name: str, frame: int) -> Image.Image:
    strip = Image.open(RUNTIME / f"signals/{name}.png").convert("RGBA")
    return strip.crop((frame * 12, 0, frame * 12 + 12, 12))


def stage_tile(
    kind: str,
    body: Image.Image,
    signal: Image.Image,
    origin: tuple[int, int],
    wrapper_width: int = 32,
    overflow_right: int = 6,
) -> Image.Image:
    # The wrapper remains 32x24; review columns reveal intentional right overflow.
    stage = background(kind, (wrapper_width + overflow_right, 24))
    stage.alpha_composite(body, (0, 0))
    stage.alpha_composite(signal, origin)
    return stage


def overlap_pixels(body: Image.Image, signal: Image.Image, origin: tuple[int, int]) -> int:
    body_alpha = body.getchannel("A")
    signal_alpha = signal.getchannel("A")
    count = 0
    for sy in range(signal.height):
        for sx in range(signal.width):
            bx, by = origin[0] + sx, origin[1] + sy
            if 0 <= bx < body.width and 0 <= by < body.height:
                if signal_alpha.getpixel((sx, sy)) and body_alpha.getpixel((bx, by)):
                    count += 1
    return count


def make_contact(
    candidate: dict[str, list[Image.Image]],
    kind: str,
    scale: int,
    origin: tuple[int, int],
) -> Path:
    font = ImageFont.load_default()
    stage_w, stage_h = 38, 24
    label_w = 112
    gap = 4
    pair_gap = 12
    row_h = stage_h * scale + 7
    width = label_w + (stage_w * scale * 4) + gap * 2 + pair_gap + 12
    height = 22 + len(SIGNALS) * row_h
    sheet = background(kind, (width, height), checker_cell=max(2, scale * 2))
    draw = ImageDraw.Draw(sheet)
    text = (235, 238, 242, 255) if kind == "dark" else (25, 30, 38, 255)
    muted = (157, 168, 181, 255) if kind == "dark" else (80, 90, 104, 255)
    draw.text((4, 3), f"Candidate C 6x6@2x  |  selected runtime parity  |  origin {list(origin)}  |  {scale}x review", fill=text, font=font)
    for row_index, name in enumerate(SIGNALS):
        y = 22 + row_index * row_h
        draw.text((4, y + 2), name, fill=text, font=font)
        body = body_frame("core", "working", row_index % 2)
        x = label_w
        for frame in range(2):
            c_signal = candidate[name][frame]
            tile = stage_tile(kind, body, c_signal, origin)
            if scale != 1:
                tile = tile.resize((stage_w * scale, stage_h * scale), Image.Resampling.NEAREST)
            sheet.alpha_composite(tile, (x, y))
            x += stage_w * scale + gap
        x += pair_gap
        for frame in range(2):
            runtime_signal = runtime_signal_frame(name, frame)
            tile = stage_tile(kind, body, runtime_signal, RECOMMENDED_ORIGIN)
            if scale != 1:
                tile = tile.resize((stage_w * scale, stage_h * scale), Image.Resampling.NEAREST)
            sheet.alpha_composite(tile, (x, y))
            x += stage_w * scale + gap
        draw.text((label_w, y + stage_h * scale), "C0 C1", fill=muted, font=font)
    path = QA / f"candidate-c-vs-current-{kind}-{scale}x.png"
    png(path, sheet)
    return path


def make_form_origin_sheet(candidate: dict[str, list[Image.Image]], kind: str, scale: int) -> Path:
    font = ImageFont.load_default()
    stage_w, stage_h = 38, 24
    label_w = 120
    gap = 5
    columns = len(ORIGINS) * 2
    row_h = stage_h * scale + 8
    rows = [(form, state) for form in FORMS for state in STATES]
    width = label_w + columns * (stage_w * scale + gap) + 8
    height = 22 + len(rows) * row_h
    sheet = background(kind, (width, height), checker_cell=max(2, scale * 2))
    draw = ImageDraw.Draw(sheet)
    text = (235, 238, 242, 255) if kind == "dark" else (25, 30, 38, 255)
    draw.text((4, 3), f"Candidate C origin/body clearance | thinking + widest error | {kind} {scale}x", fill=text, font=font)
    for row_index, (form, state) in enumerate(rows):
        y = 22 + row_index * row_h
        draw.text((4, y + 2), f"{form}/{state}", fill=text, font=font)
        x = label_w
        body = body_frame(form, state, row_index % 2)
        for origin in ORIGINS:
            for name in ("thinking-model", "error"):
                tile = stage_tile(kind, body, candidate[name][0], origin)
                if scale != 1:
                    tile = tile.resize((stage_w * scale, stage_h * scale), Image.Resampling.NEAREST)
                sheet.alpha_composite(tile, (x, y))
                x += stage_w * scale + gap
    path = QA / f"candidate-c-origin-body-forms-{kind}-{scale}x.png"
    png(path, sheet)
    return path


def main() -> None:
    source_frames: dict[str, list[Image.Image]] = {}
    display_frames: dict[str, list[Image.Image]] = {}
    files: dict[str, str] = {}
    validation: dict[str, object] = {}

    for name in SIGNALS:
        native = [render(GLYPHS[name][frame]) for frame in range(2)]
        display = [frame.resize((12, 12), Image.Resampling.NEAREST) for frame in native]
        source_frames[name] = native
        display_frames[name] = display
        for frame_index in range(2):
            source_path = OUT / "source-frames" / f"{name}-{frame_index:02}.png"
            display_path = OUT / "frames" / f"{name}-{frame_index:02}.png"
            png(source_path, native[frame_index])
            png(display_path, display[frame_index])
            files[str(source_path.relative_to(OUT))] = sha256(source_path)
            files[str(display_path.relative_to(OUT))] = sha256(display_path)
        source_strip = Image.new("RGBA", (12, 6), PALETTE["."])
        display_strip = Image.new("RGBA", (24, 12), PALETTE["."])
        for frame_index in range(2):
            source_strip.alpha_composite(native[frame_index], (frame_index * 6, 0))
            display_strip.alpha_composite(display[frame_index], (frame_index * 12, 0))
        source_strip_path = OUT / "source-strips" / f"{name}.png"
        display_strip_path = OUT / "strips" / f"{name}.png"
        png(source_strip_path, source_strip)
        png(display_strip_path, display_strip)
        files[str(source_strip_path.relative_to(OUT))] = sha256(source_strip_path)
        files[str(display_strip_path.relative_to(OUT))] = sha256(display_strip_path)
        validation[name] = {
            "sourceFrame": [6, 6],
            "displayFrame": [12, 12],
            "strip": [24, 12],
            "frameCount": 2,
            "alphaValues": sorted(set(display_strip.getchannel("A").getdata())),
            "frame0OpaqueNativePixels": sum(1 for pixel in native[0].getdata() if pixel[3]),
            "changedNativePixels": sum(1 for a, b in zip(native[0].getdata(), native[1].getdata()) if a != b),
        }

    overlap_details: dict[str, dict[str, int]] = {}
    overlap_summary: dict[str, object] = {}
    for origin in ORIGINS:
        origin_key = f"{origin[0]},{origin[1]}"
        details: dict[str, int] = {}
        nonzero: list[tuple[str, int]] = []
        total = 0
        maximum = 0
        for form in FORMS:
            for state in STATES:
                for body_index in range(2):
                    body = body_frame(form, state, body_index)
                    for name in SIGNALS:
                        for signal_index in range(2):
                            key = f"{form}/{state}/body-{body_index}/{name}/signal-{signal_index}"
                            count = overlap_pixels(body, display_frames[name][signal_index], origin)
                            details[key] = count
                            total += count
                            maximum = max(maximum, count)
                            if count:
                                nonzero.append((key, count))
        overlap_details[origin_key] = details
        overlap_summary[origin_key] = {
            "combinationsTested": len(details),
            "nonzeroCombinations": len(nonzero),
            "totalOverlapPixelsAcrossAllCombinations": total,
            "maxOverlapPixelsInOneCombination": maximum,
            "worstCases": [{"case": key, "pixels": count} for key, count in sorted(nonzero, key=lambda item: (-item[1], item[0]))[:20]],
        }

    contact_paths = []
    for kind in ("dark", "light", "checker"):
        for scale in (1, 2, 4):
            contact_paths.append(make_contact(display_frames, kind, scale, RECOMMENDED_ORIGIN))
            contact_paths.append(make_form_origin_sheet(display_frames, kind, scale))

    manifest = {
        "schemaVersion": 1,
        "asset": "halo-soft-cube-grouped-activity-signals-candidate-c",
        "status": "source-candidate",
        "productionApproved": False,
        "humanApproved": False,
        "idleIncluded": False,
        "semanticModel": "independent signal layer; body affect remains independently selected",
        "wrapper": {"display": [32, 24], "overflowPolicy": "up to 6 display pixels right is intentionally visible"},
        "placement": {
            "recommendedDisplayOrigin": list(RECOMMENDED_ORIGIN),
            "comparedDisplayOrigins": [list(origin) for origin in ORIGINS],
            "sourceFrame": [6, 6],
            "displayFrame": [12, 12],
            "scale": 2,
            "resampling": "nearest-neighbor",
        },
        "signals": SIGNALS,
        "animation": {
            "framesPerSignal": 2,
            "staticReadabilityFrame": 0,
            "bodyAffectIndependent": True,
            "motionPolicy": "frame 0 is complete; frame 1 changes only a restrained accent",
        },
        "pixelFormat": "RGBA PNG; alpha values restricted to 0 and 255",
        "palette": {name: "#%02X%02X%02X%02X" % rgba for name, rgba in PALETTE.items()},
        "provenance": {
            "sourceLane": "manual-procedural-native-grid",
            "usage": "source-candidate",
            "imagegenUsed": False,
            "humanApproved": False,
        },
        "comparisonBaseline": {
            "name": "selected tracked Candidate C parity target",
            "path": "apps/desktop/public/mascots/halo-soft-cube/signals",
            "displayFrame": [12, 12],
            "displayOrigin": [22, 6],
        },
        "overlapSummary": overlap_summary,
        "files": files,
        "qaContactSheets": [str(path.relative_to(JOB)) for path in contact_paths],
    }
    manifest_path = OUT / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    (QA / "candidate-c-validation.json").write_text(json.dumps(validation, indent=2) + "\n")
    (QA / "candidate-c-overlap.json").write_text(json.dumps({"summary": overlap_summary, "details": overlap_details}, indent=2) + "\n")


if __name__ == "__main__":
    main()
