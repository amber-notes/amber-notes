#!/usr/bin/env python3
"""Draws the DMG window backgrounds, sized to brand/dmg/layout.json.

    build/dmg-venv/bin/python brand/dmg/make-background.py [warm|white ...]

Writes brand/dmg/<direction>/background.png (1x), background@2x.png and background.tiff (both
reps, what dmgbuild copies into the image).

Each direction declares which label colours it must carry, and the script fails unless every
pixel under both labels holds MIN_CONTRAST against them.

Needs Pillow and numpy: build/dmg-venv/bin/pip install pillow numpy
"""
import json
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
LAYOUT = json.load(open(os.path.join(HERE, "layout.json")))
W, H = LAYOUT["window"]
SS = 4  # supersampling: draw at 4x points, downsample to 2x and 1x
MIN_CONTRAST = 4.0


def rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def bold_arrow(layer, color="#d96a06", share=0.5, stroke=6.0, head=13.0):
    """A short, heavy arrow with round caps and joins, centred in the gap between the icons and
    `share` of its width long."""
    (ax, ay), (bx, _) = LAYOUT["app"], LAYOUT["applications"]
    half = LAYOUT["icon_size"] / 2
    mid, length = (ax + bx) / 2, ((bx - half) - (ax + half)) * share
    x0, x1, y = mid - length / 2, mid + length / 2, ay
    col = tuple(int(v) for v in rgb(color)) + (255,)
    d = ImageDraw.Draw(layer)
    r = stroke / 2

    def seg(p, q):
        d.line([(p[0] * SS, p[1] * SS), (q[0] * SS, q[1] * SS)], fill=col, width=int(round(stroke * SS)))
        for c in (p, q):
            d.ellipse([(c[0] - r) * SS, (c[1] - r) * SS, (c[0] + r) * SS, (c[1] + r) * SS], fill=col)

    tip = (x1, y)
    seg((x0, y), tip)
    k = head / math.sqrt(2)
    seg(tip, (x1 - k, y - k))
    seg(tip, (x1 - k, y + k))


def plain(bg):
    img = np.empty((H * SS, W * SS, 3))
    img[...] = rgb(bg)
    layer = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    bold_arrow(layer)
    return img, layer


def white():
    """Discord-style: white, the two icons and a short bold amber arrow, nothing else."""
    return plain("#ffffff")


def warm():
    """The same on a barely-there warm white."""
    return plain("#fffcf7")


# name: (draw, label colours the picture must carry). Finder draws the labels black over a light
# background picture in dark mode too (checked on macOS 26 with the warm DMG), as Discord's white
# DMG relies on, so a plain light picture only has to carry black labels.
DIRECTIONS = {
    "warm": (warm, ("black",)),
    "white": (white, ("black",)),
}


def label_centre(cy):
    return cy + LAYOUT["icon_size"] / 2 + 12


def lum(a):
    c = a / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return c @ np.array([0.2126, 0.7152, 0.0722])


def check(img, scale):
    """Worst-case contrast of black and white label text over the label areas."""
    L = lum(np.asarray(img, dtype=np.float64))
    worst = []
    for key in ("app", "applications"):
        cx, cy = LAYOUT[key]
        yc = label_centre(cy)
        box = L[int((yc - 8) * scale):int((yc + 8) * scale), int((cx - 44) * scale):int((cx + 44) * scale)]
        worst.append(((box.min() + 0.05) / 0.05, 1.05 / (box.max() + 0.05)))
    return min(w[0] for w in worst), min(w[1] for w in worst)


def render(name):
    draw, labels = DIRECTIONS[name]
    art, arrow_layer = draw()
    base = Image.fromarray(np.clip(art, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    base.alpha_composite(arrow_layer)
    base = base.convert("RGB")
    out = os.path.join(HERE, name)
    os.makedirs(out, exist_ok=True)
    paths = []
    for scale, suffix in ((2, "@2x"), (1, "")):
        im = base.resize((W * scale, H * scale), Image.LANCZOS)
        p = os.path.join(out, f"background{suffix}.png")
        im.save(p, dpi=(72 * scale, 72 * scale), optimize=True)
        paths.append(p)
        black, white = check(im, scale)
        ok = all({"black": black, "white": white}[c] >= MIN_CONTRAST for c in labels)
        print(f"{name} {scale}x: label contrast black {black:.2f}:1, white {white:.2f}:1 {'ok' if ok else 'TOO LOW'}")
        if not ok:
            sys.exit(1)
    subprocess.run(["/usr/bin/tiffutil", "-cathidpicheck", paths[1], paths[0], "-out",
                    os.path.join(out, "background.tiff")], check=True, capture_output=True)


if __name__ == "__main__":
    for n in sys.argv[1:] or DIRECTIONS:
        render(n)
