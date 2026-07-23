#!/usr/bin/python3
"""Build Haloform's approved deterministic body strips from tracked source inputs.

Default mode uses only files tracked beside this script.  --import-job is a one-time
migration helper used to copy the approved ignored job into this source package;
it is not required for future rebuilds.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[6]
RUNTIME = REPO / "apps/desktop/public/mascots/agent-halo-roster/body/haloform"
ORDER = ("body", "head", "face", "top")
SIZES = {"ambient": 30, "session": 36, "completion": 96}
STATES = ("idle", "working", "attention", "done", "error")
SOURCE_HASH = "eb7d1d8abfcdcb5c41fa279fb0b9851d2571d5ba9c688cce0e30ee35d8067b98"
CANONICAL_HASH = "cfe819f6c97cb8251f34eb5f55acdb3cbfe461ced285f109502ad4cbdc6565fb"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def assert_binary_alpha(image: Image.Image, label: str) -> None:
    values = set(image.getchannel("A").getdata())
    if not values <= {0, 255}:
        raise RuntimeError(f"{label} has non-binary alpha: {sorted(values)[:12]}")


def assert_no_chroma(image: Image.Image, label: str) -> None:
    if any(px[:3] == (255, 0, 255) and px[3] for px in image.getdata()):
        raise RuntimeError(f"{label} contains opaque magenta chroma pixels")


def import_job(job: Path) -> None:
    """Copy the exact approved job inputs once; default build never reads job."""
    copies = {
        "assets/call_TJam6nD90EGODPCWIlZHJxVr.png": "provider/raw/call_TJam6nD90EGODPCWIlZHJxVr.png",
        "assets/upstream-provider-receipt.json": "provider/upstream-provider-receipt.json",
        "assets/selected-source-receipt.json": "provider/selected-source-receipt.json",
        "outbox/canonical-master.png": "canonical/canonical96.png",
        "outbox/assembled.png": "canonical/neutral-recomposition.png",
        "outbox/manifest.json": "evidence/source-manifest.json",
        "outbox/mask-analysis.md": "evidence/mask-analysis.md",
        "outbox/qa-report.md": "evidence/qa-report.md",
        "outbox/mask-analysis-overlay.png": "evidence/mask-analysis-overlay.png",
        "outbox/mask-before-after.png": "evidence/mask-before-after.png",
        "outbox/motion-mask-acceptance.png": "evidence/motion-mask-acceptance.png",
        "outbox/recomposition-diff.png": "evidence/recomposition-diff.png",
        "outbox/ownership-map.png": "evidence/ownership-map.png",
        "outbox/motion-demo/manifest.json": "motion/motion-recipes.json",
        "outbox/motion-demo/motion-overview.png": "motion/approved-motion-overview.png",
    }
    for layer in ORDER:
        copies[f"outbox/layers/{layer}.png"] = f"layers/{layer}.png"
    for mask in (
        "body-visible.png", "face-visible.png", "head-visible.png", "top-visible.png",
        "body-neck-underlay.png", "head-cap-underlay.png", "head-screen-underlay.png",
    ):
        copies[f"outbox/masks/{mask}"] = f"masks/{mask}"
    for source, destination in copies.items():
        src, dst = job / source, ROOT / destination
        if not src.is_file():
            raise RuntimeError(f"approved job input missing: {src}")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
    (ROOT / "job-snapshot.json").write_text(json.dumps({
        "jobId": job.name,
        "originalPath": str(job),
        "sourceRequirement": "imagegen-required",
        "sourceLane": "imagegen",
        "sourceHash": SOURCE_HASH,
        "canonical96Hash": CANONICAL_HASH,
        "importNote": "One-time copy from approved ignored job; all rebuild inputs are now tracked locally."
    }, indent=2) + "\n")


def load_recipes() -> dict:
    data = json.loads((ROOT / "motion/motion-recipes.json").read_text())
    recipes = data["states"]
    if tuple(recipes) != STATES:
        raise RuntimeError("unexpected approved state order")
    return recipes


def compose(layers: dict[str, Image.Image], offsets: dict[str, list[int]]) -> Image.Image:
    frame = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    for name in ORDER:
        xy = offsets.get(name, (0, 0))
        frame.alpha_composite(layers[name], tuple(xy))
    assert_binary_alpha(frame, "composed native96 frame")
    assert_no_chroma(frame, "composed native96 frame")
    return frame


def normalize(frame: Image.Image, size: int) -> Image.Image:
    if size == 96:
        output = frame.copy()
    else:
        # Nearest-neighbor normalization preserves the approved pixel vocabulary at
        # non-native runtime sizes; no soft mixel fringe is introduced.
        output = frame.resize((size, size), Image.Resampling.NEAREST)
    assert_binary_alpha(output, f"{size}px normalized frame")
    assert_no_chroma(output, f"{size}px normalized frame")
    return output


def write_strip(frames: list[Image.Image], destination: Path) -> Image.Image:
    cell = frames[0].width
    strip = Image.new("RGBA", (cell * len(frames), cell), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        strip.alpha_composite(frame, (cell * index, 0))
    assert_binary_alpha(strip, str(destination))
    assert_no_chroma(strip, str(destination))
    destination.parent.mkdir(parents=True, exist_ok=True)
    strip.save(destination)
    return strip


def make_review(deliveries: dict[str, dict[str, Image.Image]]) -> Path:
    # Every cell shows the full strip at its true source pixel scale, then NN zoomed
    # only for the review board. This is a compact visual audit, not runtime artwork.
    zoom = {"ambient": 4, "session": 4, "completion": 2}
    widths = {kind: max(deliveries[kind][state].width * zoom[kind] for state in STATES) for kind in SIZES}
    margin, label_w, row_gap, col_gap = 18, 92, 18, 18
    height = margin + sum(max(deliveries[kind][state].height * zoom[kind] for kind in SIZES) + row_gap for state in STATES) + 28
    width = label_w + margin + sum(widths[kind] + col_gap for kind in SIZES)
    board = Image.new("RGBA", (width, height), (13, 21, 29, 255))
    draw = ImageDraw.Draw(board)
    x = label_w
    for kind in SIZES:
        draw.text((x, 4), f"{kind} {SIZES[kind]}px", fill=(220, 236, 236, 255))
        x += widths[kind] + col_gap
    y = margin + 14
    for state in STATES:
        draw.text((8, y + 8), state, fill=(255, 188, 102, 255))
        x = label_w
        for kind in SIZES:
            strip = deliveries[kind][state]
            view = strip.resize((strip.width * zoom[kind], strip.height * zoom[kind]), Image.Resampling.NEAREST)
            board.alpha_composite(view, (x, y))
            x += widths[kind] + col_gap
        y += max(deliveries[kind][state].height * zoom[kind] for kind in SIZES) + row_gap
    draw.text((8, height - 18), "Provider-derived native96 normalization + explicit semantic masks; not provider-native 96px authorship.", fill=(151, 181, 183, 255))
    path = ROOT / "review/delivery-overview.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    board.save(path)
    return path


def build() -> None:
    required = [ROOT / "provider/raw/call_TJam6nD90EGODPCWIlZHJxVr.png", ROOT / "canonical/canonical96.png", ROOT / "motion/motion-recipes.json"]
    required.extend(ROOT / "layers" / f"{name}.png" for name in ORDER)
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError("tracked source package is incomplete:\n" + "\n".join(missing))
    if sha256(ROOT / "provider/raw/call_TJam6nD90EGODPCWIlZHJxVr.png") != SOURCE_HASH:
        raise RuntimeError("provider raw hash does not match selected receipt")
    if sha256(ROOT / "canonical/canonical96.png") != CANONICAL_HASH:
        raise RuntimeError("canonical96 hash does not match source evidence")
    layers = {name: rgba(ROOT / "layers" / f"{name}.png") for name in ORDER}
    for name, image in layers.items():
        if image.size != (96, 96):
            raise RuntimeError(f"{name} layer is not 96x96")
        assert_binary_alpha(image, f"{name} layer")
    recipes = load_recipes()
    native_frames: dict[str, list[Image.Image]] = {}
    for state in STATES:
        frames = recipes[state]["frames"]
        # Approved working demo includes a fourth neutral settle; runtime contract uses
        # the approved first three loop frames only.
        if state == "working":
            frames = frames[:3]
        expected = 4 if state == "done" else 3
        if len(frames) != expected:
            raise RuntimeError(f"{state} must provide {expected} delivery frames")
        native_frames[state] = [compose(layers, offsets) for offsets in frames]
    deliveries: dict[str, dict[str, Image.Image]] = {kind: {} for kind in SIZES}
    slots = []
    for kind, size in SIZES.items():
        for state in STATES:
            frames = [normalize(frame, size) for frame in native_frames[state]]
            target = RUNTIME / kind / f"{state}.png"
            strip = write_strip(frames, target)
            deliveries[kind][state] = strip
            slots.append({
                "delivery": kind,
                "state": state,
                "runtimePath": str(target.relative_to(REPO)),
                "sha256": sha256(target),
                "dimensions": [strip.width, strip.height],
                "frameSize": [size, size],
                "frameCount": len(frames),
                "binaryAlpha": True,
                "chromaPixels": 0,
                "sourceFrameSize": [96, 96],
                "sourceFrameIndexes": list(range(len(frames))),
                "workingNeutralSettleOmitted": state == "working",
                "durationsMs": recipes[state]["durations"][:len(frames)],
                "playback": recipes[state]["playback"],
            })
    review = make_review(deliveries)
    manifest = {
        "schemaVersion": 1,
        "asset": "haloform",
        "sourcePackage": "apps/desktop/assets/mascots/agent-halo-roster/source/haloform-motion-v1",
        "sourceJob": "20260723-haloforms-clarity-master96-semantic-v3 (snapshot tracked in source package)",
        "sourceMethod": "provider-derived native96 normalization plus explicit semantic masks and deterministic integer translations",
        "providerNative96Authorship": False,
        "humanApproval": {
            "approvedBy": "Mahiro",
            "scope": "tracked asset-production for Haloform identity, explicit semantic masks/motion, and 30px ambient / 36px session / native96 completion footprints",
            "productionApproval": False,
            "note": "This records only the explicit approval supplied for this asset-production handoff."
        },
        "contracts": {
            "ambient": {"sourceFrame": [30, 30]},
            "session": {"sourceFrame": [36, 36]},
            "completion": {"sourceFrame": [96, 96]},
            "stateOrder": list(STATES),
            "frameCounts": {"idle": 3, "working": 3, "attention": 3, "done": 4, "error": 3},
            "alpha": "binary",
            "background": "transparent",
            "working": "approved first 3 loop frames; neutral settle frame from four-frame HTML demo is intentionally omitted"
        },
        "sourceHashes": {
            "providerRaw": SOURCE_HASH,
            "canonical96": CANONICAL_HASH,
            "motionRecipes": sha256(ROOT / "motion/motion-recipes.json"),
            "buildScript": sha256(Path(__file__))
        },
        "review": {
            "path": str(review.relative_to(REPO)),
            "sha256": sha256(review),
            "truth": "Provider-derived native96 normalization plus explicit semantic masks; not provider-native 96px authorship."
        },
        "slots": slots
    }
    manifest_path = RUNTIME / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"built {len(slots)} strips and {manifest_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--import-job", type=Path, help="one-time migration from the approved ignored job")
    args = parser.parse_args()
    if args.import_job:
        import_job(args.import_job)
    build()


if __name__ == "__main__":
    main()
