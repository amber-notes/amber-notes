#!/usr/bin/env python3
"""Composites what Finder will show for each background: the 2x picture, the real icons at the
positions and size in layout.json, and 13 pt system-font labels, inside approximate window
chrome: light mode, dark mode with black labels (what Finder does over a background picture),
and dark mode with white labels (the case to guard against). Finder can't be screenshotted
without opening a window, so this is how a direction is judged.

    build/dmg-venv/bin/python brand/dmg/preview.py <out dir> <Applications icon png> [directions]

The Applications icon comes from the system (sips -s format png
/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/ApplicationsFolderIcon.icns).
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
LAYOUT = json.load(open(os.path.join(HERE, "layout.json")))
W, H = LAYOUT["window"]
S = 2
TITLE = 28  # title bar with the toolbar hidden; Finder's bounds include it, so the picture's bottom 28 pt is cut
RADIUS = 16
APP_ICON = os.path.join(REPO, "Pane/Resources/Assets.xcassets/AppIcon.appiconset/icon-mac-512@2x.png")


def font(size, weight):
    f = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", size * S)
    f.set_variation_by_axes([100, max(17, size), 400, weight])  # width, optical size, grade, weight
    return f


def window(bg_path, apps_icon, dark, white_labels):
    label = (255, 255, 255, 217) if white_labels else (0, 0, 0, 217)  # labelColor is 85% black / white
    bar = (42, 40, 38) if dark else (240, 237, 233)
    title_col = (235, 235, 235) if dark else (40, 40, 40)
    win = Image.new("RGBA", (W * S, H * S), bar + (255,))
    bg = Image.open(bg_path).convert("RGBA")
    win.paste(bg.crop((0, 0, W * S, (H - TITLE) * S)), (0, TITLE * S))
    d = ImageDraw.Draw(win)
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        cx, cy = (20 + i * 20) * S, (TITLE / 2) * S
        d.ellipse([cx - 6 * S, cy - 6 * S, cx + 6 * S, cy + 6 * S], fill=c + (255,))
    tf = font(13, 600)
    tw = d.textlength("Amber Notes", font=tf)
    d.text(((W * S - tw) / 2, (TITLE / 2) * S), "Amber Notes", font=tf, fill=title_col + (255,), anchor="lm")
    d.line([(0, TITLE * S - 1), (W * S, TITLE * S - 1)], fill=(0, 0, 0, 60 if dark else 30), width=1)
    size = LAYOUT["icon_size"]
    lf = font(LAYOUT["text_size"], 400)
    for key, img, name in (("app", Image.open(APP_ICON), "Amber Notes"), ("applications", apps_icon, "Applications")):
        cx, cy = LAYOUT[key]
        icon = img.convert("RGBA").resize((size * S, size * S), Image.LANCZOS)
        win.alpha_composite(icon, (int((cx - size / 2) * S), int((cy - size / 2 + TITLE) * S)))
        d.text((cx * S, (cy + size / 2 + 12 + TITLE) * S), name, font=lf, fill=label, anchor="mm")
    mask = Image.new("L", win.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, win.size[0] - 1, win.size[1] - 1], RADIUS * S, fill=255)
    win.putalpha(mask)
    return win


def scene(bg_path, apps_icon, dark, white_labels, caption):
    pad = 48 * S
    desk = (30, 30, 32, 255) if dark else (226, 222, 216, 255)
    out = Image.new("RGBA", (W * S + 2 * pad, H * S + 2 * pad), desk)
    win = window(bg_path, apps_icon, dark, white_labels)
    shadow = Image.new("RGBA", out.size, (0, 0, 0, 0))
    sm = Image.new("L", out.size, 0)
    ImageDraw.Draw(sm).rounded_rectangle([pad, pad + 14 * S, pad + W * S, pad + H * S + 14 * S], RADIUS * S, fill=110)
    shadow.putalpha(sm.filter(ImageFilter.GaussianBlur(24 * S)))
    out.alpha_composite(shadow)
    out.alpha_composite(win, (pad, pad))
    ImageDraw.Draw(out).text((pad, pad / 2), caption, font=font(12, 500),
                             fill=(160, 160, 160, 255) if dark else (110, 110, 110, 255), anchor="lm")
    return out


def main():
    out_dir, apps = sys.argv[1], Image.open(sys.argv[2])
    names = sys.argv[3:] or ["white", "warm", "white-plate", "warm-band"]
    os.makedirs(out_dir, exist_ok=True)
    rows = []
    for n in names:
        bg = os.path.join(HERE, n, "background@2x.png")
        panels = [scene(bg, apps, False, False, "Light mode"),
                  scene(bg, apps, True, False, "Dark mode, if Finder keeps black labels"),
                  scene(bg, apps, True, True, "Dark mode, if Finder draws white labels")]
        row = Image.new("RGBA", (panels[0].width * len(panels), panels[0].height))
        for i, panel in enumerate(panels):
            row.paste(panel, (i * panel.width, 0))
        row.convert("RGB").save(os.path.join(out_dir, f"preview-{n}.png"))
        rows.append(row)
    sheet = Image.new("RGB", (rows[0].width, rows[0].height * len(rows)))
    for i, r in enumerate(rows):
        sheet.paste(r, (0, i * r.height))
    sheet.save(os.path.join(out_dir, "tasting-menu.png"))


if __name__ == "__main__":
    main()
