#!/usr/bin/python3
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
REPO = next(parent for parent in ROOT.parents if (parent / ".git").exists())
JOB = REPO / ".agent-state/sprite-workflow/generated/halo-soft-cube-action-signals-v1"
OUT = JOB / "outbox"
QA = JOB / "qa"
RUNTIME = REPO / "apps/desktop/public/mascots/halo-soft-cube"
SOURCE = ROOT

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

PALETTE = {
    "bright": (229, 250, 255, 255),
    "base": (85, 199, 232, 255),
    "deep": (18, 63, 90, 255),
    "clear": (0, 0, 0, 0),
}


def png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=False)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canvas(size=(8, 8)) -> Image.Image:
    return Image.new("RGBA", size, PALETTE["clear"])


def px(im: Image.Image, coords, color="bright") -> None:
    for x, y in coords:
        if 0 <= x < im.width and 0 <= y < im.height:
            im.putpixel((x, y), PALETTE[color])


def line(im: Image.Image, coords, color="bright") -> None:
    px(im, coords, color)


def glyph(name: str, frame: int) -> Image.Image:
    im = canvas()
    # Every frame keeps the primary silhouette. Motion is limited to one accent/pupil/cursor packet.
    if name == "thinking-model":
        px(im, [(2,1),(3,1),(4,1),(1,2),(5,2),(1,3),(5,3),(2,4),(3,4),(4,4)], "deep")
        px(im, [(2,2),(3,2),(4,2),(2,3),(3,3),(4,3)], "base")
        px(im, [(2,3),(3,3),(4,3)], "bright")
        px(im, [(5,5),(6,6)] if frame == 0 else [(6,5),(5,6)], "bright")
    elif name == "shell-tool-skill":
        px(im, [(1,1),(2,1),(3,1),(4,1),(5,1),(6,1),(1,2),(6,2),(1,3),(6,3),(1,4),(6,4),(1,5),(2,5),(3,5),(4,5),(5,5),(6,5)], "deep")
        px(im, [(2,2),(3,3),(2,4)], "bright")
        px(im, [(4,4),(5,4)] if frame == 0 else [(4,4)], "base")
    elif name == "editing":
        px(im, [(1,1),(2,1),(3,1),(4,1),(1,2),(4,2),(1,3),(4,3),(1,4),(4,4),(1,5),(2,5),(3,5),(4,5)], "deep")
        px(im, [(2,2),(3,2),(2,3),(3,3),(2,4),(3,4)], "base")
        px(im, [(4,5),(5,4),(6,3)] if frame == 0 else [(3,6),(4,5),(5,4)], "bright")
        px(im, [(5,5)], "deep")
    elif name == "planning-goal":
        px(im, [(2,1),(2,2),(2,3),(2,4),(2,5),(2,6)], "deep")
        px(im, [(3,1),(4,1),(5,2),(4,3),(3,3)], "base")
        px(im, [(4,2)] if frame == 0 else [(5,1)], "bright")
        px(im, [(1,6),(3,6)], "bright")
    elif name == "delegating":
        px(im, [(3,1),(4,1),(3,2),(4,2)], "deep")
        px(im, [(3,3),(4,3),(2,4),(3,4),(4,4),(5,4),(1,5),(2,5),(5,5),(6,5),(1,6),(2,6),(5,6),(6,6)], "deep")
        px(im, [(3,2),(1,5),(6,5)], "base")
        px(im, [(3,3)] if frame == 0 else [(5,4)], "bright")
    elif name == "visual":
        px(im, [(1,3),(2,2),(3,2),(4,2),(5,2),(6,3),(5,4),(4,5),(3,5),(2,4)], "deep")
        px(im, [(2,3),(3,3),(4,3),(5,3),(3,4),(4,4)], "base")
        px(im, [(3,3)] if frame == 0 else [(4,3)], "bright")
    elif name == "memory":
        px(im, [(1,1),(2,1),(3,1),(4,1),(5,1),(6,1),(1,2),(6,2),(1,3),(6,3),(1,4),(6,4),(1,5),(2,5),(3,5),(4,5),(5,5),(6,5)], "deep")
        px(im, [(2,2),(3,2),(4,2),(5,2),(2,3),(3,3),(4,3),(5,3),(2,4),(3,4),(4,4),(5,4)], "base")
        px(im, [(2,2),(3,2),(4,2),(5,2)] if frame == 0 else [(2,4),(3,4),(4,4),(5,4)], "bright")
        px(im, [(2,6),(4,6),(6,6)], "deep")
    elif name == "attention-asking":
        px(im, [(2,1),(3,1),(4,1),(5,2),(5,3),(4,4),(3,4),(3,5),(3,7)], "deep")
        px(im, [(3,2),(4,2),(4,3),(3,6)] if frame == 0 else [(3,2),(4,2),(4,3),(3,6),(4,6)], "bright")
    elif name == "done":
        px(im, [(1,4),(2,5),(3,6),(4,5),(5,4),(6,3)], "deep")
        px(im, [(2,4),(3,5),(4,4),(5,3),(6,2)], "bright")
        px(im, [(1,1),(1,2),(2,1)] if frame == 1 else [(1,1)], "base")
    elif name == "error":
        px(im, [(1,1),(2,2),(3,3),(4,4),(5,5),(6,6),(6,1),(5,2),(4,3),(3,4),(2,5),(1,6)], "deep")
        px(im, [(2,1),(3,2),(4,3),(5,4),(6,5),(5,1),(4,2),(3,3),(2,4),(1,5)], "bright")
        px(im, [(6,6)] if frame == 0 else [(1,1)], "base")
    else:
        raise KeyError(name)
    return im


def reduce_4x4(im: Image.Image) -> Image.Image:
    out = canvas((4, 4))
    rank = {PALETTE["clear"]: 0, PALETTE["deep"]: 1, PALETTE["base"]: 2, PALETTE["bright"]: 3}
    for oy in range(4):
        for ox in range(4):
            block = [im.getpixel((ox * 2 + dx, oy * 2 + dy)) for dy in range(2) for dx in range(2)]
            opaque = [c for c in block if c[3] != 0]
            if len(opaque) >= 2:
                out.putpixel((ox, oy), max(opaque, key=lambda c: rank.get(c, 0)))
            elif len(opaque) == 1 and opaque[0] == PALETTE["bright"]:
                out.putpixel((ox, oy), opaque[0])
    return out


def checker(size: tuple[int, int], cell=4) -> Image.Image:
    im = Image.new("RGBA", size)
    for y in range(size[1]):
        for x in range(size[0]):
            c = (214, 216, 220, 255) if ((x // cell) + (y // cell)) % 2 == 0 else (246, 247, 249, 255)
            im.putpixel((x, y), c)
    return im


def background(kind: str, size: tuple[int, int]) -> Image.Image:
    if kind == "dark":
        return Image.new("RGBA", size, (15, 17, 21, 255))
    if kind == "light":
        return Image.new("RGBA", size, (248, 249, 250, 255))
    return checker(size)


def first_body_frame() -> Image.Image:
    strip = Image.open(RUNTIME / "body/core/working.png").convert("RGBA")
    return strip.crop((0, 0, 16, 12)).resize((32, 24), Image.Resampling.NEAREST)


def composite(signal: Image.Image, bg_kind: str) -> Image.Image:
    out = background(bg_kind, (32, 24))
    out.alpha_composite(first_body_frame())
    out.alpha_composite(signal, (24, 8))
    return out


def make_sheet(candidate: str, frames: dict[str, list[Image.Image]], bg_kind: str, scale: int) -> Path:
    font = ImageFont.load_default()
    label_w = 118
    tile_w = 32 * scale
    tile_h = 24 * scale
    row_h = max(tile_h, 12) + 5
    width = label_w + tile_w * 2 + 16
    height = 20 + len(SIGNALS) * row_h
    sheet = background(bg_kind, (width, height))
    draw = ImageDraw.Draw(sheet)
    text_color = (235, 238, 242, 255) if bg_kind == "dark" else (25, 30, 38, 255)
    draw.text((4, 4), f"{candidate} / {bg_kind} / {scale}x", fill=text_color, font=font)
    for i, name in enumerate(SIGNALS):
        y = 20 + i * row_h
        draw.text((4, y + 2), name, fill=text_color, font=font)
        for f in range(2):
            tile = composite(frames[name][f], bg_kind)
            if scale != 1:
                tile = tile.resize((tile_w, tile_h), Image.Resampling.NEAREST)
            sheet.alpha_composite(tile, (label_w + f * (tile_w + 6), y))
    path = QA / f"contact-{candidate}-{bg_kind}-{scale}x.png"
    png(path, sheet)
    return path


def alpha_values(im: Image.Image) -> list[int]:
    return sorted(set(im.getchannel("A").getdata()))


def main() -> None:
    for path in [OUT, QA]:
        path.mkdir(parents=True, exist_ok=True)

    candidates: dict[str, dict[str, list[Image.Image]]] = {"a-8x8-native": {}, "b-4x4-upscaled": {}}
    files = {}
    validation = {}

    for name in SIGNALS:
        a_frames = [glyph(name, 0), glyph(name, 1)]
        b_source = [reduce_4x4(im) for im in a_frames]
        b_frames = [im.resize((8, 8), Image.Resampling.NEAREST) for im in b_source]
        candidates["a-8x8-native"][name] = a_frames
        candidates["b-4x4-upscaled"][name] = b_frames

        for candidate, display_frames in [("a-8x8-native", a_frames), ("b-4x4-upscaled", b_frames)]:
            base = OUT / "candidates" / candidate
            source_frames = a_frames if candidate.startswith("a-") else b_source
            for idx, (src, disp) in enumerate(zip(source_frames, display_frames)):
                src_path = base / "source-frames" / f"{name}-{idx:02}.png"
                disp_path = base / "frames" / f"{name}-{idx:02}.png"
                png(src_path, src)
                png(disp_path, disp)
                files[str(src_path.relative_to(OUT))] = sha256(src_path)
                files[str(disp_path.relative_to(OUT))] = sha256(disp_path)
            source_strip = Image.new("RGBA", (source_frames[0].width * 2, source_frames[0].height), PALETTE["clear"])
            display_strip = Image.new("RGBA", (16, 8), PALETTE["clear"])
            for idx, src in enumerate(source_frames):
                source_strip.alpha_composite(src, (idx * src.width, 0))
            for idx, disp in enumerate(display_frames):
                display_strip.alpha_composite(disp, (idx * 8, 0))
            src_strip_path = base / "source-strips" / f"{name}.png"
            strip_path = base / "strips" / f"{name}.png"
            png(src_strip_path, source_strip)
            png(strip_path, display_strip)
            files[str(src_strip_path.relative_to(OUT))] = sha256(src_strip_path)
            files[str(strip_path.relative_to(OUT))] = sha256(strip_path)
            validation[f"{candidate}/{name}"] = {
                "sourceSize": list(source_frames[0].size),
                "displaySize": [8, 8],
                "displayStripSize": list(display_strip.size),
                "frameCount": 2,
                "alphaValues": alpha_values(display_strip),
                "staticFrameOpaquePixels": sum(1 for p in display_frames[0].getdata() if p[3]),
                "changedPixelsFrame0To1": sum(1 for p0, p1 in zip(display_frames[0].getdata(), display_frames[1].getdata()) if p0 != p1),
            }

    qa_files = []
    for candidate, frame_map in candidates.items():
        for bg in ["dark", "light", "checker"]:
            for scale in [1, 2, 4]:
                qa_files.append(make_sheet(candidate, frame_map, bg, scale))

    manifest = {
        "schemaVersion": 1,
        "asset": "halo-soft-cube-grouped-activity-signals-v1",
        "status": "source-candidate",
        "productionApproved": False,
        "idleIncluded": False,
        "semanticModel": "independent signal layer; body affect remains independently selected",
        "wrapper": {"display": [32, 24]},
        "placement": {"displayOrigin": [24, 8], "displaySlot": [8, 8], "bodyReserveSource": {"x": [12, 15], "y": [4, 7]}},
        "signals": SIGNALS,
        "mapping": {
            "thinking/model": "thinking-model",
            "shell/tool/skill": "shell-tool-skill",
            "editing": "editing",
            "planning/goal": "planning-goal",
            "delegating": "delegating",
            "visual": "visual",
            "memory": "memory",
            "attention/asking": "attention-asking",
            "done": "done",
            "error": "error"
        },
        "candidates": {
            "a-8x8-native": {"sourceFrame": [8, 8], "displayFrame": [8, 8], "scale": 1, "framesPerSignal": 2, "recommended": True},
            "b-4x4-upscaled": {"sourceFrame": [4, 4], "displayFrame": [8, 8], "scale": 2, "framesPerSignal": 2, "recommended": False, "role": "size-control baseline"}
        },
        "animation": {"frameCount": 2, "defaultDurationMs": 240, "staticReadabilityFrame": 0, "motionPolicy": "primary silhouette fixed; only one restrained accent, cursor, pupil, packet, or sparkle changes"},
        "pixelFormat": "RGBA PNG; alpha values restricted to 0 and 255",
        "palette": {k: "#%02X%02X%02X%02X" % v for k, v in PALETTE.items()},
        "provenance": {"sourceLane": "manual-procedural-native-grid", "usage": "source-candidate", "imagegenUsed": False, "humanApproved": False},
        "files": files,
        "qaContactSheets": [str(p.relative_to(JOB)) for p in qa_files],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (QA / "validation.json").write_text(json.dumps(validation, indent=2) + "\n")

    job = {
        "id": JOB.name,
        "kind": "animation-strip",
        "workflowMode": "sprite-generate",
        "title": "Halo Soft Cube grouped activity signal candidates",
        "targetRepo": str(REPO),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "prompt": "Deterministic procedural native-grid semantic signals for grouped activity; no idle signal; independent from body affect.",
        "negativePrompt": "idle, labels in runtime rasters, antialiasing, gradients, blur, imagegen, body edits, tracked file edits",
        "jobNotes": "Staging only. Compare 8x8 native signal cells against the existing 4x4 source constraint. Do not promote.",
        "generationHints": {"seed": "deterministic-coordinate-map", "size": "8x8", "count": 2, "quality": "procedural"},
        "frameSize": [8, 8],
        "frameCount": 2,
        "states": SIGNALS,
        "sourceAssets": [str(SOURCE / "palette-index.json"), str(RUNTIME / "manifest.json"), str(RUNTIME / "body/core/working.png")],
        "action": "grouped-activity-signal",
        "direction": "ui-overlay",
        "contentPolicy": "detached-fx",
        "anchorPolicy": "fixed-reserve-slot",
        "provenance": {"sourceLane": "manual", "usage": "source-candidate"}
    }
    (JOB / "job.json").write_text(json.dumps(job, indent=2) + "\n")
    (JOB / "status.json").write_text(json.dumps({"state": "candidate-complete", "productionApproved": False, "humanApproved": False, "recommendedCandidate": "a-8x8-native"}, indent=2) + "\n")


if __name__ == "__main__":
    main()
