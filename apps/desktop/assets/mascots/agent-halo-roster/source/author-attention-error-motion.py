#!/usr/bin/env python3
"""Deterministic review-only Attention/Error motion authoring from approved 24x18 frames."""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Iterable
from PIL import Image, ImageDraw, ImageFont

JOB = Path(__file__).resolve().parent
ROOT = Path(__file__).resolve().parents[6]
PRODUCTION_MANIFEST = ROOT / "apps/desktop/public/mascots/agent-halo-roster/manifest.json"
SOURCE = ROOT / "apps/desktop/assets/mascots/agent-halo-roster/source/frames"
MASCOTS = ["pot", "crawler", "bat", "jelly", "cat", "crt", "cactus", "nautilus", "turtle", "lantern", "kettle", "dragonfly", "giraffe", "scorpion", "squid"]
STATES = ["attention", "error"]
SIZE = (24, 18)
TRANSPARENT = (0, 0, 0, 0)
PALETTE = [(230, 250, 255, 255), (174, 235, 250, 255), (85, 199, 232, 255), (38, 132, 170, 255), (18, 63, 90, 255), (2, 18, 32, 255)]
PALETTE_SET = set(PALETTE)
DURATIONS = {"attention": [260, 180, 260], "error": [220, 150, 260]}

# Every operation moves only a named appendage/detail box by one native pixel.
# Boxes are half-open (left, top, right, bottom). Frame 0 is always the exact approved source.
OPS = {
    "pot": {"attention": [[("box", (9, 0, 14, 6), -1, 0)], [("box", (9, 0, 14, 6), 1, 0)]], "error": [[("box", (8, 2, 13, 7), -1, 0)], [("box", (8, 2, 13, 7), 1, 0)]]},
    "crawler": {"attention": [[("box", (7, 0, 14, 4), -1, 0)], [("box", (7, 0, 14, 4), 1, 0)]], "error": [[("box", (7, 2, 14, 6), -1, 0)], [("box", (7, 2, 14, 6), 1, 0)]]},
    "bat": {"attention": [[("box", (3, 0, 8, 4), 1, 0), ("box", (16, 0, 21, 4), -1, 0)], [("box", (3, 0, 8, 4), 0, 1), ("box", (16, 0, 21, 4), 0, 1)]], "error": [[("box", (3, 3, 8, 6), 1, 0)], [("box", (16, 3, 21, 6), -1, 0)]]},
    "jelly": {"attention": [[("box", (5, 10, 9, 16), -1, 0)], [("box", (10, 10, 15, 16), 1, 0)]], "error": [[("box", (5, 12, 9, 16), 1, 0)], [("box", (10, 12, 15, 16), -1, 0)]]},
    "cat": {"attention": [[("box", (2, 0, 8, 4), 1, 0)], [("box", (16, 0, 22, 4), -1, 0)]], "error": [[("box", (17, 13, 22, 17), -1, 0)], [("box", (17, 13, 22, 17), 0, -1)]]},
    "crt": {"attention": [[("box", (18, 1, 22, 5), 0, -1)], [("box", (18, 1, 22, 5), -1, 0)]], "error": [[("box", (8, 14, 16, 18), -1, 0)], [("box", (8, 14, 16, 18), 1, 0)]]},
    "cactus": {"attention": [[("box", (10, 0, 15, 4), -1, 0)], [("box", (10, 0, 15, 4), 1, 0)]], "error": [[("box", (1, 7, 8, 12), 0, 1)], [("box", (1, 7, 8, 12), 1, 0)]]},
    "nautilus": {"attention": [[("box", (14, 10, 22, 14), 0, -1)], [("box", (14, 10, 22, 14), 1, 0)]], "error": [[("box", (13, 12, 21, 15), -1, 0)], [("box", (13, 12, 21, 15), 0, 1)]]},
    "turtle": {"attention": [[("box", (0, 5, 7, 12), 0, -1)], [("box", (0, 5, 7, 12), 1, 0)]], "error": [[("box", (0, 9, 7, 13), 0, 1)], [("box", (0, 9, 7, 13), 1, 0)]]},
    "lantern": {"attention": [[("box", (7, 0, 13, 4), -1, 0)], [("box", (7, 0, 13, 4), 1, 0)]], "error": [[("box", (5, 14, 15, 17), -1, 0)], [("box", (5, 14, 15, 17), 1, 0)]]},
    "kettle": {"attention": [[("box", (7, 0, 13, 4), -1, 0)], [("box", (7, 0, 13, 4), 1, 0)]], "error": [[("box", (19, 9, 24, 13), 0, 1)], [("box", (19, 9, 24, 13), -1, 0)]]},
    "dragonfly": {"attention": [[("box", (1, 5, 8, 9), 0, -1), ("box", (15, 5, 22, 9), 0, 1)], [("box", (1, 5, 8, 9), 0, 1), ("box", (15, 5, 22, 9), 0, -1)]], "error": [[("box", (1, 7, 8, 11), 0, 1)], [("box", (15, 7, 22, 11), 0, 1)]]},
    "giraffe": {"attention": [[("box", (7, 0, 13, 3), -1, 0)], [("box", (7, 0, 13, 3), 1, 0)]], "error": [[("box", (7, 6, 14, 10), -1, 0)], [("box", (7, 6, 14, 10), 1, 0)]]},
    "scorpion": {"attention": [[("box", (10, 0, 16, 7), -1, 0)], [("box", (10, 0, 16, 7), 1, 0)]], "error": [[("box", (10, 4, 16, 9), -1, 0)], [("box", (10, 4, 16, 9), 1, 0)]]},
    "squid": {"attention": [[("box", (7, 9, 10, 16), -1, 0)], [("box", (12, 9, 16, 16), 1, 0)]], "error": [[("box", (7, 11, 10, 15), 1, 0)], [("box", (12, 11, 16, 15), -1, 0)]]},
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bounds(img: Image.Image):
    return img.getchannel("A").getbbox()


def move_box(img: Image.Image, box, dx: int, dy: int) -> Image.Image:
    left, top, right, bottom = box
    out = img.copy()
    pixels = []
    for y in range(top, bottom):
        for x in range(left, right):
            px = img.getpixel((x, y))
            if px[3]:
                pixels.append((x, y, px))
                out.putpixel((x, y), TRANSPARENT)
    for x, y, px in pixels:
        nx, ny = x + dx, y + dy
        if 0 <= nx < 24 and 0 <= ny < 18:
            out.putpixel((nx, ny), px)
    return out


def apply_ops(base: Image.Image, operations) -> Image.Image:
    out = base.copy()
    for kind, box, dx, dy in operations:
        assert kind == "box"
        out = move_box(out, box, dx, dy)
    return out


def pixels(img: Image.Image):
    return list(img.convert("RGBA").getdata())


def validate_frame(img: Image.Image, source_palette: set, label: str):
    assert img.size == SIZE, f"{label}: wrong size"
    for px in pixels(img):
        assert px[3] in (0, 255), f"{label}: non-binary alpha"
        if px[3]:
            assert px in PALETTE_SET, f"{label}: outside production palette {px}"
            assert px in source_palette, f"{label}: introduced color {px}"


def fixed_palette_frame(img: Image.Image, canvas_size=SIZE, offset=(0, 0), scale_to=None):
    rgba = img
    if scale_to:
        rgba = img.resize(scale_to, Image.Resampling.NEAREST)
        canvas_size = scale_to
    canvas = Image.new("RGBA", canvas_size, TRANSPARENT)
    canvas.alpha_composite(rgba, offset)
    pal = [0, 0, 0]
    for color in PALETTE:
        pal.extend(color[:3])
    pal.extend([0, 0, 0] * (256 - 1 - len(PALETTE)))
    indexes = {color: i + 1 for i, color in enumerate(PALETTE)}
    frame = Image.new("P", canvas_size, 0)
    frame.putpalette(pal)
    frame.putdata([0 if px[3] == 0 else indexes[px] for px in canvas.getdata()])
    frame.info["transparency"] = 0
    return frame


def save_gif(frames: list[Image.Image], path: Path, durations: list[int], size=None):
    gif_frames = [fixed_palette_frame(f, scale_to=size) for f in frames]
    gif_frames[0].save(path, save_all=True, append_images=gif_frames[1:], duration=durations,
                       loop=0, disposal=2, transparency=0, background=0, optimize=False)


def metrics(a: Image.Image, b: Image.Image):
    pa, pb = pixels(a), pixels(b)
    ma = {i for i, p in enumerate(pa) if p[3]}
    mb = {i for i, p in enumerate(pb) if p[3]}
    changed = sum(x != y for x, y in zip(pa, pb))
    return {"changedPixels": changed, "detailDelta": round(changed / 432, 4),
            "silhouetteIoU": round(len(ma & mb) / len(ma | mb), 4)}


def composite(img: Image.Image, size, bg):
    scaled = img.resize(size, Image.Resampling.NEAREST)
    out = Image.new("RGBA", size, bg)
    out.alpha_composite(scaled)
    return out


def make_contact(frames_map, bg_name: str, scale=4):
    bg = {"dark": (13, 17, 23, 255), "light": (246, 248, 250, 255)}.get(bg_name)
    label_w, header_h = 86, 18
    cw, ch = 24 * scale, 18 * scale
    board = Image.new("RGBA", (label_w + 6 * cw, header_h + len(MASCOTS) * ch), bg or (255, 255, 255, 255))
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default()
    if bg_name == "checker":
        for y in range(header_h, board.height, 8):
            for x in range(label_w, board.width, 8):
                c = (230, 230, 230, 255) if ((x-label_w)//8 + (y-header_h)//8) % 2 == 0 else (185, 185, 185, 255)
                draw.rectangle((x, y, x+7, y+7), fill=c)
    text = (230, 250, 255, 255) if bg_name == "dark" else (18, 63, 90, 255)
    labels = ["A0", "A1", "A2", "E0", "E1", "E2"]
    for i, label in enumerate(labels): draw.text((label_w + i*cw + 4, 4), label, fill=text, font=font)
    for row, mascot in enumerate(MASCOTS):
        y = header_h + row * ch
        draw.text((4, y + ch//2 - 5), mascot, fill=text, font=font)
        all_frames = frames_map[mascot]["attention"] + frames_map[mascot]["error"]
        for col, frame in enumerate(all_frames):
            board.alpha_composite(frame.resize((cw, ch), Image.Resampling.NEAREST), (label_w + col*cw, y))
    return board


def make_actual_contact(frames_map, state: str, size, bg, path):
    gap, label_h = 8, 14
    board = Image.new("RGBA", (5 * (size[0] + gap) + gap, 3 * (size[1] + label_h + gap) + gap), bg)
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default()
    for idx, mascot in enumerate(MASCOTS):
        x = gap + (idx % 5) * (size[0] + gap)
        y = gap + (idx // 5) * (size[1] + label_h + gap)
        draw.text((x, y), mascot, fill=(174, 235, 250, 255) if bg[0] < 50 else (18, 63, 90, 255), font=font)
        # Middle frame makes restrained motion differences most visible at runtime size.
        board.alpha_composite(frames_map[mascot][state][1].resize(size, Image.Resampling.NEAREST), (x, y + label_h))
    board.save(path)


def gallery_html(qa):
    cards = []
    for mascot in MASCOTS:
        note = qa[mascot]["reviewNote"]
        cards.append(f'''<article><h2>{mascot}</h2><div class="pair"><figure><img src="previews/session/{mascot}-attention.gif" width="48" height="36"><figcaption>Attention</figcaption></figure><figure><img src="previews/session/{mascot}-error.gif" width="48" height="36"><figcaption>Error</figcaption></figure></div><p>{note}</p></article>''')
    return '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Agent Halo Attention/Error review</title><style>body{margin:0;padding:24px;background:#0d1117;color:#e6faff;font:14px system-ui,sans-serif}header,main{max-width:1080px;margin:auto}h1{font-size:24px;margin:0 0 8px}header p{color:#aeebfa;margin:0 0 24px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}article{border:1px solid #263746;padding:12px;background:#121a22}h2{font-size:15px;text-transform:capitalize;margin:0 0 10px}.pair{display:flex;gap:20px}figure{margin:0;text-align:center}img{image-rendering:pixelated;background:#0a0e12}figcaption{font-size:12px;color:#aeebfa;margin-top:4px}article p{font-size:12px;line-height:1.4;color:#9fb0bc;margin:10px 0 0}</style><header><h1>Attention / Error body-motion review</h1><p>Review candidate only. Exact approved identities are the frame-0 source; signals remain separate.</p></header><main>''' + "".join(cards) + "</main></html>"


def clean_outputs():
    for name in ["frames", "strips", "gifs", "previews", "contacts"]:
        path = JOB / name
        if path.exists(): shutil.rmtree(path)
        path.mkdir(parents=True)
    for path in [JOB/"previews"/"ambient", JOB/"previews"/"session"]: path.mkdir(parents=True)


def validate_pack():
    expected = {"frames": 90, "strips": 30, "gifs": 30,
                "previews/ambient": 30, "previews/session": 30}
    counts = {folder: len(list((JOB/folder).glob("*.png" if folder in ("frames", "strips") else "*.gif"))) for folder in expected}
    assert counts == expected, (counts, expected)
    gif_checks = {}
    for path in sorted(list((JOB/"gifs").glob("*.gif")) + list((JOB/"previews"/"ambient").glob("*.gif")) + list((JOB/"previews"/"session").glob("*.gif"))):
        img = Image.open(path)
        frames = []
        first_palette = None
        for i in range(img.n_frames):
            img.seek(i)
            palette = img.getpalette()
            if i == 0:
                first_palette = palette
            frames.append({"mode": img.mode, "size": list(img.size), "disposal": getattr(img, "disposal_method", None), "paletteMatchesFirst": palette in (None, first_palette)})
        assert len(frames) == 3
        assert all(f["disposal"] == 2 for f in frames), (path, frames)
        assert all(f["paletteMatchesFirst"] for f in frames), (path, frames)
        gif_checks[str(path.relative_to(JOB))] = frames
    result = {"passed": True, "counts": counts, "gifContract": {"fixedPalette": True, "disposal": 2, "framesEach": 3}, "gifChecks": gif_checks}
    (JOB/"validation.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main():
    clean_outputs()
    production_hash = sha(PRODUCTION_MANIFEST)
    frames_map = {}
    qa = {}
    source_hashes = {}
    generated_files = {}
    warnings = []
    for mascot in MASCOTS:
        frames_map[mascot] = {}
        qa[mascot] = {}
        for state in STATES:
            source_path = SOURCE / mascot / f"{state}.png"
            source_hashes[f"{mascot}/{state}.png"] = sha(source_path)
            base = Image.open(source_path).convert("RGBA")
            source_palette = {p for p in pixels(base) if p[3]}
            authored = [base] + [apply_ops(base, ops) for ops in OPS[mascot][state]]
            for i, frame in enumerate(authored):
                validate_frame(frame, source_palette, f"{mascot}-{state}-{i}")
                out = JOB / "frames" / f"{mascot}-{state}-{i}.png"
                frame.save(out, optimize=False)
            strip = Image.new("RGBA", (72, 18), TRANSPARENT)
            for i, frame in enumerate(authored): strip.alpha_composite(frame, (24*i, 0))
            strip_path = JOB / "strips" / f"{mascot}-{state}.png"
            strip.save(strip_path, optimize=False)
            save_gif(authored, JOB/"gifs"/f"{mascot}-{state}.gif", DURATIONS[state])
            save_gif(authored, JOB/"previews"/"ambient"/f"{mascot}-{state}.gif", DURATIONS[state], (40, 30))
            save_gif(authored, JOB/"previews"/"session"/f"{mascot}-{state}.gif", DURATIONS[state], (48, 36))
            transitions = []
            duplicates = []
            for i in range(3):
                j = (i + 1) % 3
                m = metrics(authored[i], authored[j])
                m.update({"from": i, "to": j})
                transitions.append(m)
                if m["changedPixels"] == 0: duplicates.append([i, j])
            base_bounds = bounds(base)
            frame_bounds = [bounds(x) for x in authored]
            drift = [max(abs(a-b) for a, b in zip(base_bounds, bb)) for bb in frame_bounds]
            note = "restrained one-pixel appendage/body-detail motion; verify personality at target size"
            qa[mascot][state] = {"sourceFrameSha256": source_hashes[f"{mascot}/{state}.png"], "frame0ExactSource": pixels(authored[0]) == pixels(base), "transitions": transitions, "duplicateAdjacentPairs": duplicates, "bounds": frame_bounds, "maxBoundsDriftPx": max(drift), "binaryAlpha": True, "sourcePaletteOnly": True}
            if duplicates: warnings.append(f"{mascot}/{state}: duplicate adjacent frames {duplicates}")
            if max(drift) > 1: warnings.append(f"{mascot}/{state}: bounds drift {max(drift)}px")
            frames_map[mascot][state] = authored
        qa[mascot]["reviewNote"] = "Subtle appendage-led loops; no palette, scale, baseline, or whole-body transform changes."

    for bg in ["dark", "light", "checker"]:
        make_contact(frames_map, bg).save(JOB/"contacts"/f"attention-error-{bg}-4x.png")
    make_actual_contact(frames_map, "attention", (40, 30), (13, 17, 23, 255), JOB/"contacts"/"attention-ambient-40x30-dark.png")
    make_actual_contact(frames_map, "error", (40, 30), (246, 248, 250, 255), JOB/"contacts"/"error-ambient-40x30-light.png")
    make_actual_contact(frames_map, "attention", (48, 36), (246, 248, 250, 255), JOB/"contacts"/"attention-session-48x36-light.png")
    make_actual_contact(frames_map, "error", (48, 36), (13, 17, 23, 255), JOB/"contacts"/"error-session-48x36-dark.png")

    (JOB/"index.html").write_text(gallery_html(qa))
    qa_payload = {"status": "review-candidate", "productionApproved": False, "productionManifestSha256": production_hash, "summary": {"mascots": 15, "motions": 2, "frames": 90, "strips": 30, "nativeGifs": 30, "ambientPreviews": 30, "sessionPreviews": 30, "warnings": warnings}, "mascots": qa}
    (JOB/"qa.json").write_text(json.dumps(qa_payload, indent=2) + "\n")
    validate_pack()

    for path in sorted(JOB.rglob("*")):
        if path.is_file() and path.name != "manifest.json":
            generated_files[str(path.relative_to(JOB))] = sha(path)
    manifest = {"jobId": "20260716-halo-roster-attention-error-motion-v1", "name": "Agent Halo roster Attention/Error body-motion extension", "status": "review-candidate", "humanApproved": False, "productionApproved": False, "promotion": "forbidden-until-explicit-human-approval", "roster": MASCOTS, "motions": {"attention": {"frames": 3, "durationMs": DURATIONS["attention"], "playback": "loop"}, "error": {"frames": 3, "durationMs": DURATIONS["error"], "playback": "loop"}}, "frame": {"source": [24, 18], "ambientPreview": [40, 30], "sessionPreview": [48, 36], "anchor": [12, 16], "baselineY": 16, "alpha": "binary", "background": "transparent"}, "source": {"productionManifest": str(PRODUCTION_MANIFEST.relative_to(ROOT)), "productionManifestSha256": production_hash, "exactAcceptedFrames": str(SOURCE.relative_to(ROOT)), "frameHashes": source_hashes, "policy": "Frame 0 is byte-content-equivalent RGBA to the exact accepted frame. Frames 1-2 use only bounded one-pixel native-grid appendage/detail edits. No image generation, redraw, resampling of native frames, palette changes, or production writes."}, "semanticSignalContract": "Stationary semantic signal remains separate and is not included in these body frames.", "qa": "qa.json", "gallery": "index.html", "files": generated_files}
    (JOB/"manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(qa_payload["summary"], indent=2))


if __name__ == "__main__":
    main()
