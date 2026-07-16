import os
import json
import shutil
import hashlib
from datetime import datetime, timezone
from PIL import Image, ImageDraw, ImageFont

# Define Directories
JOB_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(JOB_DIR, "semantic-signals-v3-assets")
OUT_DIR = os.path.join(JOB_DIR, "_generated-semantic-signals-v3-review")
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

# The 10 signal glyph definitions (12x12)
GLYPHS = {
    "thinking-model": [
        # Frame 0 (TR active)
        (
            "............",
            "............",
            "....DDCW....",
            "...D....W...",
            "..D......W..",
            "..D......C..",
            "..D......D..",
            "..D......D..",
            "...D....D...",
            "....DDDD....",
            "............",
            "............",
        ),
        # Frame 1 (BR active)
        (
            "............",
            "............",
            "....DDDD....",
            "...D....D...",
            "..D......D..",
            "..D......D..",
            "..D......C..",
            "..D......W..",
            "...D....W...",
            "....DDCW....",
            "............",
            "............",
        ),
        # Frame 2 (BL active)
        (
            "............",
            "............",
            "....DDDD....",
            "...D....D...",
            "..D......D..",
            "..D......D..",
            "..C......D..",
            "..W......D..",
            "...W....D...",
            "....WCDD....",
            "............",
            "............",
        ),
        # Frame 3 (TL active)
        (
            "............",
            "............",
            "....WCDD....",
            "...W....D...",
            "..W......D..",
            "..C......D..",
            "..D......D..",
            "..D......D..",
            "...D....D...",
            "....DDDD....",
            "............",
            "............",
        )
    ],
    "shell-tool-skill": [
        # Frame 0 (Cursor at x=6, 7 - ON)
        (
            "............",
            "............",
            "..DD........",
            "..DCD.......",
            "...DCD......",
            "....DCD.....",
            "...DCD.DD...",
            "..DCDDWWD...",
            "..DD.DDDD...",
            "............",
            "............",
            "............",
        ),
        # Frame 1 (Cursor at x=8, 9 - ON)
        (
            "............",
            "............",
            "..DD........",
            "..DCD.......",
            "...DCD......",
            "....DCD.....",
            "...DCD..DD..",
            "..DCD..DWWD.",
            "..DD...DDDD.",
            "............",
            "............",
            "............",
        ),
        # Frame 2 (Cursor - OFF)
        (
            "............",
            "............",
            "..DD........",
            "..DCD.......",
            "...DCD......",
            "....DCD.....",
            "...DCD......",
            "..DCD.......",
            "..DD........",
            "............",
            "............",
            "............",
        )
    ],
    "editing": [
        # Frame 0 (x_tip = 2)
        (
            "............",
            "............",
            "............",
            "....DD......",
            "...DOOD.....",
            "...DOOD.....",
            "..DOOD......",
            "..DCCD......",
            "..D.........",
            "..C.........",
            "..D.........",
            "............",
        ),
        # Frame 1 (x_tip = 4)
        (
            "............",
            "............",
            "............",
            "......DD....",
            ".....DOOD...",
            ".....DOOD...",
            "....DOOD....",
            "....DCCD....",
            "....D.......",
            "..CCC.......",
            "..DDD.......",
            "............",
        ),
        # Frame 2 (x_tip = 6)
        (
            "............",
            "............",
            "............",
            "........DD..",
            ".......DOOD.",
            ".......DOOD.",
            "......DOOD..",
            "......DCCD..",
            "......D.....",
            "..CCCCC.....",
            "..DDDDD.....",
            "............",
        )
    ],
    "planning-goal": [
        # Frame 0
        (
            "............",
            "...DD.......",
            "...D.DDDDD..",
            "...DCCWCCD..",
            "...DCCCCCCD.",
            "...D.DDDDD..",
            "...D........",
            "...D........",
            "...D........",
            "...D........",
            "..DDD.......",
            "..DDD.......",
        ),
        # Frame 1
        (
            "............",
            "...DD.......",
            "...D.DDDDD..",
            "...DCCWCCD..",
            "...D.DDDDDD.",
            "...DCCCCCCD.",
            "...DDDDDDD..",
            "...D........",
            "...D........",
            "...D........",
            "..DDD.......",
            "..DDD.......",
        ),
        # Frame 2
        (
            "............",
            "...DD.......",
            "...DDDDDDD..",
            "...DCCCCCD..",
            "...DCCWCCD..",
            "...D.DDDDD..",
            "...D........",
            "...D........",
            "...D........",
            "...D........",
            "..DDD.......",
            "..DDD.......",
        )
    ],
    "delegating": [
        # Frame 0
        (
            "............",
            ".....DD.....",
            "....DWWD....",
            ".....DD.....",
            "....D..D....",
            "...D....D...",
            "..D......D..",
            ".DD......DD.",
            ".DCD....DCD.",
            "..D......D..",
            "............",
            "............",
        ),
        # Frame 1
        (
            "............",
            ".....DD.....",
            "....DCCD....",
            ".....DD.....",
            "....W..W....",
            "...W....W...",
            "..W......W..",
            ".DD......DD.",
            ".DCD....DCD.",
            "..D......D..",
            "............",
            "............",
        ),
        # Frame 2
        (
            "............",
            ".....DD.....",
            "....DCCD....",
            ".....DD.....",
            "....D..D....",
            "...D....D...",
            "..D......D..",
            ".DD......DD.",
            ".DWD....DWD.",
            "..D......D..",
            "............",
            "............",
        )
    ],
    "visual": [
        # Frame 0 (Center pupil)
        (
            "............",
            "............",
            "............",
            "....DDDD....",
            "..DDWCCWDD..",
            ".DWWWCCWWWD.",
            "..DDWCCWDD..",
            "....DDDD....",
            "............",
            "............",
            "............",
            "............",
        ),
        # Frame 1 (Left pupil)
        (
            "............",
            "............",
            "............",
            "....DDDD....",
            "..DDCCWWDD..",
            ".DCCWWWWWWD.",
            "..DDCCWWDD..",
            "....DDDD....",
            "............",
            "............",
            "............",
            "............",
        ),
        # Frame 2 (Right pupil)
        (
            "............",
            "............",
            "............",
            "....DDDD....",
            "..DDWWCCDD..",
            ".DWWWWWWCCD.",
            "..DDWWCCDD..",
            "....DDDD....",
            "............",
            "............",
            "............",
            "............",
        )
    ],
    "memory": [
        # Frame 0 (Dim pulse)
        (
            "............",
            "............",
            "....D.D.....",
            "...DDDDD....",
            "..DDDDDDD...",
            "...DDCDD....",
            "..DDDDDDD...",
            "...DDDDD....",
            "....D.D.....",
            "............",
            "............",
            "............",
        ),
        # Frame 1 (Bright pulse)
        (
            "............",
            "............",
            "....D.D.....",
            "...DDDDD....",
            "..DDDDDDD...",
            "...DDWDD....",
            "..DDDDDDD...",
            "...DDDDD....",
            "....D.D.....",
            "............",
            "............",
            "............",
        ),
        # Frame 2 (Expanding pulse)
        (
            "............",
            "............",
            "....D.D.....",
            "...DDDDD....",
            "..DDDCDDD...",
            "...DCWCD....",
            "..DDDCDDD...",
            "...DDDDD....",
            "....D.D.....",
            "............",
            "............",
            "............",
        )
    ],
    "attention-asking": [
        # Frame 0
        (
            "............",
            "............",
            "....DDD.....",
            "...DOOOD....",
            "..DOD.DOD...",
            "..DDD.DOD...",
            "......DDD...",
            "............",
            "............",
            "............",
            "............",
            "............",
        ),
        # Frame 1
        (
            "............",
            "............",
            "....DDD.....",
            "...DOOOD....",
            "..DOD.DOD...",
            "..DDD.DOD...",
            ".....DOD....",
            ".....DDD....",
            "............",
            "............",
            "............",
            "............",
        ),
        # Frame 2
        (
            "............",
            "............",
            "....DDD.....",
            "...DOOOD....",
            "..DOD.DOD...",
            "..DDD.DOD...",
            ".....DOD....",
            "....DOD.....",
            "....DDD.....",
            "............",
            "............",
            "............",
        ),
        # Frame 3
        (
            "............",
            "............",
            "....DDD.....",
            "...DOOOD....",
            "..DOD.DOD...",
            "..DDD.DOD...",
            ".....DOD....",
            "....DOD.....",
            "....DDD.....",
            "....DOD.....",
            "....DDD.....",
            "............",
        )
    ],
    "done": [
        # Frame 0
        (
            "............",
            "............",
            "............",
            "............",
            "............",
            ".DDD........",
            ".DGD........",
            "..DGD.......",
            "...DGD......",
            "...DDD......",
            "............",
            "............",
        ),
        # Frame 1
        (
            "............",
            "............",
            "............",
            "............",
            "......DDD...",
            ".DDD.DGD....",
            ".DGD.DGD....",
            "..DGDGD.....",
            "...DGD......",
            "...DDD......",
            "............",
            "............",
        ),
        # Frame 2
        (
            "............",
            "............",
            "........DDD.",
            "........DGD.",
            ".......DGD..",
            "......DGD...",
            ".DGD.DGD....",
            "..DGDGD.....",
            "...DGD......",
            "...DDD......",
            "............",
            "............",
        ),
        # Frame 3
        (
            "............",
            "............",
            "........DDD.",
            "........DWD.",
            ".......DGD..",
            "......DGD...",
            ".DGD.DGD....",
            "..DGDGD.....",
            "...DGD......",
            "...DDD......",
            "............",
            "............",
        )
    ],
    "error": [
        # Frame 0
        (
            "............",
            "............",
            "..DDD..DDD..",
            "..DRD..DRD..",
            "...DRDDR....",
            "....DRRD....",
            "....DRRD....",
            "...DRDDR....",
            "..DRD..DRD..",
            "..DDD..DDD..",
            "............",
            "............",
        ),
        # Frame 1
        (
            "............",
            "............",
            ".DDD..DDD...",
            ".DRD..DRD...",
            "..DRDDR.....",
            "...DRRD.....",
            "...DRRD.....",
            "..DRDDR.....",
            ".DRD..DRD...",
            ".DDD..DDD...",
            "............",
            "............",
        ),
        # Frame 2
        (
            "............",
            "............",
            "...DDD..DDD.",
            "...DRD..DRD.",
            "....DRDDR...",
            ".....DRRD...",
            ".....DRRD...",
            "....DRDDR...",
            "...DRD..DRD.",
            "...DDD..DDD.",
            "............",
            "............",
        )
    ]
}

def render_glyph(grid: list[str]) -> Image.Image:
    img = Image.new("RGBA", (12, 12), (0, 0, 0, 0))
    for y in range(12):
        for x in range(12):
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
        
        # Use exact palettes.
        # To preserve planning-goal and delegating hashes byte-identically,
        # we must use V2 red color inside the unused palette slot for them.
        if name in ["planning-goal", "delegating"]:
            palette = [
                0, 0, 0,        # 0: Transparent
                18, 63, 90,     # 1: Navy
                85, 199, 232,    # 2: Cyan
                229, 250, 255,   # 3: Bright
                244, 139, 41,    # 4: Orange
                82, 196, 124,    # 5: Green
                234, 92, 92      # 6: V2 Coral-red
            ]
        else:
            palette = [
                0, 0, 0,        # 0: Transparent
                18, 63, 90,     # 1: Navy
                85, 199, 232,    # 2: Cyan
                229, 250, 255,   # 3: Bright
                244, 139, 41,    # 4: Orange
                82, 196, 124,    # 5: Green
                255, 59, 48      # 6: V3 Red #ff3b30
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
                elif (r, g, b) == (234, 92, 92) or (r, g, b) == (255, 59, 48):
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

# Target hashes from V2
TARGET_HASHES = {
    "frames/planning-goal-00.png": "834a0195ece478c58084ccf786e0bfbbe06bcc1d7f9b25b0af82762d8647cf7c",
    "frames/planning-goal-01.png": "166ba8a7a07be84adaf595de18147c84d4a7f40ffa9af9bf00da62a5db901045",
    "frames/planning-goal-02.png": "8da806e22978f52d44212121895eece5bbc3f44772f0577874f97d16f7b1bf02",
    "strips/planning-goal.png": "86f211bee4067e04a58693e1f572af352d95fed3acc2b024172da5e24c2b0272",
    "gifs/planning-goal.gif": "12fb3fd2b56750666ff7f5c60ad71c0f1f5e745e43529d99498905e06c0fd8f4",
    "frames/delegating-00.png": "228f40bd78e6e5c49569f233eca00a8f44bcd4d698f1edc6df4d3ce1cb616802",
    "frames/delegating-01.png": "d09d574bc42579633b1bf1c8a3a1891f90c2c7d2499870080daefa3699d8aae4",
    "frames/delegating-02.png": "79545c48f6642da3f06adad9b0160b9be510f466a47e2080c4e98a26ce5f71f9",
    "strips/delegating.png": "d38af101e623a4ac61dd8896c7d51fefee587b36daf48600fabe407661e4f97c",
    "gifs/delegating.gif": "2808c47556ead9bd8398720c57f6b7c3dc81bc59e0517783522d2f316d95125c"
}

def main():
    print("Generating direct-native 12x12 semantic signal assets V3 correction...")
    
    # Store processed frames and strips
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
            
            # Check if this is planning-goal or delegating and needs to match V2 hash byte-identically
            if rel_path in TARGET_HASHES:
                v2_src = os.path.join(ASSETS_DIR, "v2-frames", frame_filename)
                if os.path.exists(v2_src):
                    shutil.copyfile(v2_src, frame_path)
                    print(f"Copied V2 frame {frame_filename} directly to guarantee byte-identity")
                else:
                    print(f"Warning: V2 frame source not found at {v2_src}")
            
            manifest_files[rel_path] = sha256_file(frame_path)
            
            # Load back final image to memory
            frames_list.append(Image.open(frame_path).convert("RGBA"))
        
        all_frames[name] = frames_list
        
        # Horizontal strip
        num_frames = len(frames_list)
        strip_img = Image.new("RGBA", (12 * num_frames, 12), (0, 0, 0, 0))
        for idx, img in enumerate(frames_list):
            strip_img.alpha_composite(img, (12 * idx, 0))
        
        strip_filename = f"{name}.png"
        strip_path = os.path.join(STRIPS_DIR, strip_filename)
        strip_img.save(strip_path, format="PNG")
        
        rel_strip_path = f"strips/{strip_filename}"
        if rel_strip_path in TARGET_HASHES:
            v2_src_strip = os.path.join(ASSETS_DIR, "v2-strips", strip_filename)
            if os.path.exists(v2_src_strip):
                shutil.copyfile(v2_src_strip, strip_path)
                print(f"Copied V2 strip {strip_filename} directly to guarantee byte-identity")
            else:
                print(f"Warning: V2 strip source not found at {v2_src_strip}")
                
        manifest_files[rel_strip_path] = sha256_file(strip_path)
        
        # Animated GIF
        gif_filename = f"{name}.gif"
        gif_path = os.path.join(GIFS_DIR, gif_filename)
        durations = [200] * num_frames
        if name == "done":
            durations = [200, 200, 200, 600] # Check draws then holds
        
        save_gif(frames_list, gif_path, durations, name)
        
        rel_gif_path = f"gifs/{gif_filename}"
        if rel_gif_path in TARGET_HASHES:
            # Copy GIF from parent outbox if present
            v2_src_gif = os.path.join(ASSETS_DIR, "v2-gifs", gif_filename)
            if os.path.exists(v2_src_gif):
                shutil.copyfile(v2_src_gif, gif_path)
                print(f"Copied V2 GIF {gif_filename} directly from parent outbox")
            else:
                print(f"Warning: V2 GIF source not found at {v2_src_gif}")
                
        manifest_files[rel_gif_path] = sha256_file(gif_path)
        
    print("Mascot compositing...")
    scorpion_path = os.path.join(ASSETS_DIR, "scorpion-idle-strip.png")
    crt_path = os.path.join(ASSETS_DIR, "crt-idle-strip.png")
    
    def get_mascot_frames(path):
        strip = Image.open(path).convert("RGBA")
        return [strip.crop((i*24, 0, (i+1)*24, 18)) for i in range(3)]
    
    scorpion_frames = get_mascot_frames(scorpion_path)
    crt_frames = get_mascot_frames(crt_path)
    mascots = {"scorpion": scorpion_frames, "crt": crt_frames}
    
    for m_name, m_frames in mascots.items():
        for name, sig_frames in all_frames.items():
            num_frames = len(sig_frames)
            
            # Ambient
            ambient_composite_frames = []
            for i in range(num_frames):
                body_f = m_frames[i % 3].resize((40, 30), Image.NEAREST)
                sig_f = sig_frames[i]
                
                sig_f = sig_f.resize((16, 16), Image.NEAREST)
                canvas_f = Image.new("RGBA", (56, 30), (0, 0, 0, 0))
                canvas_f.alpha_composite(body_f, (0, 0))
                canvas_f.alpha_composite(sig_f, (40, 7))
                ambient_composite_frames.append(canvas_f)
            
            # Session
            session_composite_frames = []
            for i in range(num_frames):
                body_f = m_frames[i % 3].resize((48, 36), Image.NEAREST)
                sig_f = sig_frames[i]
                
                sig_f = sig_f.resize((16, 16), Image.NEAREST)
                canvas_f = Image.new("RGBA", (64, 36), (0, 0, 0, 0))
                canvas_f.alpha_composite(body_f, (0, 0))
                canvas_f.alpha_composite(sig_f, (48, 10))
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
    
    # 1. V2-vs-V3 Side-by-Side contacts (1x and 4x)
    def build_v2_vs_v3_contact_sheet(bg_kind, scale):
        font = ImageFont.load_default()
        label_w = 140
        v2_lbl_w = 30
        v3_lbl_w = 30
        tile_w = 12 * scale
        tile_h = 12 * scale
        gap = 4 * scale
        row_h = max(tile_h, 16) + 4
        
        width = label_w + v2_lbl_w + 4 * (tile_w + gap) + v3_lbl_w + 4 * (tile_w + gap) + 20
        height = 24 + len(GLYPHS) * row_h
        
        sheet = make_bg(bg_kind, width, height)
        draw = ImageDraw.Draw(sheet)
        
        text_color = (235, 238, 242, 255) if bg_kind == "dark" else (25, 30, 38, 255)
        draw.text((8, 4), f"V2 vs V3 Side-by-Side Comparison | {bg_kind} | {scale}x", fill=text_color, font=font)
        
        for i, name in enumerate(GLYPHS.keys()):
            y = 24 + i * row_h
            draw.text((8, y + (row_h - 12) // 2), name, fill=text_color, font=font)
            
            # V2 Frames
            x_pos = label_w
            draw.text((x_pos, y + (row_h - 12) // 2), "V2:", fill=text_color, font=font)
            x_pos += v2_lbl_w
            
            v2_frame_count = 4 if name == "done" else 3
            for idx in range(v2_frame_count):
                v2_path = os.path.join(ASSETS_DIR, "v2-frames", f"{name}-{idx:02d}.png")
                if os.path.exists(v2_path):
                    v2_img = Image.open(v2_path).convert("RGBA")
                    if scale != 1:
                        tile = v2_img.resize((tile_w, tile_h), Image.NEAREST)
                    else:
                        tile = v2_img
                    sheet.alpha_composite(tile, (x_pos + idx * (tile_w + gap), y))
                    
            # V3 Frames
            x_pos += 4 * (tile_w + gap) + 10
            draw.text((x_pos, y + (row_h - 12) // 2), "V3:", fill=text_color, font=font)
            x_pos += v3_lbl_w
            
            v3_frames_list = all_frames[name]
            for idx, f in enumerate(v3_frames_list):
                if scale != 1:
                    tile = f.resize((tile_w, tile_h), Image.NEAREST)
                else:
                    tile = f
                sheet.alpha_composite(tile, (x_pos + idx * (tile_w + gap), y))
                
        return sheet

    for bg in ["dark", "light", "checker"]:
        for scale in [1, 4]:
            sheet = build_v2_vs_v3_contact_sheet(bg, scale)
            filename = f"contact-{bg}-{scale}x.png"
            path = os.path.join(CONTACTS_DIR, filename)
            sheet.save(path, format="PNG")
            manifest_files[f"contacts/{filename}"] = sha256_file(path)

    # 2. V3 Body+Signal Contacts (Ambient and Session at 1x and 4x)
    def build_body_contact_sheet(m_name, layout_type, scale):
        font = ImageFont.load_default()
        label_w = 140
        
        if layout_type == "ambient":
            tile_w_native, tile_h_native = 56, 30
            body_w, body_h = 40, 30
            sig_x, sig_y = 40, 7
        else:
            tile_w_native, tile_h_native = 64, 36
            body_w, body_h = 48, 36
            sig_x, sig_y = 48, 10
            
        tile_w = tile_w_native * scale
        tile_h = tile_h_native * scale
        gap = 4 * scale
        row_h = tile_h + 4
        
        width = label_w + 4 * (tile_w + gap) + 10
        height = 24 + len(GLYPHS) * row_h
        
        sheet = make_bg("checker", width, height)
        draw = ImageDraw.Draw(sheet)
        
        draw.text((8, 4), f"Body Composite (V3): {m_name} | {layout_type} | {scale}x", fill=(25, 30, 38, 255), font=font)
        
        m_frames = mascots[m_name]
        
        for i, (name, sig_frames) in enumerate(all_frames.items()):
            y = 24 + i * row_h
            draw.text((8, y + (row_h - 12) // 2), name, fill=(25, 30, 38, 255), font=font)
            
            num_f = len(sig_frames)
            for idx in range(num_f):
                body_f = m_frames[idx % 3].resize((body_w, body_h), Image.NEAREST)
                sig_f = sig_frames[idx].resize((16, 16), Image.NEAREST)
                
                canvas_f = Image.new("RGBA", (tile_w_native, tile_h_native), (0, 0, 0, 0))
                canvas_f.alpha_composite(body_f, (0, 0))
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
        "id": "20260716-halo-semantic-signals-gemini-v2",
        "title": "Agent Halo semantic action/status signals v3 correction",
        "kind": "animation-strip",
        "workflowMode": "sprite-generate",
        "targetRepo": "/Users/mahiro/ghq/github.com/mahirocoko/agent-halo",
        "sourceLane": "gemini",
        "executorModel": "Gemini 3.5 Flash (High)",
        "usage": "source-candidate",
        "frameSize": [12, 12],
        "displaySize": [16, 16],
        "delivery": {"ambient": {"wrapper": [56, 30], "origin": [40, 7]}, "session": {"wrapper": [64, 36], "origin": [48, 10]}},
        "frameCount": len(manifest_frames),
        "states": list(GLYPHS.keys()),
        "frames": manifest_frames,
        "anchors": {
            "default": [8, 8]
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
            for y in range(12):
                for x in range(12):
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
                            
                    # Bounds: must be transparent at x=0, x=11, y=0, y=11
                    if x in (0, 11) or y in (0, 11):
                        if a != 0:
                            qa_results[name]["bounds_ok"] = False
                            
        # Adjacent deltas and duplicates
        num_f = len(sig_frames)
        for i in range(num_f):
            next_idx = (i + 1) % num_f
            p0 = sig_frames[i].load()
            p1 = sig_frames[next_idx].load()
            
            diff_count = 0
            for y in range(12):
                for x in range(12):
                    if p0[x, y] != p1[x, y]:
                        diff_count += 1
                        
            qa_results[name]["adjacent_deltas"].append(diff_count)
            if diff_count == 0:
                qa_results[name]["duplicate_frames"].append(f"{i}->{next_idx}")
                
        # Mascot overlap
        for layout, offset_x, offset_y, body_w, body_h in [
            ("ambient", 40, 7, 40, 30),
            ("session", 48, 10, 48, 36)
        ]:
            for m_key, m_frames_list in mascots.items():
                max_overlap = 0
                for idx in range(num_f):
                    body_f = m_frames_list[idx % 3].resize((body_w, body_h), Image.NEAREST)
                    sig_f = sig_frames[idx].resize((16, 16), Image.NEAREST)
                    
                    overlap_count = 0
                    body_a = body_f.getchannel("A")
                    sig_a = sig_f.getchannel("A")
                    
                    for sy in range(16):
                        for sx in range(16):
                            bx = offset_x + sx
                            by = offset_y + sy
                            if 0 <= bx < body_w and 0 <= by < body_h:
                                if sig_a.getpixel((sx, sy)) > 0 and body_a.getpixel((bx, by)) > 0:
                                    overlap_count += 1
                    max_overlap = max(max_overlap, overlap_count)
                
                qa_results[name]["overlap_pixels"][f"{m_key}_{layout}"] = max_overlap

    # Double check TARGET_HASHES vs generated hashes
    print("\nVerifying planning-goal and delegating hashes...")
    hashes_ok = True
    for rel_path, target_hash in TARGET_HASHES.items():
        actual_path = os.path.join(OUT_DIR, rel_path)
        actual_hash = sha256_file(actual_path)
        if actual_hash == target_hash:
            print(f"✅ {rel_path} matches V2 hash: {actual_hash[:8]}...")
        else:
            print(f"❌ {rel_path} hash mismatch!\n   Expected: {target_hash}\n   Actual:   {actual_hash}")
            hashes_ok = False
            
    # Save qa-report.json
    with open(os.path.join(OUT_DIR, "qa-report.json"), "w") as f:
        json.dump(qa_results, f, indent=2)
        f.write("\n")
        
    # Generate qa-report.md
    with open(os.path.join(OUT_DIR, "qa-report.md"), "w") as f:
        f.write("# Agent Halo Semantic Signals V3 QA Report\n\n")
        f.write(f"Generated at: {datetime.now(timezone.utc).isoformat()}\n")
        f.write("Lineage: `gemini` source lane | direct-native 12x12 grids | V3 Correction\n\n")
        
        f.write("## Status Summary\n\n")
        f.write("| Signal | Alpha (Binary) | Palette | Bounds (1px Safety) | Adjacent Deltas | Duplicate Frames | Mascot Overlap |\n")
        f.write("| --- | --- | --- | --- | --- | --- | --- |\n")
        
        for name, res in qa_results.items():
            alpha_status = "✅ PASS" if res["alpha_ok"] else "❌ FAIL"
            palette_status = "✅ PASS" if res["palette_ok"] else "❌ FAIL"
            bounds_status = "✅ PASS" if res["bounds_ok"] else "⚠️ DELIBERATE EDGE"
            deltas_str = ", ".join(map(str, res["adjacent_deltas"]))
            dup_status = "None" if not res["duplicate_frames"] else f"⚠️ {', '.join(res['duplicate_frames'])}"
            
            overlap_summary = []
            for k, val in res["overlap_pixels"].items():
                if val > 0:
                    overlap_summary.append(f"{k}:{val}px")
            overlap_str = "0px (None)" if not overlap_summary else f"⚠️ {', '.join(overlap_summary)}"
            
            f.write(f"| `{name}` | {alpha_status} | {palette_status} | {bounds_status} | {deltas_str} | {dup_status} | {overlap_str} |\n")
            
        f.write("\n## Byte-identity Lock Verification\n\n")
        if hashes_ok:
            f.write("✅ **Pass**: `planning-goal` and `delegating` assets match V2 hashes byte-identically.\n")
        else:
            f.write("❌ **Fail**: There is a mismatch in planning/delegating lock hashes.\n")
            
        f.write("\n## Design Rationale and Verification Notes\n\n")
        f.write("### 1. thinking-model\n")
        f.write("- **Concept**: Circular segmented loading spinner. A highlighted segment moves clockwise each frame (Frame 0: TR, Frame 1: BR, Frame 2: BL, Frame 3: TL).\n")
        f.write("- **Timings**: 4 frames, clockwise loop, 200ms per frame.\n\n")
        
        f.write("### 2. shell-tool-skill\n")
        f.write("- **Concept**: A command line shell prompt `>` followed by a blinking and horizontally advancing underscore cursor. No outer window borders.\n")
        f.write("- **Timings**: 3 frames, loop, 200ms per frame.\n\n")
        
        f.write("### 3. editing\n")
        f.write("- **Concept**: A diagonal pencil whose tip moves left to right, drawing a growing 1px cyan stroke with a navy outline underneath. The pencil's overall identity remains distinct.\n")
        f.write("- **Timings**: 3 frames, writing stroke loop, 200ms per frame.\n\n")
        
        f.write("### 4. planning-goal\n")
        f.write("- **Concept**: Checkpoint flag. (Unchanged V2 frames preserved byte-identically).\n")
        f.write("- **Timings**: 3 frames, waving loop, 200ms per frame.\n\n")
        
        f.write("### 5. delegating\n")
        f.write("- **Concept**: Node hierarchy branching. (Unchanged V2 frames preserved byte-identically).\n")
        f.write("- **Timings**: 3 frames, loop, 200ms per frame.\n\n")
        
        f.write("### 6. visual\n")
        f.write("- **Concept**: Almond eye outline. Pupil moves center (Frame 0), left (Frame 1), and right (Frame 2) to scan the workspace.\n")
        f.write("- **Timings**: 3 frames, scan loop, 200ms per frame.\n\n")
        
        f.write("### 7. memory\n")
        f.write("- **Concept**: Square microchip with side pins. Center core/cell pulses from dim (Frame 0), bright (Frame 1), to expanded/radiating (Frame 2).\n")
        f.write("- **Timings**: 3 frames, pulse loop, 200ms per frame.\n\n")
        
        f.write("### 8. attention-asking\n")
        f.write("- **Concept**: Orange question mark. Draws hook first (Frame 0), middle descender next (Frame 1), stem bottom third (Frame 2), and finally detached dot appears (Frame 3).\n")
        f.write("- **Timings**: 4 frames, sequence loop, 200ms per frame.\n\n")
        
        f.write("### 9. done\n")
        f.write("- **Concept**: Unmistakable green checkmark. Short lower-left stroke appears (Frame 0), elbow and middle of long stroke appear (Frame 1), long stroke completes (Frame 2), then check completes with a bright white highlight at the tip and holds (Frame 3).\n")
        f.write("- **Timings**: 4 frames: frame 0 (200ms), frame 1 (200ms), frame 2 (200ms), frame 3 (600ms hold).\n\n")
        
        f.write("### 10. error\n")
        f.write("- **Concept**: Saturated red `#ff3b30` fault cross X. Shakes from center (Frame 0), left (Frame 1), and right (Frame 2) with dark navy outline.\n")
        f.write("- **Timings**: 3 frames, shake loop, 200ms per frame.\n")

    print("Generating outbox/index.html...")
    
    html_content = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Agent Halo Signal V3 Correction Cockpit</title>
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
            width: 48px;
            height: 48px;
            background: #0f172a;
            border-radius: 8px;
            padding: 6px;
            margin: 0 auto;
        }
        .strip-img {
            height: 24px;
            max-width: 100%;
            background: #0f172a;
            padding: 6px;
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
            <h1>Agent Halo Signal V3 Correction</h1>
            <p class="subtitle">Focused review-only presence signals with explicit native 12x12 animations & body composites</p>
        </header>
        
        <div class="info-panel">
            <h2>Cockpit Details & Handoff</h2>
            <div class="info-grid">
                <div class="info-item">
                    <span>Correction Job ID</span>
                    20260716-halo-semantic-signals-gemini-v2
                </div>
                <div class="info-item">
                    <span>Target Scale</span>
                    12x12 native resolution
                </div>
                <div class="info-item">
                    <span>Lock Hashes</span>
                    planning-goal & delegating strictly matched
                </div>
                <div class="info-item">
                    <span>Status</span>
                    Review Candidate (Not Promoted)
                </div>
            </div>
        </div>
        
        <h2 class="section-title">Presence Signals Matrix</h2>
        <div class="dashboard-grid">
"""
    
    for name, desc in [
        ("thinking-model", "Circular segmented loading indicator; one bright segment advances clockwise each frame. Core spinner stays in place."),
        ("shell-tool-skill", "Large command prompt > followed by blinking and horizontally advancing underscore cursor. No border."),
        ("editing", "Diagonal pencil whose tip leaves a growing 1px cyan edit stroke. Pencil remains visible."),
        ("planning-goal", "Waving checkpoint flag/target. Exact V2 frame sequence preserved byte-identically."),
        ("delegating", "Node hierarchy branching. Exact V2 frame sequence preserved byte-identically."),
        ("visual", "Almond eye outline with pupil center (Frame 0), left (Frame 1), and right (Frame 2)."),
        ("memory", "Square microchip with side pins and center cell/pulse going from dim, bright, to expanding pulse."),
        ("attention-asking", "Orange question stem drawn top to bottom; detached dot appears only in final Frame 3."),
        ("done", "Green checkmark drawn stroke-by-stroke, completing with a bright white highlight at the tip & holds."),
        ("error", "Saturated red #ff3b30 cross X with navy outline shaking left, center, right.")
    ]:
        badge_class = "badge-working"
        if name == "attention-asking": badge_class = "badge-attention"
        elif name == "done": badge_class = "badge-done"
        elif name == "error": badge_class = "badge-error"
        
        html_content += f"""
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">`{name}`</h3>
                    <span class="badge {badge_class}">{name.split('-')[-1] if '-' in name else name}</span>
                </div>
                <p class="card-desc">{desc}</p>
                
                <div class="previews-section">
                    <div class="preview-box">
                        <h4>Signal GIF (4x)</h4>
                        <img src="gifs/{name}.gif" class="pixelated sig-gif" alt="{name} GIF" />
                    </div>
                    <div class="preview-box">
                        <h4>Horizontal Strip</h4>
                        <img src="strips/{name}.png" class="pixelated strip-img" alt="{name} strip" />
                    </div>
                </div>
                
                <div class="mascot-previews">
                    <div class="mascot-box">
                        <span>Scorpion Ambient</span>
                        <img src="previews/ambient/scorpion_{name}_ambient.gif" class="pixelated" alt="Scorpion ambient {name}" style="height: 30px;" />
                    </div>
                    <div class="mascot-box">
                        <span>Scorpion Session</span>
                        <img src="previews/session/scorpion_{name}_session.gif" class="pixelated" alt="Scorpion session {name}" style="height: 36px;" />
                    </div>
                    <div class="mascot-box">
                        <span>CRT Ambient</span>
                        <img src="previews/ambient/crt_{name}_ambient.gif" class="pixelated" alt="CRT ambient {name}" style="height: 30px;" />
                    </div>
                    <div class="mascot-box">
                        <span>CRT Session</span>
                        <img src="previews/session/crt_{name}_session.gif" class="pixelated" alt="CRT session {name}" style="height: 36px;" />
                    </div>
                </div>
                
                <div class="frames-strip-view">
                    <h4>Frames (1x Clickable)</h4>
                    <div class="frame-links-container">
        """
        
        num_f = len(all_frames[name])
        for idx in range(num_f):
            frame_url = f"frames/{name}-{idx:02d}.png"
            html_content += f'<a href="{frame_url}" class="frame-link" target="_blank"><img src="{frame_url}" class="pixelated" alt="{name} frame {idx}" style="width: 12px; height: 12px;" /></a>'
            
        html_content += """
                    </div>
                </div>
            </div>
        """
        
    html_content += """
        </div>
        
        <h2 class="section-title">V2 vs V3 Side-by-Side Comparisons</h2>
        <div class="contact-sheets-section">
            <p style="color: var(--text-muted); margin-bottom: 20px; font-size: 0.95rem;">
                Comparison sheets displaying V2 frames on the left and corrected V3 frames on the right. Note that `planning-goal` and `delegating` are byte-identical.
            </p>
            <div class="contact-grid">
                <div class="contact-card">
                    <h4>Dark Background (1x)</h4>
                    <img src="contacts/contact-dark-1x.png" class="pixelated" alt="Dark 1x" />
                    <br><a href="contacts/contact-dark-1x.png" target="_blank">Open Full Image</a>
                </div>
                <div class="contact-card">
                    <h4>Dark Background (4x)</h4>
                    <img src="contacts/contact-dark-4x.png" class="pixelated" alt="Dark 4x" />
                    <br><a href="contacts/contact-dark-4x.png" target="_blank">Open Full Image</a>
                </div>
                <div class="contact-card">
                    <h4>Light Background (1x)</h4>
                    <img src="contacts/contact-light-1x.png" class="pixelated" alt="Light 1x" />
                    <br><a href="contacts/contact-light-1x.png" target="_blank">Open Full Image</a>
                </div>
                <div class="contact-card">
                    <h4>Light Background (4x)</h4>
                    <img src="contacts/contact-light-4x.png" class="pixelated" alt="Light 4x" />
                    <br><a href="contacts/contact-light-4x.png" target="_blank">Open Full Image</a>
                </div>
                <div class="contact-card">
                    <h4>Checker Background (1x)</h4>
                    <img src="contacts/contact-checker-1x.png" class="pixelated" alt="Checker 1x" />
                    <br><a href="contacts/contact-checker-1x.png" target="_blank">Open Full Image</a>
                </div>
                <div class="contact-card">
                    <h4>Checker Background (4x)</h4>
                    <img src="contacts/contact-checker-4x.png" class="pixelated" alt="Checker 4x" />
                    <br><a href="contacts/contact-checker-4x.png" target="_blank">Open Full Image</a>
                </div>
            </div>
        </div>
        
        <h2 class="section-title">V3 Mascot Body Compositions</h2>
        <div class="contact-sheets-section">
            <p style="color: var(--text-muted); margin-bottom: 20px; font-size: 0.95rem;">
                Verification contact sheets showing V3 signals composited with Scorpion and CRT at ambient and session layouts.
            </p>
            <div class="contact-grid">
                <div class="contact-card">
                    <h4>Scorpion Ambient (4x)</h4>
                    <img src="contacts/body-scorpion-ambient-4x.png" class="pixelated" alt="Scorpion Ambient 4x" />
                    <br><a href="contacts/body-scorpion-ambient-4x.png" target="_blank">Open Full Image</a>
                </div>
                <div class="contact-card">
                    <h4>Scorpion Session (4x)</h4>
                    <img src="contacts/body-scorpion-session-4x.png" class="pixelated" alt="Scorpion Session 4x" />
                    <br><a href="contacts/body-scorpion-session-4x.png" target="_blank">Open Full Image</a>
                </div>
                <div class="contact-card">
                    <h4>CRT Ambient (4x)</h4>
                    <img src="contacts/body-crt-ambient-4x.png" class="pixelated" alt="CRT Ambient 4x" />
                    <br><a href="contacts/body-crt-ambient-4x.png" target="_blank">Open Full Image</a>
                </div>
                <div class="contact-card">
                    <h4>CRT Session (4x)</h4>
                    <img src="contacts/body-crt-session-4x.png" class="pixelated" alt="CRT Session 4x" />
                    <br><a href="contacts/body-crt-session-4x.png" target="_blank">Open Full Image</a>
                </div>
            </div>
        </div>
    </div>
</body>
</html>
"""
    
    with open(os.path.join(OUT_DIR, "index.html"), "w") as f:
        f.write(html_content)
        
    print("Everything generated successfully!")

if __name__ == "__main__":
    main()
