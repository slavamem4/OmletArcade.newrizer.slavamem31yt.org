"""Generates the project's own raster assets. No third-party artwork is used:
every shape is drawn here from the same geometry as the in-app vector mark."""
from PIL import Image, ImageDraw
import math, os

OUT = os.path.dirname(os.path.abspath(__file__))
BG = (11, 13, 16, 255)
SHELL = (246, 241, 231, 255)
AMBER = (255, 197, 61, 255)

def egg_path(w, h):
    """Asymmetric egg: narrower at the top, heavier at the base."""
    pts = []
    steps = 480
    cx, cy = w / 2, h * 0.52
    rx, ry = w * 0.335, h * 0.43
    for i in range(steps + 1):
        t = i / steps * 2 * math.pi
        taper = 1 - 0.22 * math.sin(t)
        pts.append((cx + rx * math.cos(t) * taper, cy - ry * math.sin(t)))
    return pts

def draw_mark(size, margin_ratio=0.12):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = 4
    big = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    s = size * scale
    d.polygon(egg_path(s, s), fill=SHELL)
    cx, cy = s / 2, s * 0.56
    r = s * 0.155
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=AMBER)
    arm, span = s * 0.038, s * 0.095
    d.rectangle([cx - span, cy - arm, cx + span, cy + arm], fill=BG)
    d.rectangle([cx - arm, cy - span, cx + arm, cy + span], fill=BG)
    return big.resize((size, size), Image.LANCZOS)

def rounded_bg(size, radius_ratio=0.22):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=BG)
    return img

def app_icon(size):
    base = rounded_bg(size)
    mark = draw_mark(int(size * 0.74))
    base.alpha_composite(mark, (int(size * 0.13), int(size * 0.13)))
    return base

for s in (512, 192, 144, 96, 72, 48):
    app_icon(s).save(os.path.join(OUT, f"icon-{s}.png"))

draw_mark(1024).save(os.path.join(OUT, "mark-1024.png"))

# Loading animation: three equaliser blocks, the middle one amber.
frames, n = [], 24
W = H = 160
for f in range(n):
    img = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(img)
    bw, gap = W / 7, W / 14
    total = bw * 3 + gap * 2
    x0 = (W - total) / 2
    for i in range(3):
        phase = (f / n * 2 * math.pi) - i * 0.7
        amp = 0.28 + 0.62 * (0.5 + 0.5 * math.sin(phase))
        bh = H * 0.72 * amp
        x = x0 + i * (bw + gap)
        y = (H - bh) / 2
        d.rounded_rectangle([x, y, x + bw, y + bh], radius=int(bw / 3),
                            fill=AMBER if i == 1 else SHELL)
    frames.append(img.convert("P", palette=Image.ADAPTIVE, colors=64))

frames[0].save(os.path.join(OUT, "loading.gif"), save_all=True, append_images=frames[1:],
               duration=50, loop=0, optimize=True, disposal=2)
print("assets written")
