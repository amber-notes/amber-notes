#!/usr/bin/env python3
"""Draws the DMG window backgrounds, sized to brand/dmg/layout.json.

    build/dmg-venv/bin/python brand/dmg/make-background.py [white|warm|white-plate|warm-band|probe-dark|dune ...]

Writes brand/dmg/<direction>/background.png (1x), background@2x.png and background.tiff (both
reps, what dmgbuild copies into the image), and brand/dmg/VolumeIcon.icns from the app icon.

Each direction declares which label colours it must carry, and the script fails unless every
pixel under both labels holds MIN_CONTRAST against them. The mid-tone plates, band and dunes
(relative luminance ~0.18) hold both black and white labels.

Needs Pillow and numpy: build/dmg-venv/bin/pip install pillow numpy
"""
import json
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

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


# The mark and wordmark as in the site header (web/app/site.css .site-brand: SF Pro Display 750,
# ink #2a1d10, gap 11/34 of the mark), scaled to sit quietly in the corner.
MARK = os.path.join(os.path.dirname(HERE), "..", "web", "public", "mark.png")
INK = "#2a1d10"
AMBER = "#d96a06"


def sf(size_pt, weight):
    f = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", int(round(size_pt * SS)))
    f.set_variation_by_axes([100, max(17, size_pt), 400, weight])  # width, optical size, grade, weight
    return f


def brand(layer, x=24, y=22, mark=26, text=15):
    icon = Image.open(MARK).convert("RGBA").resize((mark * SS, mark * SS), Image.LANCZOS)
    layer.alpha_composite(icon, (x * SS, y * SS))
    d = ImageDraw.Draw(layer)
    f = sf(text, 750)
    tx = x + mark + mark * 11 / 34
    # Letter by letter for the site's -0.01em tracking.
    for ch in "Amber Notes":
        d.text((tx * SS, (y + mark / 2) * SS), ch, font=f, fill=INK, anchor="lm")
        tx += d.textlength(ch, font=f) / SS - 0.01 * text


def bold_arrow(layer, color=AMBER, stroke=7.0, head=17.0, gap=30):
    """A short, heavy arrow with round caps and joins, centred between the two icons."""
    (ax, ay), (bx, _) = LAYOUT["app"], LAYOUT["applications"]
    half = LAYOUT["icon_size"] / 2
    x0, x1, y = ax + half + gap, bx - half - gap, ay
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


def plain(bg, under_labels=None):
    img = np.empty((H * SS, W * SS, 3))
    img[...] = rgb(bg)
    if under_labels:
        img = under_labels(img)
    layer = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    brand(layer)
    bold_arrow(layer)
    return img, layer


# Caramel at relative luminance ~0.19: black labels read at ~4.8:1 and white ones at ~4.3:1.
CARAMEL = "#a86a3e"


def soft_plates(img):
    """A quiet caramel plate behind each label, feathered at the edge."""
    m = Image.new("L", (W * SS, H * SS), 0)
    d = ImageDraw.Draw(m)
    for key in ("app", "applications"):
        cx, cy = LAYOUT[key]
        yc, w, h = label_centre(cy), 112, 22
        d.rounded_rectangle([(cx - w / 2) * SS, (yc - h / 2) * SS, (cx + w / 2) * SS, (yc + h / 2) * SS], h / 2 * SS, fill=255)
    return over(img, rgb(CARAMEL), soften(np.asarray(m, dtype=np.float64) / 255, 0.5))


def soft_band(img):
    """The page shades into a warm band across the label row only, and back out below it."""
    yc = label_centre(LAYOUT["app"][1])
    top, bottom, fade = yc - 10, yc + 10, 34

    def smooth(t):
        t = np.clip(t, 0, 1)
        return t * t * (3 - 2 * t)

    a = smooth((YS - (top - fade)) / fade) * smooth(((bottom + fade) - YS) / fade)
    return over(img, rgb(CARAMEL), a)


def white():
    """Discord-style: white, the brand in the corner, a bold amber arrow, nothing else."""
    return plain("#ffffff")


def warm():
    """The same on a barely-there warm white."""
    return plain("#fffcf7")


def white_plate():
    """White, with a soft plate behind each label that holds black and white labels."""
    return plain("#ffffff", soft_plates)


def warm_band():
    """Warm white, shading into a band across the label row that holds black and white labels."""
    return plain("#fffcf7", soft_band)


def probe_dark():
    """Not a design: a dark picture that shows whether Finder picks the label colour from the
    picture (white labels in light mode too) or from the appearance."""
    return plain("#1d1d1f")


# name: (draw, label colours the picture must carry, sand grain).
# white and warm rely on Finder drawing black labels over a light picture in dark mode too, as
# Discord's DMG does (pure white under 16 pt labels). white-plate and warm-band hold either colour.
DIRECTIONS = {
    "white": (white, ("black",), False),
    "warm": (warm, ("black",), False),
    "white-plate": (white_plate, ("black", "white"), False),
    "warm-band": (warm_band, ("black", "white"), False),
    "probe-dark": (probe_dark, ("white",), False),
    "dune": (dune, ("black", "white"), True),
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
    draw, labels, grain = DIRECTIONS[name]
    art, arrow_layer = draw()
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
        if grain:
            a = a + rng.normal(0, sigma, a.shape[:2])[..., None]  # sand grain, monochrome
        im = Image.fromarray(np.clip(a.round(), 0, 255).astype(np.uint8), "RGB")
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
