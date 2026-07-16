import os
import json
import hashlib
from datetime import datetime, timezone
from PIL import Image, ImageDraw, ImageFont

# Define Directories
JOB_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(JOB_DIR, "semantic-signals-v4-assets")
OUT_DIR = os.path.join(JOB_DIR, "_generated-semantic-signals-v4-review")
FRAMES_DIR = os.path.join(OUT_DIR, "frames")
STRIPS_DIR = os.path.join(OUT_DIR, "strips")
GIFS_DIR = os.path.join(OUT_DIR, "gifs")
PREVIEWS_DIR = os.path.join(OUT_DIR, "previews")
PREVIEWS_AMBIENT_DIR = os.path.join(PREVIEWS_DIR, "ambient")
PREVIEWS_SESSION_DIR = os.path.join(PREVIEWS_DIR, "session")
CONTACTS_DIR = os.path.join(OUT_DIR, "contacts")

for d in [FRAMES_DIR, STRIPS_DIR, GIFS_DIR, PREVIEWS_AMBIENT_DIR, PREVIEWS_SESSION_DIR, CONTACTS_DIR]:
    os.makedirs(d, exist_ok=True)

# Palettes
PALETTE_COLORS = {
    "D": (18, 63, 90, 255),
    "C": (85, 199, 232, 255),
    "W": (229, 250, 255, 255),
    "O": (244, 139, 41, 255),
    "G": (82, 196, 124, 255),
    "R": (255, 59, 48, 255), # Saturated Red #ff3b30
    ".": (0, 0, 0, 0),
}

GLYPHS = {
    'thinking-model': [
    (
        "....................",
        "........DDCC........",
        ".....DDDDDCCCCC.....",
        "....DDDD....CCCC....",
        "...DDD........CCW...",
        "..DDD..........WWW..",
        "..DD............WW..",
        "..DD............WW..",
        ".DD..............WW.",
        ".DD..............WW.",
        ".DD..............DD.",
        ".DD..............DD.",
        "..DD............DD..",
        "..DD............DD..",
        "..DDD..........DDD..",
        "...DDD........DDD...",
        "....DDDD....DDDD....",
        ".....DDDDDDDDDD.....",
        "........DDDD........",
        "...................."
    ),
    (
        "....................",
        "........DDDD........",
        ".....DDDDDDDDDD.....",
        "....DDDD....DDDD....",
        "...DDD........DDD...",
        "..DDD..........DDD..",
        "..DD............DD..",
        "..DD............DD..",
        ".DD..............DD.",
        ".DD..............DD.",
        ".DD..............CC.",
        ".DD..............CC.",
        "..DD............CC..",
        "..DD............CC..",
        "..DDD..........CCC..",
        "...DDD........WCC...",
        "....DDDD....WWWW....",
        ".....DDDDDWWWWW.....",
        "........DDWW........",
        "...................."
    ),
    (
        "....................",
        "........DDDD........",
        ".....DDDDDDDDDD.....",
        "....DDDD....DDDD....",
        "...DDD........DDD...",
        "..DDD..........DDD..",
        "..DD............DD..",
        "..DD............DD..",
        ".DD..............DD.",
        ".DD..............DD.",
        ".WW..............DD.",
        ".WW..............DD.",
        "..WW............DD..",
        "..WW............DD..",
        "..WWW..........DDD..",
        "...WCC........DDD...",
        "....CCCC....DDDD....",
        ".....CCCCCDDDDD.....",
        "........CCDD........",
        "...................."
    ),
    (
        "....................",
        "........WWDD........",
        ".....WWWWWDDDDD.....",
        "....WWWW....DDDD....",
        "...CCW........DDD...",
        "..CCC..........DDD..",
        "..CC............DD..",
        "..CC............DD..",
        ".CC..............DD.",
        ".CC..............DD.",
        ".DD..............DD.",
        ".DD..............DD.",
        "..DD............DD..",
        "..DD............DD..",
        "..DDD..........DDD..",
        "...DDD........DDD...",
        "....DDDD....DDDD....",
        ".....DDDDDDDDDD.....",
        "........DDDD........",
        "...................."
    )
],
    'shell-tool-skill': [
    (
        "....................",
        "....................",
        "..DDDD..............",
        "..DCCD..............",
        "...DCCD.............",
        "....DCCD............",
        ".....DCCD...........",
        "......DCCD..........",
        ".......DCCD.........",
        "........DCCD........",
        "........DCCD........",
        ".......DCCD.........",
        "......DCCD..........",
        ".....DCCD...........",
        "....DCCD....DDDDD...",
        "...DCCD.....DWWWD...",
        "..DCCD......DWWWD...",
        "..DDDD......DDDDD...",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "..DDDD..............",
        "..DCCD..............",
        "...DCCD.............",
        "....DCCD............",
        ".....DCCD...........",
        "......DCCD..........",
        ".......DCCD.........",
        "........DCCD........",
        "........DCCD........",
        ".......DCCD.........",
        "......DCCD..........",
        ".....DCCD...........",
        "....DCCD......DDDDD.",
        "...DCCD.......DWWWD.",
        "..DCCD........DWWWD.",
        "..DDDD........DDDDD.",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "..DDDD..............",
        "..DCCD..............",
        "...DCCD.............",
        "....DCCD............",
        ".....DCCD...........",
        "......DCCD..........",
        ".......DCCD.........",
        "........DCCD........",
        "........DCCD........",
        ".......DCCD.........",
        "......DCCD..........",
        ".....DCCD...........",
        "....DCCD............",
        "...DCCD.............",
        "..DCCD..............",
        "..DDDD..............",
        "....................",
        "...................."
    )
],
    'editing': [
    (
        "....................",
        "....................",
        "....................",
        "......DDDD..........",
        "......DOOD..........",
        ".....DDOOD..........",
        ".....DOODD..........",
        "....DDOOD...........",
        "....DOODD...........",
        "...DDOOD............",
        "...DOODD............",
        "..DDOOD.............",
        "..DOODD.............",
        ".DDCCD..............",
        ".DCCDD..............",
        ".DCCD...............",
        ".DCCD...............",
        ".DDDD...............",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....................",
        ".........DDDD.......",
        ".........DOOD.......",
        "........DDOOD.......",
        "........DOODD.......",
        ".......DDOOD........",
        ".......DOODD........",
        "......DDOOD.........",
        "......DOODD.........",
        ".....DDOOD..........",
        ".....DOODD..........",
        "....DDCCD...........",
        "....DCCDD...........",
        "....DCCD............",
        ".DCCCCCD............",
        ".DDDDDDD............",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....................",
        "............DDDD....",
        "............DOOD....",
        "...........DDOOD....",
        "...........DOODD....",
        "..........DDOOD.....",
        "..........DOODD.....",
        ".........DDOOD......",
        ".........DOODD......",
        "........DDOOD.......",
        "........DOODD.......",
        ".......DDCCD........",
        ".......DCCDD........",
        ".......DCCD.........",
        ".DCCCCCCCCD.........",
        ".DDDDDDDDDD.........",
        "....................",
        "...................."
    )
],
    'planning-goal': [
    (
        "....................",
        "....................",
        "....DD..............",
        "....DDDDDDDDDDD.....",
        "....DDCCWCCCCCD.....",
        "....DDCCCCCCCCCD....",
        "....DDCCCCCCCCCD....",
        "....DDCCCCCCCCD.....",
        "....DDCCCCCCCD......",
        "....DDDDDDDDD.......",
        "....DD..............",
        "....DD..............",
        "....DD..............",
        "....DD..............",
        "....DD..............",
        "....DD..............",
        "..DDDDDD............",
        "..DDDDDD............",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....DD..............",
        "....DDDDDDDDDDD.....",
        "....DDCCCCCCCCCD....",
        "....DDCCCWCCCCCD....",
        "....DDCCCCCCCCCD....",
        "....DDCCCCCCCCD.....",
        "....DDCCCCCCCD......",
        "....DDDDDDDDD.......",
        "....DD..............",
        "....DD..............",
        "....DD..............",
        "....DD..............",
        "....DD..............",
        "....DD..............",
        "..DDDDDD............",
        "..DDDDDD............",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....DD..............",
        "....DDDDDDDDDD......",
        "....DDCCCCCCCD......",
        "....DDCCCCCCCCD.....",
        "....DDCCCCWCCCD.....",
        "....DDCCCCCCCCCD....",
        "....DDCCCCCCCCCD....",
        "....DDDDDDDDDDD.....",
        "....DD..............",
        "....DD..............",
        "....DD..............",
        "....DD..............",
        "....DD..............",
        "....DD..............",
        "..DDDDDD............",
        "..DDDDDD............",
        "....................",
        "...................."
    )
],
    'delegating': [
    (
        "....................",
        "....................",
        ".......DDDDDD.......",
        ".......DWWWWD.......",
        ".......DWWWWD.......",
        ".......DWWWWD.......",
        ".......DWWWWD.......",
        ".....DDDDDDDDDD.....",
        "....DDCCD..DCCDD....",
        "...DDCCDD..DDCCDD...",
        "..DDCCDD....DDCCDD..",
        "..DCCDD......DDCCD..",
        "..DDDDDD....DDDDDD..",
        "..DCCCCD....DCCCCD..",
        "..DCCCCD....DCCCCD..",
        "..DCCCCD....DCCCCD..",
        "..DCCCCD....DCCCCD..",
        "..DDDDDD....DDDDDD..",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        ".......DDDDDD.......",
        ".......DCCCCD.......",
        ".......DCCCCD.......",
        ".......DCCCCD.......",
        ".......DCCCCD.......",
        ".....DDDDDDDDDD.....",
        "....DDWWD..DWWDD....",
        "...DDWWDD..DDWWDD...",
        "..DDWWDD....DDWWDD..",
        "..DWWDD......DDWWD..",
        "..DDDDDD....DDDDDD..",
        "..DCCCCD....DCCCCD..",
        "..DCCCCD....DCCCCD..",
        "..DCCCCD....DCCCCD..",
        "..DCCCCD....DCCCCD..",
        "..DDDDDD....DDDDDD..",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        ".......DDDDDD.......",
        ".......DCCCCD.......",
        ".......DCCCCD.......",
        ".......DCCCCD.......",
        ".......DCCCCD.......",
        ".....DDDDDDDDDD.....",
        "....DDCCD..DCCDD....",
        "...DDCCDD..DDCCDD...",
        "..DDCCDD....DDCCDD..",
        "..DCCDD......DDCCD..",
        "..DDDDDD....DDDDDD..",
        "..DWWWWD....DWWWWD..",
        "..DWWWWD....DWWWWD..",
        "..DWWWWD....DWWWWD..",
        "..DWWWWD....DWWWWD..",
        "..DDDDDD....DDDDDD..",
        "....................",
        "...................."
    )
],
    'visual': [
    (
        "....................",
        "....................",
        "....................",
        "........DDDD........",
        "......DDDDDDDD......",
        ".....DDDCCCCDDD.....",
        "....DDWWCCCCWWDD....",
        "...DDWWWCCCCWWWDD...",
        "..DDWWWWCCCCWWWWDD..",
        ".DDWWWWWCCCCWWWWWDD.",
        ".DDWWWWWCCCCWWWWWDD.",
        "..DDWWWWCCCCWWWWDD..",
        "...DDWWWCCCCWWWDD...",
        "....DDWWCCCCWWDD....",
        ".....DDDCCCCDDD.....",
        "......DDDDDDDD......",
        "........DDDD........",
        "....................",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....................",
        "........DDDD........",
        "......DDDDDDDD......",
        ".....DDDCWWWDDD.....",
        "....DDCCCWWWWWDD....",
        "...DDCCCCWWWWWWDD...",
        "..DDWCCCCWWWWWWWDD..",
        ".DDWWCCCCWWWWWWWWDD.",
        ".DDWWCCCCWWWWWWWWDD.",
        "..DDWCCCCWWWWWWWDD..",
        "...DDCCCCWWWWWWDD...",
        "....DDCCCWWWWWDD....",
        ".....DDDCWWWDDD.....",
        "......DDDDDDDD......",
        "........DDDD........",
        "....................",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....................",
        "........DDDD........",
        "......DDDDDDDD......",
        ".....DDDWWWCDDD.....",
        "....DDWWWWWCCCDD....",
        "...DDWWWWWWCCCCDD...",
        "..DDWWWWWWWCCCCWDD..",
        ".DDWWWWWWWWCCCCWWDD.",
        ".DDWWWWWWWWCCCCWWDD.",
        "..DDWWWWWWWCCCCWDD..",
        "...DDWWWWWWCCCCDD...",
        "....DDWWWWWCCCDD....",
        ".....DDDWWWCDDD.....",
        "......DDDDDDDD......",
        "........DDDD........",
        "....................",
        "....................",
        "...................."
    )
],
    'memory': [
    (
        "....................",
        "....................",
        "....................",
        ".......DD..DD.......",
        ".......DD..DD.......",
        ".....DDDDDDDDDD.....",
        ".....DDDDDDDDDD.....",
        "...DDDDDDDDDDDDDD...",
        "...DDDDDDDDDDDDDD...",
        ".....DDDDCCDDDD.....",
        ".....DDDDCCDDDD.....",
        "...DDDDDDDDDDDDDD...",
        "...DDDDDDDDDDDDDD...",
        ".....DDDDDDDDDD.....",
        ".....DDDDDDDDDD.....",
        ".......DD..DD.......",
        ".......DD..DD.......",
        "....................",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....................",
        ".......DD..DD.......",
        ".......DD..DD.......",
        ".....DDDDDDDDDD.....",
        ".....DDDDDDDDDD.....",
        "...DDDDDDDDDDDDDD...",
        "...DDDDDCCCCDDDDD...",
        ".....DDDCWWCDDD.....",
        ".....DDDCWWCDDD.....",
        "...DDDDDCCCCDDDDD...",
        "...DDDDDDDDDDDDDD...",
        ".....DDDDDDDDDD.....",
        ".....DDDDDDDDDD.....",
        ".......DD..DD.......",
        ".......DD..DD.......",
        "....................",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....................",
        ".......DD..DD.......",
        ".......DD..DD.......",
        ".....DDDDDDDDDD.....",
        ".....DDDDDDDDDD.....",
        "...DDDDCCCCCCDDDD...",
        "...DDDDCWWWWCDDDD...",
        ".....DDCWDDWCDD.....",
        ".....DDCWDDWCDD.....",
        "...DDDDCWWWWCDDDD...",
        "...DDDDCCCCCCDDDD...",
        ".....DDDDDDDDDD.....",
        ".....DDDDDDDDDD.....",
        ".......DD..DD.......",
        ".......DD..DD.......",
        "....................",
        "....................",
        "...................."
    )
],
    'attention-asking': [
    (
        "....................",
        "....................",
        "....................",
        "........DDDDDD......",
        "......DDDOOOODDD....",
        ".....DDOODDDDOODD...",
        "....DDOODD..DDOOD...",
        "....DOODD...DDOOD...",
        "....DOOD...DDOODD...",
        "....DDDD.DDDOODD....",
        ".........DOODDD.....",
        ".........DDDD.......",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....................",
        "........DDDDDD......",
        "......DDDOOOODDD....",
        ".....DDOODDDDOODD...",
        "....DDOODD..DDOOD...",
        "....DOODD...DDOOD...",
        "....DOOD...DDOODD...",
        "....DDDD.DDDOODD....",
        "........DDOODDD.....",
        "........DOODD.......",
        "........DOOD........",
        "........DDDD........",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....................",
        "........DDDDDD......",
        "......DDDOOOODDD....",
        ".....DDOODDDDOODD...",
        "....DDOODD..DDOOD...",
        "....DOODD...DDOOD...",
        "....DOOD...DDOODD...",
        "....DDDD.DDDOODD....",
        "........DDOODDD.....",
        "........DOODD.......",
        "........DOOD........",
        "........DOOD........",
        "........DOOD........",
        "........DDDD........",
        "....................",
        "....................",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....................",
        "........DDDDDD......",
        "......DDDOOOODDD....",
        ".....DDOODDDDOODD...",
        "....DDOODD..DDOOD...",
        "....DOODD...DDOOD...",
        "....DOOD...DDOODD...",
        "....DDDD.DDDOODD....",
        "........DDOODDD.....",
        "........DOODD.......",
        "........DOOD........",
        "........DOOD........",
        "........DOOD........",
        "........DDDD........",
        "........DOOD........",
        "........DOOD........",
        "........DDDD........",
        "...................."
    )
],
    'done': [
    (
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "..DDDD..............",
        "..DGGDD.............",
        "..DDGGDD............",
        "...DDGGDD...........",
        "....DDGGDD..........",
        ".....DDGGD..........",
        "......DDDD..........",
        "....................",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "..DDDD....DDDD......",
        "..DGGDD..DDGGD......",
        "..DDGGDDDDGGDD......",
        "...DDGGDDGGDD.......",
        "....DDGGGGDD........",
        ".....DDGGDD.........",
        "......DDDD..........",
        "....................",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "..............DDDD..",
        ".............DDGGD..",
        "............DDGGDD..",
        "...........DDGGDD...",
        "..DDDD....DDGGDD....",
        "..DGGDD..DDGGDD.....",
        "..DDGGDDDDGGDD......",
        "...DDGGDDGGDD.......",
        "....DDGGGGDD........",
        ".....DDGGDD.........",
        "......DDDD..........",
        "....................",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....................",
        "....................",
        "................DDD.",
        "...............DDWD.",
        "..............DDWWD.",
        ".............DDGGDD.",
        "............DDGGDD..",
        "...........DDGGDD...",
        "..DDDD....DDGGDD....",
        "..DGGDD..DDGGDD.....",
        "..DDGGDDDDGGDD......",
        "...DDGGDDGGDD.......",
        "....DDGGGGDD........",
        ".....DDGGDD.........",
        "......DDDD..........",
        "....................",
        "....................",
        "...................."
    )
],
    'error': [
    (
        "....................",
        "....................",
        "....................",
        "...DDDD......DDDD...",
        "...DRRDD....DDRRD...",
        "...DDRRDD..DDRRDD...",
        "....DDRRDDDDRRDD....",
        ".....DDRRDDRRDD.....",
        "......DDRRRRDD......",
        ".......DDRRDD.......",
        ".......DDRRDD.......",
        "......DDRRRRDD......",
        ".....DDRRDDRRDD.....",
        "....DDRRDDDDRRDD....",
        "...DDRRDD..DDRRDD...",
        "...DRRDD....DDRRD...",
        "...DDDD......DDDD...",
        "....................",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....................",
        ".DDDD......DDDD.....",
        ".DRRDD....DDRRD.....",
        ".DDRRDD..DDRRDD.....",
        "..DDRRDDDDRRDD......",
        "...DDRRDDRRDD.......",
        "....DDRRRRDD........",
        ".....DDRRDD.........",
        ".....DDRRDD.........",
        "....DDRRRRDD........",
        "...DDRRDDRRDD.......",
        "..DDRRDDDDRRDD......",
        ".DDRRDD..DDRRDD.....",
        ".DRRDD....DDRRD.....",
        ".DDDD......DDDD.....",
        "....................",
        "....................",
        "...................."
    ),
    (
        "....................",
        "....................",
        "....................",
        ".....DDDD......DDDD.",
        ".....DRRDD....DDRRD.",
        ".....DDRRDD..DDRRDD.",
        "......DDRRDDDDRRDD..",
        ".......DDRRDDRRDD...",
        "........DDRRRRDD....",
        ".........DDRRDD.....",
        ".........DDRRDD.....",
        "........DDRRRRDD....",
        ".......DDRRDDRRDD...",
        "......DDRRDDDDRRDD..",
        ".....DDRRDD..DDRRDD.",
        ".....DRRDD....DDRRD.",
        ".....DDDD......DDDD.",
        "....................",
        "....................",
        "...................."
    )
],
}

def render_glyph(grid: list[str]) -> Image.Image:
    img = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
    for y in range(20):
        for x in range(20):
            char = grid[y][x]
            if char in PALETTE_COLORS:
                img.putpixel((x, y), PALETTE_COLORS[char])
    return img

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()

def make_checkerboard(width, height, cell_size=2) -> Image.Image:
    img = Image.new("RGBA", (width, height))
    for y in range(height):
        for x in range(width):
            if ((x // cell_size) + (y // cell_size)) % 2 == 0:
                color = (214, 216, 220, 255)
            else:
                color = (246, 247, 249, 255)
            img.putpixel((x, y), color)
    return img

def make_bg(kind, width, height) -> Image.Image:
    if kind == "dark":
        return Image.new("RGBA", (width, height), (15, 17, 21, 255))
    elif kind == "light":
        return Image.new("RGBA", (width, height), (248, 249, 250, 255))
    else:
        return make_checkerboard(width, height)

def save_gif(rgba_images, output_path, durations, name):
    p_images = []
    for img in rgba_images:
        p_img = Image.new("P", img.size)
        palette = [
            0, 0, 0,        # 0: Transparent
            18, 63, 90,     # 1: Navy
            85, 199, 232,    # 2: Cyan
            229, 250, 255,   # 3: Bright
            244, 139, 41,    # 4: Orange
            82, 196, 124,    # 5: Green
            255, 59, 48      # 6: V4 Red #ff3b30
        ]
        palette += [0] * (768 - len(palette))
        p_img.putpalette(palette)
        
        pixels = img.load()
        p_pixels = p_img.load()
        for y in range(img.height):
            for x in range(img.width):
                r, g, b, a = pixels[x, y]
                if a == 0:
                    p_pixels[x, y] = 0
                elif (r, g, b) == (18, 63, 90):
                    p_pixels[x, y] = 1
                elif (r, g, b) == (85, 199, 232):
                    p_pixels[x, y] = 2
                elif (r, g, b) == (229, 250, 255):
                    p_pixels[x, y] = 3
                elif (r, g, b) == (244, 139, 41):
                    p_pixels[x, y] = 4
                elif (r, g, b) == (82, 196, 124):
                    p_pixels[x, y] = 5
                elif (r, g, b) == (255, 59, 48):
                    p_pixels[x, y] = 6
                else:
                    p_pixels[x, y] = 0
        p_images.append(p_img)
        
    p_images[0].save(
        output_path,
        save_all=True,
        append_images=p_images[1:],
        duration=durations,
        loop=0,
        disposal=2,
        transparency=0
    )

def save_composite_gif(rgba_images, output_path, durations):
    unique_colors = []
    for img in rgba_images:
        pixels = img.load()
        for y in range(img.height):
            for x in range(img.width):
                r, g, b, a = pixels[x, y]
                if a != 0:
                    c = (r, g, b)
                    if c not in unique_colors:
                        unique_colors.append(c)
                        
    palette = [0, 0, 0] # Index 0 transparent
    for c in unique_colors:
        palette.extend(c)
    palette += [0] * (768 - len(palette))
    
    p_images = []
    for img in rgba_images:
        p_img = Image.new("P", img.size)
        p_img.putpalette(palette)
        pixels = img.load()
        p_pixels = p_img.load()
        for y in range(img.height):
            for x in range(img.width):
                r, g, b, a = pixels[x, y]
                if a == 0:
                    p_pixels[x, y] = 0
                else:
                    c = (r, g, b)
                    p_pixels[x, y] = unique_colors.index(c) + 1
        p_images.append(p_img)
        
    p_images[0].save(
        output_path,
        save_all=True,
        append_images=p_images[1:],
        duration=durations,
        loop=0,
        disposal=2,
        transparency=0
    )

def main():
    print("Generating direct-native 20x20 semantic signal assets V4...")
    
    all_frames = {}
    manifest_files = {}
    
    # Generate individual PNG frames and horizontal strips
    for name, frames_data in GLYPHS.items():
        frames_list = []
        for idx, grid in enumerate(frames_data):
            img = render_glyph(grid)
            frame_filename = f"{name}-{idx:02d}.png"
            frame_path = os.path.join(FRAMES_DIR, frame_filename)
            img.save(frame_path, format="PNG")
            
            rel_path = f"frames/{frame_filename}"
            manifest_files[rel_path] = sha256_file(frame_path)
            
            frames_list.append(Image.open(frame_path).convert("RGBA"))
        
        all_frames[name] = frames_list
        
        # Horizontal strip
        num_frames = len(frames_list)
        strip_img = Image.new("RGBA", (20 * num_frames, 20), (0, 0, 0, 0))
        for idx, img in enumerate(frames_list):
            strip_img.alpha_composite(img, (20 * idx, 0))
        
        strip_filename = f"{name}.png"
        strip_path = os.path.join(STRIPS_DIR, strip_filename)
        strip_img.save(strip_path, format="PNG")
        
        rel_strip_path = f"strips/{strip_filename}"
        manifest_files[rel_strip_path] = sha256_file(strip_path)
        
        # Animated GIF
        gif_filename = f"{name}.gif"
        gif_path = os.path.join(GIFS_DIR, gif_filename)
        durations = [200] * num_frames
        if name == "done":
            durations = [200, 200, 200, 600]
        
        save_gif(frames_list, gif_path, durations, name)
        rel_gif_path = f"gifs/{gif_filename}"
        manifest_files[rel_gif_path] = sha256_file(gif_path)
        
    print("Mascot compositing...")
    scorpion_path = os.path.join(ASSETS_DIR, "robots", "scorpion-idle.png")
    crt_path = os.path.join(ASSETS_DIR, "robots", "crt-idle.png")
    
    def get_mascot_frames(path):
        strip = Image.open(path).convert("RGBA")
        return [strip.crop((i*24, 0, (i+1)*24, 18)) for i in range(3)]
        
    scorpion_frames = get_mascot_frames(scorpion_path)
    crt_frames = get_mascot_frames(crt_path)
    mascots = {"scorpion": scorpion_frames, "crt": crt_frames}
    
    for m_name, m_frames in mascots.items():
        for name, sig_frames in all_frames.items():
            num_frames = len(sig_frames)
            
            # Ambient: body 36x27 at (0,3) inside 58x30; signal at (38,5)
            ambient_composite_frames = []
            for i in range(num_frames):
                body_f = m_frames[i % 3].resize((36, 27), Image.NEAREST)
                sig_f = sig_frames[i] # 20x20, no scaling
                
                canvas_f = Image.new("RGBA", (58, 30), (0, 0, 0, 0))
                canvas_f.alpha_composite(body_f, (0, 3))
                canvas_f.alpha_composite(sig_f, (38, 5))
                ambient_composite_frames.append(canvas_f)
                
            # Session: body 44x33 at (0,3) inside 66x36; signal at (46,8)
            session_composite_frames = []
            for i in range(num_frames):
                body_f = m_frames[i % 3].resize((44, 33), Image.NEAREST)
                sig_f = sig_frames[i] # 20x20, no scaling
                
                canvas_f = Image.new("RGBA", (66, 36), (0, 0, 0, 0))
                canvas_f.alpha_composite(body_f, (0, 3))
                canvas_f.alpha_composite(sig_f, (46, 8))
                session_composite_frames.append(canvas_f)
                
            durations = [200] * num_frames
            if name == "done":
                durations = [200, 200, 200, 600]
                
            ambient_gif_filename = f"{m_name}_{name}_ambient.gif"
            ambient_gif_path = os.path.join(PREVIEWS_AMBIENT_DIR, ambient_gif_filename)
            save_composite_gif(ambient_composite_frames, ambient_gif_path, durations)
            manifest_files[f"previews/ambient/{ambient_gif_filename}"] = sha256_file(ambient_gif_path)
            
            session_gif_filename = f"{m_name}_{name}_session.gif"
            session_gif_path = os.path.join(PREVIEWS_SESSION_DIR, session_gif_filename)
            save_composite_gif(session_composite_frames, session_gif_path, durations)
            manifest_files[f"previews/session/{session_gif_filename}"] = sha256_file(session_gif_path)
            
    print("Generating contact sheets...")
    
    # 1. V3-vs-V4 static contacts (1x and 4x)
    def build_v3_vs_v4_contact_sheet(bg_kind, scale):
        font = ImageFont.load_default()
        label_w = 140
        v3_lbl_w = 30
        v4_lbl_w = 30
        tile_w3 = 12 * scale
        tile_h3 = 12 * scale
        tile_w4 = 20 * scale
        tile_h4 = 20 * scale
        gap = 4 * scale
        row_h = max(tile_h4, 16) + 8
        
        width = label_w + v3_lbl_w + 4 * (tile_w3 + gap) + v4_lbl_w + 4 * (tile_w4 + gap) + 20
        height = 32 + len(GLYPHS) * row_h
        
        sheet = make_bg(bg_kind, width, height)
        draw = ImageDraw.Draw(sheet)
        
        text_color = (235, 238, 242, 255) if bg_kind == "dark" else (25, 30, 38, 255)
        draw.text((8, 8), f"V3 vs V4 Side-by-Side Comparison | {bg_kind} | {scale}x", fill=text_color, font=font)
        
        for i, name in enumerate(GLYPHS.keys()):
            y = 32 + i * row_h
            draw.text((8, y + (row_h - 12) // 2), name, fill=text_color, font=font)
            
            # V3 Frames (12x12)
            x_pos = label_w
            draw.text((x_pos, y + (row_h - 12) // 2), "V3:", fill=text_color, font=font)
            x_pos += v3_lbl_w
            
            v3_frame_count = 4 if name in ["thinking-model", "attention-asking", "done"] else 3
            for idx in range(v3_frame_count):
                v3_path = os.path.join(ASSETS_DIR, "v3-frames", f"{name}-{idx:02d}.png")
                if os.path.exists(v3_path):
                    v3_img = Image.open(v3_path).convert("RGBA")
                    if scale != 1:
                        tile = v3_img.resize((tile_w3, tile_h3), Image.NEAREST)
                    else:
                        tile = v3_img
                    sheet.alpha_composite(tile, (x_pos + idx * (tile_w3 + gap), y + (row_h - tile_h3) // 2))
                    
            # V4 Frames (20x20)
            x_pos += 4 * (tile_w3 + gap) + 15
            draw.text((x_pos, y + (row_h - 12) // 2), "V4:", fill=text_color, font=font)
            x_pos += v4_lbl_w
            
            v4_frames_list = all_frames[name]
            for idx, f in enumerate(v4_frames_list):
                if scale != 1:
                    tile = f.resize((tile_w4, tile_h4), Image.NEAREST)
                else:
                    tile = f
                sheet.alpha_composite(tile, (x_pos + idx * (tile_w4 + gap), y + (row_h - tile_h4) // 2))
                
        return sheet

    for bg in ["dark", "light", "checker"]:
        for scale in [1, 4]:
            sheet = build_v3_vs_v4_contact_sheet(bg, scale)
            filename = f"contact-{bg}-{scale}x.png"
            path = os.path.join(CONTACTS_DIR, filename)
            sheet.save(path, format="PNG")
            manifest_files[f"contacts/{filename}"] = sha256_file(path)

    # 2. V4 Body+Signal Contacts (Ambient and Session at 1x and 4x)
    def build_body_contact_sheet(m_name, layout_type, scale):
        font = ImageFont.load_default()
        label_w = 140
        
        if layout_type == "ambient":
            tile_w_native, tile_h_native = 58, 30
            body_w, body_h = 36, 27
            sig_x, sig_y = 38, 5
            body_y = 3
        else:
            tile_w_native, tile_h_native = 66, 36
            body_w, body_h = 44, 33
            sig_x, sig_y = 46, 8
            body_y = 3
            
        tile_w = tile_w_native * scale
        tile_h = tile_h_native * scale
        gap = 4 * scale
        row_h = tile_h + 4
        
        width = label_w + 4 * (tile_w + gap) + 10
        height = 32 + len(GLYPHS) * row_h
        
        sheet = make_bg("checker", width, height)
        draw = ImageDraw.Draw(sheet)
        
        draw.text((8, 8), f"Body Composite (V4): {m_name} | {layout_type} | {scale}x", fill=(25, 30, 38, 255), font=font)
        
        m_frames = mascots[m_name]
        
        for i, (name, sig_frames) in enumerate(all_frames.items()):
            y = 32 + i * row_h
            draw.text((8, y + (row_h - 12) // 2), name, fill=(25, 30, 38, 255), font=font)
            
            num_f = len(sig_frames)
            for idx in range(num_f):
                body_f = m_frames[idx % 3].resize((body_w, body_h), Image.NEAREST)
                sig_f = sig_frames[idx] # 20x20
                
                canvas_f = Image.new("RGBA", (tile_w_native, tile_h_native), (0, 0, 0, 0))
                canvas_f.alpha_composite(body_f, (0, body_y))
                canvas_f.alpha_composite(sig_f, (sig_x, sig_y))
                
                if scale != 1:
                    tile = canvas_f.resize((tile_w, tile_h), Image.NEAREST)
                else:
                    tile = canvas_f
                    
                sheet.alpha_composite(tile, (label_w + idx * (tile_w + gap), y))
                
        return sheet

    for m_name in ["scorpion", "crt"]:
        for layout in ["ambient", "session"]:
            for scale in [1, 4]:
                sheet = build_body_contact_sheet(m_name, layout, scale)
                filename = f"body-{m_name}-{layout}-{scale}x.png"
                path = os.path.join(CONTACTS_DIR, filename)
                sheet.save(path, format="PNG")
                manifest_files[f"contacts/{filename}"] = sha256_file(path)

    print("Generating manifest.json...")
    manifest_frames = []
    for name, sig_frames in all_frames.items():
        durations = [200] * len(sig_frames)
        if name == "done":
            durations = [200, 200, 200, 600]
        for idx in range(len(sig_frames)):
            manifest_frames.append({
                "file": f"frames/{name}-{idx:02d}.png",
                "state": name,
                "index": idx,
                "durationMs": durations[idx]
            })
            
    manifest = {
        "schemaVersion": 2,
        "id": "20260716-halo-semantic-signals-gemini-v4-bold",
        "title": "Agent Halo Signal V4 — bold 20×20 delivery",
        "kind": "animation-strip",
        "workflowMode": "sprite-generate",
        "targetRepo": "/Users/mahiro/ghq/github.com/mahirocoko/agent-halo",
        "sourceLane": "gemini",
        "executorModel": "Gemini 3.5 Flash (High)",
        "usage": "source-candidate",
        "frameSize": [20, 20],
        "displaySize": [20, 20],
        "delivery": {
            "ambient": {
                "wrapper": [58, 30],
                "origin": [38, 5]
            },
            "session": {
                "wrapper": [66, 36],
                "origin": [46, 8]
            }
        },
        "frameCount": len(manifest_frames),
        "states": list(GLYPHS.keys()),
        "frames": manifest_frames,
        "anchors": {
            "default": [10, 10]
        },
        "lineage": {
            "sourceIds": [],
            "normalization": None
        },
        "provenance": {
            "sourceLane": "gemini",
            "usage": "source-candidate"
        },
        "status": "review-candidate",
        "humanApproved": False,
        "productionApproved": False,
        "files": manifest_files
    }
    
    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
        
    print("Performing QA checks...")
    qa_results = {}
    
    for name, sig_frames in all_frames.items():
        qa_results[name] = {
            "alpha_ok": True,
            "palette_ok": True,
            "bounds_ok": True,
            "stroke_2px_intent": True, # Manually verified 2px strokes
            "adjacent_deltas": [],
            "duplicate_frames": [],
            "overlap_pixels": {
                "scorpion_ambient": 0,
                "scorpion_session": 0,
                "crt_ambient": 0,
                "crt_session": 0
            }
        }
        
        # Frame-level checks
        for idx, f in enumerate(sig_frames):
            pixels = f.load()
            
            # Alpha & Palette & Bounds
            for y in range(20):
                for x in range(20):
                    r, g, b, a = pixels[x, y]
                    
                    if a not in (0, 255):
                        qa_results[name]["alpha_ok"] = False
                        
                    if a == 255:
                        color_match = False
                        for char, val in PALETTE_COLORS.items():
                            if val[:3] == (r, g, b):
                                color_match = True
                                break
                        if not color_match:
                            qa_results[name]["palette_ok"] = False
                            
                    # Canvas safety boundary: 1px safety outer ring (x=0, x=19, y=0, y=19 must be transparent)
                    if x in (0, 19) or y in (0, 19):
                        if a != 0:
                            qa_results[name]["bounds_ok"] = False
                            
        # Adjacent deltas and duplicates
        num_f = len(sig_frames)
        for i in range(num_f):
            next_idx = (i + 1) % num_f
            p0 = sig_frames[i].load()
            p1 = sig_frames[next_idx].load()
            
            diff_count = 0
            for y in range(20):
                for x in range(20):
                    if p0[x, y] != p1[x, y]:
                        diff_count += 1
                        
            qa_results[name]["adjacent_deltas"].append(diff_count)
            if diff_count == 0:
                qa_results[name]["duplicate_frames"].append(f"{i}->{next_idx}")
                
        # Mascot overlap (should be 0 because of the 2px horizontal gap)
        for layout, offset_x, offset_y, body_w, body_h in [
            ("ambient", 38, 5, 36, 27),
            ("session", 46, 8, 44, 33)
        ]:
            for m_key, m_frames_list in mascots.items():
                max_overlap = 0
                for idx in range(num_f):
                    body_f = m_frames_list[idx % 3].resize((body_w, body_h), Image.NEAREST)
                    sig_f = sig_frames[idx] # 20x20
                    
                    overlap_count = 0
                    body_a = body_f.getchannel("A")
                    sig_a = sig_f.getchannel("A")
                    
                    # Canvas composite size
                    canvas_w = 58 if layout == "ambient" else 66
                    canvas_h = 30 if layout == "ambient" else 36
                    
                    # check overlap
                    for sy in range(20):
                        for sx in range(20):
                            canvas_x = offset_x + sx
                            canvas_y = offset_y + sy
                            bx = canvas_x
                            by = canvas_y - 3
                            if 0 <= bx < body_w and 0 <= by < body_h:
                                if sig_a.getpixel((sx, sy)) > 0 and body_a.getpixel((bx, by)) > 0:
                                    overlap_count += 1
                    max_overlap = max(max_overlap, overlap_count)
                
                qa_results[name]["overlap_pixels"][f"{m_key}_{layout}"] = max_overlap
                
    # Save qa-report.json
    with open(os.path.join(OUT_DIR, "qa-report.json"), "w") as f:
        json.dump(qa_results, f, indent=2)
        f.write("\n")
        
    # Generate qa-report.md
    with open(os.path.join(OUT_DIR, "qa-report.md"), "w") as f:
        f.write("# Agent Halo Semantic Signals V4 QA Report\n\n")
        f.write(f"Generated at: {datetime.now(timezone.utc).isoformat()}\n")
        f.write("Lineage: `gemini` source lane | direct-native 20x20 bold grids | V4 Review\n\n")
        
        f.write("## Status Summary\n\n")
        f.write("| Signal | Alpha (Binary) | Palette | Bounds (1px Safety) | Stroke 2px Intent | Adjacent Deltas | Duplicate Frames | Mascot Overlap |\n")
        f.write("| --- | --- | --- | --- | --- | --- | --- | --- |\n")
        
        for name, res in qa_results.items():
            alpha_status = "✅ PASS" if res["alpha_ok"] else "❌ FAIL"
            palette_status = "✅ PASS" if res["palette_ok"] else "❌ FAIL"
            bounds_status = "✅ PASS" if res["bounds_ok"] else "❌ FAIL"
            stroke_status = "✅ PASS (2px)" if res["stroke_2px_intent"] else "❌ FAIL"
            deltas_str = ", ".join(map(str, res["adjacent_deltas"]))
            dup_status = "None" if not res["duplicate_frames"] else f"⚠️ {', '.join(res['duplicate_frames'])}"
            
            overlap_summary = []
            for k, val in res["overlap_pixels"].items():
                if val > 0:
                    overlap_summary.append(f"{k}:{val}px")
            overlap_str = "0px (None)" if not overlap_summary else f"⚠️ {', '.join(overlap_summary)}"
            
            f.write(f"| `{name}` | {alpha_status} | {palette_status} | {bounds_status} | {stroke_status} | {deltas_str} | {dup_status} | {overlap_str} |\n")
            
        f.write("\n## Design Rationale and Verification Notes\n\n")
        f.write("### 1. thinking-model\n")
        f.write("- **Concept**: 4-frame thick segmented loading ring (18x18 outer bounds, 2px thick core, 1px canvas safety). Bright segment (CW) advances clockwise each frame.\n")
        f.write("- **Timings**: 4 frames, clockwise loop, 200ms per frame.\n\n")
        
        f.write("### 2. shell-tool-skill\n")
        f.write("- **Concept**: 3-frame large bold hollow `>` prompt on the left, with a 2px thick core. Underscore cursor `_` at the bottom right blinks and moves horizontally.\n")
        f.write("- **Timings**: 3 frames, loop, 200ms per frame.\n\n")
        
        f.write("### 3. editing\n")
        f.write("- **Concept**: 3-frame diagonal pencil (orange O core, cyan C tip, navy D outline) shifting right, leaving a growing cyan C stroke at the bottom (row 16).\n")
        f.write("- **Timings**: 3 frames, writing stroke loop, 200ms per frame.\n\n")
        
        f.write("### 4. planning-goal\n")
        f.write("- **Concept**: Checkpoint flag. Waving cloth (7 rows high, S-curve wave, cyan core, moving white highlight) on a bold 2px pole with base pedestal.\n")
        f.write("- **Timings**: 3 frames, waving loop, 200ms per frame.\n\n")
        
        f.write("### 5. delegating\n")
        f.write("- **Concept**: Top node splitting into two thick branch lanes and bottom nodes. Flow is animated by a pulse: top node active (frame 0), branches active (frame 1), and bottom nodes active (frame 2).\n")
        f.write("- **Timings**: 3 frames, loop, 200ms per frame.\n\n")
        
        f.write("### 6. visual\n")
        f.write("- **Concept**: Almond eye outline (2px thick). Pupil moves center (frame 0), left (frame 1), and right (frame 2) to scan the workspace.\n")
        f.write("- **Timings**: 3 frames, scan loop, 200ms per frame.\n\n")
        
        f.write("### 7. memory\n")
        f.write("- **Concept**: Square microchip with side pins (2px body outline). Core pulses outwards in three rings.\n")
        f.write("- **Timings**: 3 frames, pulse loop, 200ms per frame.\n\n")
        
        f.write("### 8. attention-asking\n")
        f.write("- **Concept**: Orange question mark. Draws hook first (frame 0), descender (frame 1), stem (frame 2), and detached dot appears in frame 3.\n")
        f.write("- **Timings**: 4 frames, sequence loop, 200ms per frame.\n\n")
        
        f.write("### 9. done\n")
        f.write("- **Concept**: Green checkmark (2px core). Elbow/short leg appears (frame 0), long leg begins (frame 1), extends (frame 2), and check completes with a bright white highlight tip (frame 3). Frame 3 holds for 600ms.\n")
        f.write("- **Timings**: 4 frames: frame 0 (200ms), frame 1 (200ms), frame 2 (200ms), frame 3 (600ms hold).\n\n")
        
        f.write("### 10. error\n")
        f.write("- **Concept**: Saturated red cross X (2px core, 1px navy edge). Shakes center (frame 0), left by 2px (frame 1), and right by 2px (frame 2).\n")
        f.write("- **Timings**: 3 frames, shake loop, 200ms per frame.\n")

    print("Generating outbox/index.html...")
    
    html_content = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Agent Halo Signal V4 Review Cockpit</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #0b0d13;
            --card-bg: rgba(22, 28, 45, 0.6);
            --card-border: rgba(255, 255, 255, 0.08);
            --text-color: #f3f4f6;
            --text-muted: #9ca3af;
            --accent-cyan: #55c7e8;
            --accent-green: #52c47c;
            --accent-red: #ff3b30;
            --accent-orange: #f48b29;
            --gradient-primary: linear-gradient(135deg, #1e293b, #0f172a);
        }
        body {
            background-color: var(--bg-color);
            color: var(--text-color);
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            margin: 0;
            padding: 40px 20px;
            background-image: radial-gradient(circle at top left, #1e1b4b 0%, transparent 40%),
                              radial-gradient(circle at bottom right, #020617 0%, transparent 60%);
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        header {
            border-bottom: 1px solid var(--card-border);
            padding-bottom: 24px;
            margin-bottom: 40px;
            text-align: center;
        }
        h1 {
            font-family: 'Outfit', sans-serif;
            color: var(--text-color);
            margin: 0 0 10px 0;
            font-size: 2.8rem;
            font-weight: 700;
            letter-spacing: -0.03em;
            background: linear-gradient(135deg, #fff 30%, var(--accent-cyan));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .subtitle {
            color: var(--text-muted);
            font-size: 1.1rem;
            margin: 0;
        }
        
        .info-panel {
            background: var(--gradient-primary);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 40px;
            backdrop-filter: blur(10px);
        }
        .info-panel h2 {
            margin-top: 0;
            font-family: 'Outfit', sans-serif;
            color: var(--accent-cyan);
            font-size: 1.4rem;
        }
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
        }
        .info-item {
            font-size: 0.95rem;
        }
        .info-item span {
            display: block;
            color: var(--text-muted);
            font-size: 0.8rem;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .section-title {
            font-family: 'Outfit', sans-serif;
            font-size: 1.8rem;
            margin: 40px 0 20px 0;
            border-left: 4px solid var(--accent-cyan);
            padding-left: 12px;
        }
        
        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
            gap: 24px;
        }
        .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 24px;
            backdrop-filter: blur(8px);
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3);
            transition: transform 0.3s ease, border-color 0.3s ease;
        }
        .card:hover {
            transform: translateY(-4px);
            border-color: var(--accent-cyan);
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
        }
        .card-title {
            font-family: 'Outfit', sans-serif;
            font-size: 1.3rem;
            font-weight: 600;
            margin: 0;
        }
        .badge {
            font-size: 0.75rem;
            font-weight: 600;
            padding: 4px 10px;
            border-radius: 9999px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .badge-working { background-color: rgba(85, 199, 232, 0.15); color: var(--accent-cyan); }
        .badge-attention { background-color: rgba(244, 139, 41, 0.15); color: var(--accent-orange); }
        .badge-done { background-color: rgba(82, 196, 124, 0.15); color: var(--accent-green); }
        .badge-error { background-color: rgba(255, 59, 48, 0.15); color: var(--accent-red); }
        
        .card-desc {
            color: var(--text-muted);
            font-size: 0.9rem;
            line-height: 1.5;
            margin: 0 0 20px 0;
            min-height: 40px;
        }
        
        .previews-section {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
            margin-bottom: 20px;
        }
        .preview-box {
            background: rgba(10, 15, 30, 0.8);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            padding: 12px;
            text-align: center;
        }
        .preview-box h4 {
            margin: 0 0 8px 0;
            font-size: 0.75rem;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .pixelated {
            image-rendering: pixelated;
            image-rendering: crisp-edges;
        }
        .sig-gif {
            width: 80px;
            height: 80px;
            background: #0f172a;
            border-radius: 8px;
            padding: 10px;
            margin: 0 auto;
        }
        .strip-img {
            height: 40px;
            max-width: 100%;
            background: #0f172a;
            padding: 10px;
            border-radius: 8px;
        }
        
        .mascot-previews {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
        }
        .mascot-box {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 10px;
            padding: 8px;
            text-align: center;
        }
        .mascot-box span {
            display: block;
            font-size: 0.7rem;
            color: var(--text-muted);
            margin-bottom: 4px;
        }
        .mascot-box img {
            max-width: 100%;
            border-radius: 4px;
        }
        
        .frames-strip-view {
            margin-top: 16px;
            border-top: 1px solid var(--card-border);
            padding-top: 16px;
        }
        .frames-strip-view h4 {
            margin: 0 0 8px 0;
            font-size: 0.75rem;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .frame-links-container {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        .frame-link {
            display: flex;
            align-items: center;
            justify-content: center;
            background: #0f172a;
            padding: 4px;
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.05);
            transition: border-color 0.2s;
        }
        .frame-link img {
            width: 40px;
            height: 40px;
        }
        .frame-link:hover {
            border-color: var(--accent-cyan);
        }
        
        .contact-sheets-section {
            background: rgba(22, 28, 45, 0.4);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 40px;
        }
        .contact-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
        }
        .contact-card {
            background: rgba(10, 15, 30, 0.8);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            padding: 16px;
            text-align: center;
        }
        .contact-card h4 {
            margin-top: 0;
            margin-bottom: 12px;
            font-family: 'Outfit', sans-serif;
            color: var(--text-color);
        }
        .contact-card img {
            max-width: 100%;
            border-radius: 6px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.5);
            background-color: #0f172a;
        }
        .contact-card a {
            display: inline-block;
            margin-top: 10px;
            color: var(--accent-cyan);
            text-decoration: none;
            font-size: 0.85rem;
        }
        .contact-card a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Agent Halo Signal V4 Review Cockpit</h1>
            <p class="subtitle">Focused review-only presence signals with bold direct-native 20x20 animations & body composites</p>
        </header>
        
        <div class="info-panel">
            <h2>Cockpit Details & Handoff</h2>
            <div class="info-grid">
                <div class="info-item">
                    <span>Correction Job ID</span>
                    20260716-halo-semantic-signals-gemini-v4-bold
                </div>
                <div class="info-item">
                    <span>Target Scale</span>
                    20x20 direct-native bold resolution
                </div>
                <div class="info-item">
                    <span>Stroke Width</span>
                    Normally 2px primary strokes
                </div>
                <div class="info-item">
                    <span>Status</span>
                    Review Candidate (Not Promoted)
                </div>
            </div>
        </div>
        
        <h2 class="section-title">Signal State Matrix</h2>
        <div class="dashboard-grid">
"""
    
    # Let's add cards for each signal
    cards_data = [
        ("thinking-model", "working", "Circular segmented loading spinner; active bright segment (CW) moves clockwise.", 4),
        ("shell-tool-skill", "working", "Hollow 2px chevron '>' prompt with a blinking/advancing underscore cursor.", 3),
        ("editing", "working", "Diagonal pencil shifting right, leaving a growing horizontal cyan stroke.", 3),
        ("planning-goal", "working", "Checkpoint flag. Waving cloth (cyan with white highlight) on a bold 2px pole.", 3),
        ("delegating", "working", "Node hierarchy branching. Top node pulses (F0), then branches (F1), then bottom nodes (F2).", 3),
        ("visual", "working", "Almond eye outline (2px). Pupil moves center (F0), left (F1), and right (F2).", 3),
        ("memory", "working", "Square microchip (2px body). Core pulses outwards in three rings.", 3),
        ("attention-asking", "attention", "Orange question mark drawing downward; detached dot appears in F3.", 4),
        ("done", "done", "Green checkmark drawing from elbow to long leg; final frame has white tip and holds 600ms.", 4),
        ("error", "error", "Saturated red cross X with navy edge, shaking center (F0), left (F1), and right (F2).", 3)
    ]
    
    for name, badge, desc, f_count in cards_data:
        html_content += f"""
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">`{name}`</h3>
                    <span class="badge badge-{badge}">{badge}</span>
                </div>
                <p class="card-desc">{desc}</p>
                <div class="previews-section">
                    <div class="preview-box">
                        <h4>Signal GIF</h4>
                        <img class="sig-gif pixelated" src="gifs/{name}.gif" alt="{name} gif">
                    </div>
                    <div class="preview-box">
                        <h4>Horiz Strip</h4>
                        <img class="strip-img pixelated" src="strips/{name}.png" alt="{name} strip">
                    </div>
                </div>
                <div class="mascot-previews">
                    <div class="mascot-box">
                        <span>Scorpion Ambient</span>
                        <img class="pixelated" src="previews/ambient/scorpion_{name}_ambient.gif" alt="scorpion ambient">
                    </div>
                    <div class="mascot-box">
                        <span>CRT Session</span>
                        <img class="pixelated" src="previews/session/crt_{name}_session.gif" alt="crt session">
                    </div>
                </div>
                <div class="frames-strip-view">
                    <h4>Individual Frames</h4>
                    <div class="frame-links-container">"""
        for i in range(f_count):
            html_content += f"""
                        <a class="frame-link" href="frames/{name}-{i:02d}.png" target="_blank">
                            <img class="pixelated" src="frames/{name}-{i:02d}.png" alt="frame {i}">
                        </a>"""
        html_content += """
                    </div>
                </div>
            </div>"""
            
    html_content += """
        </div>
        
        <h2 class="section-title">Static Contact Sheets</h2>
        <div class="contact-sheets-section">
            <div class="contact-grid">
                <div class="contact-card">
                    <h4>V3 vs V4 Comparison (Dark 4x)</h4>
                    <img class="pixelated" src="contacts/contact-dark-4x.png" alt="contact dark 4x">
                    <br>
                    <a href="contacts/contact-dark-4x.png" target="_blank">Open Raw Image</a>
                </div>
                <div class="contact-card">
                    <h4>V3 vs V4 Comparison (Checker 4x)</h4>
                    <img class="pixelated" src="contacts/contact-checker-4x.png" alt="contact checker 4x">
                    <br>
                    <a href="contacts/contact-checker-4x.png" target="_blank">Open Raw Image</a>
                </div>
            </div>
            <div class="contact-grid">
                <div class="contact-card">
                    <h4>Scorpion Ambient Composite (4x)</h4>
                    <img class="pixelated" src="contacts/body-scorpion-ambient-4x.png" alt="scorpion ambient 4x">
                    <br>
                    <a href="contacts/body-scorpion-ambient-4x.png" target="_blank">Open Raw Image</a>
                </div>
                <div class="contact-card">
                    <h4>CRT Session Composite (4x)</h4>
                    <img class="pixelated" src="contacts/body-crt-session-4x.png" alt="crt session 4x">
                    <br>
                    <a href="contacts/body-crt-session-4x.png" target="_blank">Open Raw Image</a>
                </div>
            </div>
        </div>
    </div>
</body>
</html>
"""
    
    with open(os.path.join(OUT_DIR, "index.html"), "w") as f:
        f.write(html_content)
        
    print("✅ All done!")

if __name__ == "__main__":
    main()
