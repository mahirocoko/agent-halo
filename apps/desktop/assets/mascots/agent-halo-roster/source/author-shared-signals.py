#!/usr/bin/python3
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
REPO = next(parent for parent in ROOT.parents if (parent / ".git").exists())
RUNTIME = REPO / "apps/desktop/public/mascots/agent-halo-roster/signals"

PALETTE = {
    ".": (0, 0, 0, 0),
    "D": (18, 63, 90, 255),
    "B": (85, 199, 232, 255),
    "W": (229, 250, 255, 255),
}

# Human-approved Candidate C signal grids. Frame 0 contains the complete static
# glyph; frame 1 changes only one restrained accent while preserving meaning.
GLYPHS = {'thinking-model': (('..B...', '..W...', 'BWWW.B', '..W...', '..B...', '.....B'),
                    ('..B...', '..W...', 'BWWW..', '..W...', '..B.B.', '......')),
 'shell-tool-skill': (('.DDDDD', '.D...D', '.DW..D', '.D.WBD', '.DDDDD', '......'),
                      ('.DDDDD', '.D...D', '.DW..D', '.D.W.D', '.DDDDD', '......')),
 'editing': (('.DDDD.', '.DB.D.', '.DB.DW', '.DB.DW', '.DDDW.', '...W..'),
             ('.DDDD.', '.DB.D.', '.DB.D.', '.DB.DW', '.DDDDW', '....W.')),
 'planning-goal': (('..D...', '..DWWW', '..DBBW', '..DWWW', '..D...', '.DDD..'),
                   ('..D...', '..DWWW', '..DBWW', '..DWWW', '..D...', '.DDD..')),
 'delegating': (('...DD.', '...WD.', '...B..', '..BBB.', '.D...D', '.WW.WW'),
                ('...DD.', '...WD.', '...W..', '..BBB.', '.D...D', '.WW.WW')),
 'visual': (('..DD..', '.DWWD.', '.WBWBD', '.DWWD.', '..DD..', '......'),
            ('..DD..', '.DWWD.', '.BWBWD', '.DWWD.', '..DD..', '......')),
 'memory': (('..DDDD', '.DWWWD', '..DDDD', '.DBBBD', '..DDDD', '...D.D'),
            ('..DDDD', '.DBBBD', '..DDDD', '.DWWWD', '..DDDD', '...D.D')),
 'attention-asking': (('..WWD.', '.W..WD', '....WD', '...WD.', '......', '...W..'),
                      ('..WWD.', '.W..WD', '....WD', '...WD.', '......', '...WB.')),
 'done': (('.....W', '....WD', '...WD.', 'W.WD..', '.WD...', '..D...'),
          ('B....W', '....WD', '...WD.', 'W.WD..', '.WD...', '..D...')),
 'error': (('.W...W', '..W.W.', '...D..', '...D..', '..W.W.', '.W...W'),
           ('.B...W', '..W.W.', '...D..', '...D..', '..W.W.', '.W...B'))}


def render(rows: tuple[str, ...]) -> Image.Image:
    image = Image.new("RGBA", (6, 6), PALETTE["."])
    for y, row in enumerate(rows):
        if len(row) != 6:
            raise ValueError(f"Expected a 6-pixel row, received {row!r}")
        for x, value in enumerate(row):
            image.putpixel((x, y), PALETTE[value])
    return image.resize((12, 12), Image.Resampling.NEAREST)


def main() -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    for name, source_frames in GLYPHS.items():
        frames = [render(rows) for rows in source_frames]
        strip = Image.new("RGBA", (24, 12), PALETTE["."])
        for index, frame in enumerate(frames):
            strip.alpha_composite(frame, (index * 12, 0))
        strip.save(RUNTIME / f"{name}.png")


if __name__ == "__main__":
    main()
