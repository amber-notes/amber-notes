#!/usr/bin/env python3
"""Tasting sheet for how high the page sits in the tile: each option as the Mac icon on a light
and a dark Dock at 128 and 64 pt, as the iOS icon at 60 pt, and as the 24 pt mark in the site
header on its cream, rendered at 2x with rsvg-convert like the shipped files.

    cd brand/notes-icons && python3 raise_sheet.py <out dir>

Needs rsvg-convert (brew install librsvg) and Pillow.
"""
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

from final_s1 import ios_svg, mac_svg, mark_svg

OPTIONS = [  # (label, raise as a share of the tile's height, page scale)
    ("0 (now)", 0.0, 1.0),
    ("Up 1.5%", 0.015, 1.0),
    ("Up 3%", 0.03, 1.0),
    ("Up 4.5%", 0.045, 1.0),
    ("Page at 94%, no raise", 0.0, 0.94),
]
S = 2
LIGHT_DOCK, DARK_DOCK, HOME, CREAM, INK = (228, 226, 230), (36, 35, 38), (206, 214, 226), (255, 244, 230), (42, 29, 16)


def font(size, weight=400):
    f = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", size * S)
    f.set_variation_by_axes([100, max(17, size), 400, weight])
    return f


def render(svg, pt, tmp):
    src, out = os.path.join(tmp, "r.svg"), os.path.join(tmp, "r.png")
    open(src, "w").write(svg)
    subprocess.run(["rsvg-convert", "-w", str(pt * S), "-h", str(pt * S), src, "-o", out], check=True)
    im = Image.open(out).convert("RGBA")
    os.remove(src)
    os.remove(out)
    return im


def ios_masked(im):
    """iOS draws the full-bleed icon inside its rounded mask (about 22.4% of the side)."""
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, im.width - 1, im.height - 1], im.width * 0.2237, fill=255)
    im.putalpha(m)
    return im


def main():
    out_dir = sys.argv[1]
    cols = [("Mac, light Dock, 128 pt", 176), ("Mac, light Dock, 64 pt", 112), ("Mac, dark Dock, 128 pt", 176),
            ("Mac, dark Dock, 64 pt", 112), ("iOS, 60 pt", 112), ("Site header mark, 24 pt", 190)]
    label_w, head, row = 260, 40, 176
    width = label_w + sum(w for _, w in cols)
    sheet = Image.new("RGB", (width * S, (head + row * len(OPTIONS)) * S), (250, 250, 250))
    d = ImageDraw.Draw(sheet)
    x = label_w
    for title, w in cols:
        d.text(((x + w / 2) * S, head / 2 * S), title, font=font(11, 600), fill=(60, 60, 60), anchor="mm")
        x += w
    for i, (name, r, sc) in enumerate(OPTIONS):
        y0 = head + row * i
        d.text((20 * S, (y0 + row / 2) * S), name, font=font(14, 600), fill=(30, 30, 30), anchor="lm")
        mac = {pt: render(mac_svg(raise_=r, scale=sc), pt, out_dir) for pt in (128, 64)}
        cells = [(LIGHT_DOCK, mac[128]), (LIGHT_DOCK, mac[64]), (DARK_DOCK, mac[128]), (DARK_DOCK, mac[64]),
                 (HOME, ios_masked(render(ios_svg(raise_=r, scale=sc), 60, out_dir)))]
        x = label_w
        for (bg, im), (_, w) in zip(cells, cols):
            d.rectangle([x * S, y0 * S, (x + w) * S - 1, (y0 + row) * S - 1], fill=bg)
            sheet.paste(im, (int((x + (w - im.width / S) / 2) * S), int((y0 + (row - im.height / S) / 2) * S)), im)
            x += w
        # The site header: the mark at 24 pt beside the wordmark (web/app/site.css .site-brand, scaled).
        w = cols[-1][1]
        d.rectangle([x * S, y0 * S, (x + w) * S - 1, (y0 + row) * S - 1], fill=CREAM)
        mark = render(mark_svg(raise_=r, scale=sc), 24, out_dir)
        mx, my = x + 34, y0 + row / 2 - 12
        sheet.paste(mark, (int(mx * S), int(my * S)), mark)
        d.text(((mx + 24 + 8) * S, (my + 12) * S), "Amber Notes", font=font(14, 750), fill=INK, anchor="lm")
    sheet.save(os.path.join(out_dir, "icon-raise-tasting.png"))


if __name__ == "__main__":
    main()
