#!/usr/bin/env python3
"""Draws the DMG window background: the website's Dune world, sized to brand/dmg/layout.json.

    build/dmg-venv/bin/python brand/dmg/make-background.py [dune|dusk|page ...]

Writes brand/dmg/<direction>/background.png (1x), background@2x.png and background.tiff (both
reps, what dmgbuild copies into the image), and brand/dmg/VolumeIcon.icns from the app icon.

Finder draws icon labels black in light mode and white in dark mode on top of this picture, so
the labels sit on a mid-tone band (relative luminance ~0.18), and the script fails unless every
pixel under both labels holds MIN_CONTRAST against black and against white.

Needs Pillow and numpy: build/dmg-venv/bin/pip install pillow numpy
"""
import json
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
LAYOUT = json.load(open(os.path.join(HERE, "layout.json")))
W, H = LAYOUT["window"]
SS = 4  # supersampling: draw at 4x points, downsample to 2x and 1x
MIN_CONTRAST = 4.0


def rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


YS, XS = np.mgrid[0:H * SS, 0:W * SS].astype(np.float64) / SS  # pixel centres in points


def vgrad(stops):
    """Vertical gradient from [(y_pt, "#hex"), ...]."""
    ys = [s[0] for s in stops]
    out = np.empty((H * SS, W * SS, 3))
    for c in range(3):
        out[..., c] = np.interp(YS, ys, [rgb(s[1])[c] for s in stops])
    return out


def hgrad(stops):
    xs = [s[0] for s in stops]
    out = np.empty((H * SS, W * SS, 3))
    for c in range(3):
        out[..., c] = np.interp(XS, xs, [rgb(s[1])[c] for s in stops])
    return out


def over(img, color, alpha):
    a = alpha[..., None] if alpha.ndim == 2 else alpha
    return img * (1 - a) + color * a


def soften(mask, blur_pt):
    if blur_pt <= 0:
        return mask
    m = Image.fromarray((mask * 255).astype(np.uint8))
    m = m.filter(ImageFilter.GaussianBlur(blur_pt * SS))
    return np.asarray(m, dtype=np.float64) / 255


def hill(crest, blur_pt):
    """Alpha of the ground below crest(x) (points), with a soft edge."""
    return soften((YS > crest(XS)).astype(np.float64), blur_pt)


def glow(cx, cy, r, strength):
    d = np.hypot(XS - cx, YS - cy) / r
    return np.clip(1 - d, 0, 1) ** 2 * strength


def wave(base, *terms):
    """crest(x) = base + sum(amp * sin(2π·cycles·x/W + phase))."""
    return lambda x: base + sum(a * np.sin(2 * math.pi * k * x / W + p) for a, k, p in terms)


# Arrow: a row of dots (the perforation on the icon's page) arcing from the app to Applications.
def arrow(color, alpha_from=0.35):
    (ax, ay), (bx, by) = LAYOUT["app"], LAYOUT["applications"]
    half = LAYOUT["icon_size"] / 2
    p0 = np.array([ax + half + 18, ay + 2.0])
    p2 = np.array([bx - half - 18, by + 2.0])
    p1 = np.array([(ax + bx) / 2, ay - 34.0])
    layer = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    col = tuple(int(v) for v in rgb(color))

    def at(t):
        return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2

    # Even spacing along the curve.
    ts = np.linspace(0, 1, 2000)
    pts = np.array([at(t) for t in ts])
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]
    step, r = 9.0, 2.1
    marks = np.arange(0, seg[-1] - 10, step)
    for i, s in enumerate(marks):
        x, y = pts[np.searchsorted(seg, s)]
        a = alpha_from + (1 - alpha_from) * (i / max(1, len(marks) - 1))
        d.ellipse([(x - r) * SS, (y - r) * SS, (x + r) * SS, (y + r) * SS], fill=col + (int(255 * a),))
    # Chevron head along the end tangent.
    tip = pts[-1]
    tx, ty = pts[-1] - pts[-12]
    ang = math.atan2(ty, tx)
    for side in (-1, 1):
        a2 = ang + math.pi + side * math.radians(42)
        end = tip + 9.5 * np.array([math.cos(a2), math.sin(a2)])
        d.line([tuple(tip * SS), tuple(end * SS)], fill=col + (255,), width=int(3.2 * SS))
        for p in (tip, end):
            rr = 1.6 * SS
            d.ellipse([p[0] * SS - rr, p[1] * SS - rr, p[0] * SS + rr, p[1] * SS + rr], fill=col + (255,))
    return layer


def rounded_plate(img, cx, cy, w, h, top, bottom):
    """A soft sand-coloured plate under a label, with a faint lip of light and a contact shadow."""
    r = h / 2
    shadow = Image.new("L", (W * SS, H * SS), 0)
    ImageDraw.Draw(shadow).rounded_rectangle(
        [(cx - w / 2) * SS, (cy - h / 2 + 1.2) * SS, (cx + w / 2) * SS, (cy + h / 2 + 1.2) * SS], r * SS, fill=255)
    sa = np.asarray(shadow.filter(ImageFilter.GaussianBlur(2.2 * SS)), dtype=np.float64) / 255 * 0.28
    img = over(img, rgb("#7a3a0c"), sa)
    body = Image.new("L", (W * SS, H * SS), 0)
    ImageDraw.Draw(body).rounded_rectangle(
        [(cx - w / 2) * SS, (cy - h / 2) * SS, (cx + w / 2) * SS, (cy + h / 2) * SS], r * SS, fill=255)
    ba = np.asarray(body, dtype=np.float64) / 255
    fill = vgrad([(cy - h / 2, top), (cy + h / 2, bottom)])
    img = over(img, fill, ba)
    lip = Image.new("L", (W * SS, H * SS), 0)
    ImageDraw.Draw(lip).rounded_rectangle(
        [(cx - w / 2) * SS, (cy - h / 2) * SS, (cx + w / 2) * SS, (cy + h / 2) * SS], r * SS,
        outline=255, width=int(0.75 * SS))
    la = np.asarray(lip, dtype=np.float64) / 255 * (YS < cy) * 0.22
    return over(img, rgb("#fff3dc"), la)


# The label band colour: relative luminance ~0.18, where black and white text both clear ~4.5:1.
BAND_TOP, BAND_BOTTOM = "#c26228", "#b4541f"


def dune():
    """Daylight, as on the website: cream sky, sun glow, three amber dunes. The labels sit on the middle one."""
    img = vgrad([(0, "#fdecd2"), (140, "#fbd9a8"), (230, "#f6c07e")])
    img = over(img, rgb("#fff8ea"), glow(505, 60, 300, 0.95))
    img = over(img, hgrad([(0, "#f2ae66"), (W, "#e9913f")]), hill(wave(198, (12, 0.8, 1.9), (5, 2.1, 0.3)), 2.5) * 0.92)
    img = over(img, vgrad([(222, BAND_TOP), (320, BAND_BOTTOM)]), hill(wave(226, (5, 1.0, 0.5), (2.5, 2.7, 2.0)), 1.2))
    img = over(img, vgrad([(300, "#9a4218"), (400, "#6c2a0d")]), hill(wave(306, (7, 1.3, 2.6), (3, 3.1, 0.7)), 1.5))
    return img, arrow("#a9491a")


def dusk():
    """Evening: the same dunes with the sun just down behind the far ridge. Kind to dark mode."""
    img = vgrad([(0, "#4a1d0c"), (120, "#8e3c16"), (200, "#d9772e")])
    img = over(img, rgb("#ffb35c"), glow(320, 215, 260, 0.55))
    rng = np.random.default_rng(7)
    stars = np.zeros((H * SS, W * SS))
    for x, y in zip(rng.uniform(0, W, 34), rng.uniform(0, 110, 34)):
        stars[int(y * SS), int(x * SS)] = rng.uniform(0.5, 1.0)
    stars = soften(stars, 0.35) * 6 * np.clip(1 - YS / 120, 0, 1)
    img = over(img, rgb("#fff1d6"), np.clip(stars, 0, 0.8))
    img = over(img, hgrad([(0, "#7b3417"), (W, "#8e3f1a")]), hill(wave(200, (11, 0.8, 1.9), (5, 2.1, 0.3)), 2.5))
    img = over(img, vgrad([(222, BAND_TOP), (320, BAND_BOTTOM)]), hill(wave(226, (5, 1.0, 0.5), (2.5, 2.7, 2.0)), 1.2))
    img = over(img, vgrad([(300, "#62270d"), (400, "#3d1706")]), hill(wave(306, (7, 1.3, 2.6), (3, 3.1, 0.7)), 1.5))
    return img, arrow("#ffe7c2", alpha_from=0.3)


def page():
    """The icon's page: cream paper with faint rules under an amber header. Labels sit on sand plates."""
    img = vgrad([(0, "#fdf9f1"), (H, "#f3ebdc")])
    rule = np.zeros((H * SS, W * SS))
    for y in range(62, H, 30):
        rule[(YS >= y) & (YS < y + 1)] = 1
    img = over(img, rgb("#e7d8bf"), soften(rule, 0.2) * 0.7)
    head = 22
    img = over(img, vgrad([(0, "#f8962a"), (head, "#e57b12")]), (YS < head).astype(np.float64))
    dots = Image.new("L", (W * SS, H * SS), 0)
    dd = ImageDraw.Draw(dots)
    for x in np.arange(8, W, 16):
        dd.ellipse([(x - 2.1) * SS, (head - 2.1) * SS, (x + 2.1) * SS, (head + 2.1) * SS], fill=255)
    img = over(img, rgb("#fdf9f1"), np.asarray(dots, dtype=np.float64) / 255)
    for key in ("app", "applications"):
        cx, cy = LAYOUT[key]
        img = rounded_plate(img, cx, label_centre(cy), 128, 24, "#bc5b23", "#b7571f")
    return img, arrow("#d96a06")


DIRECTIONS = {"dune": dune, "dusk": dusk, "page": page}


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
    art, arrow_layer = DIRECTIONS[name]()
    base = Image.fromarray(np.clip(art, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    base.alpha_composite(arrow_layer)
    base = base.convert("RGB")
    out = os.path.join(HERE, name)
    os.makedirs(out, exist_ok=True)
    rng = np.random.default_rng(1)
    paths = []
    for scale, suffix, sigma in ((2, "@2x", 1.6), (1, "", 1.2)):
        im = base.resize((W * scale, H * scale), Image.LANCZOS)
        a = np.asarray(im, dtype=np.float64)
        a = a + rng.normal(0, sigma, a.shape[:2])[..., None]  # sand grain, monochrome
        im = Image.fromarray(np.clip(a.round(), 0, 255).astype(np.uint8), "RGB")
        p = os.path.join(out, f"background{suffix}.png")
        im.save(p, dpi=(72 * scale, 72 * scale), optimize=True)
        paths.append(p)
        black, white = check(im, scale)
        ok = black >= MIN_CONTRAST and white >= MIN_CONTRAST
        print(f"{name} {scale}x: label contrast black {black:.2f}:1, white {white:.2f}:1 {'ok' if ok else 'TOO LOW'}")
        if not ok:
            sys.exit(1)
    subprocess.run(["/usr/bin/tiffutil", "-cathidpicheck", paths[1], paths[0], "-out",
                    os.path.join(out, "background.tiff")], check=True, capture_output=True)


def volume_icon():
    """brand/dmg/VolumeIcon.icns: the app icon, for the mounted disk in Finder and on the desktop."""
    import shutil
    import tempfile
    src = os.path.join(os.path.dirname(os.path.dirname(HERE)), "Pane/Resources/Assets.xcassets/AppIcon.appiconset")
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, "VolumeIcon.iconset")
        os.mkdir(iconset)
        for size in (16, 32, 128, 256, 512):
            for scale, suffix in ((1, ""), (2, "@2x")):
                shutil.copy(os.path.join(src, f"icon-mac-{size}@{scale}x.png"),
                            os.path.join(iconset, f"icon_{size}x{size}{suffix}.png"))
        subprocess.run(["/usr/bin/iconutil", "-c", "icns", iconset, "-o", os.path.join(HERE, "VolumeIcon.icns")], check=True)


if __name__ == "__main__":
    for n in sys.argv[1:] or DIRECTIONS:
        render(n)
    volume_icon()
