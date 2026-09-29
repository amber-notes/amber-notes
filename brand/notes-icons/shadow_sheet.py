#!/usr/bin/env python3
"""Tasting sheet for the Mac icon's baked tile shadow: each option on a light and a dark Dock at
128 and 64 pt, and on the DMG window, rendered at 2x with rsvg-convert like the shipped sizes.

    cd brand/notes-icons && python3 shadow_sheet.py <out dir>

Needs rsvg-convert (brew install librsvg) and Pillow.
"""
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

from final_s1 import mac_svg

APPLE = (10, 5, 0.30)  # Apple's macOS app icon template: y 10, blur 10 (σ 5), black 30%, at 1024
OPTIONS = [
    ("Now (C2 as shipped)", subprocess.run(["git", "show", "main:brand/notes-icons/final-mac.svg"],
                                           capture_output=True, text=True, check=True).stdout),
    ("a. Apple template shadow", mac_svg(APPLE)),
    ("b. Lighter", mac_svg((6, 4, 0.16))),
    ("c. No baked shadow", mac_svg(None)),
    ("d. a, plus a neutral page shadow", mac_svg(APPLE).replace(
        'dy="16" stdDeviation="20" flood-color="#4A2000" flood-opacity="0.45"',
        'dy="12" stdDeviation="16" flood-color="#000" flood-opacity="0.22"')),
]
S = 2  # pixels per point
LIGHT_DOCK, DARK_DOCK, DMG = (228, 226, 230), (36, 35, 38), (255, 252, 247)


def font(size, weight=400):
    f = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", size * S)
    f.set_variation_by_axes([100, max(17, size), 400, weight])
    return f


def render(svg, pt, tmp):
    src, out = os.path.join(tmp, "v.svg"), os.path.join(tmp, f"v{pt}.png")
    open(src, "w").write(svg)
    subprocess.run(["rsvg-convert", "-w", str(pt * S), "-h", str(pt * S), src, "-o", out], check=True)
    return Image.open(out).convert("RGBA")


def main():
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    cols = [("Light Dock, 128 pt", LIGHT_DOCK, 128), ("Light Dock, 64 pt", LIGHT_DOCK, 64),
            ("Dark Dock, 128 pt", DARK_DOCK, 128), ("Dark Dock, 64 pt", DARK_DOCK, 64),
            ("DMG window, 128 pt", DMG, 128)]
    cell, label_w, head = 176, 250, 40
    sheet = Image.new("RGB", ((label_w + cell * len(cols)) * S, (head + cell * len(OPTIONS)) * S), (250, 250, 250))
    d = ImageDraw.Draw(sheet)
    for j, (title, _, _) in enumerate(cols):
        d.text(((label_w + cell * j + cell / 2) * S, head / 2 * S), title, font=font(12, 600), fill=(60, 60, 60), anchor="mm")
    for i, (name, svg) in enumerate(OPTIONS):
        y0 = head + cell * i
        d.text((20 * S, (y0 + cell / 2) * S), name, font=font(14, 600), fill=(30, 30, 30), anchor="lm")
        icons = {pt: render(svg, pt, out_dir) for pt in (128, 64)}
        for j, (_, bg, pt) in enumerate(cols):
            x0 = label_w + cell * j
            d.rectangle([x0 * S, y0 * S, (x0 + cell) * S - 1, (y0 + cell) * S - 1], fill=bg)
            ic = icons[pt]
            top = y0 + (cell - pt) / 2 - (10 if bg == DMG else 0)
            sheet.paste(ic, (int((x0 + (cell - pt) / 2) * S), int(top * S)), ic)
            if bg == DMG:
                d.text(((x0 + cell / 2) * S, (top + pt + 12) * S), "Amber Notes", font=font(13), fill=(0, 0, 0), anchor="mm")
    for f in ("v.svg", "v128.png", "v64.png"):
        os.remove(os.path.join(out_dir, f))
    sheet.save(os.path.join(out_dir, "icon-shadow-tasting.png"))


if __name__ == "__main__":
    main()
