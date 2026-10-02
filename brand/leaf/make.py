#!/usr/bin/env python3
"""Writes every copy of the leaf icon from the sources in this folder.

    uv run --with pillow python3 brand/leaf/make.py web    # the website's icons, favicon and marks
    uv run --with pillow python3 brand/leaf/make.py brand  # directory listings, the ChatGPT plugin, the README
    uv run --with pillow python3 brand/leaf/make.py app    # the Xcode icon (.icon and asset catalog) and in-app marks
    uv run --with pillow python3 brand/leaf/make.py social # the GitHub social preview and the avatar for profiles
    uv run --with pillow python3 brand/leaf/make.py sources  # after changing leaf.png or OFFSET (needs Xcode)

Sources (from the round 1 "leaf page" icon, layered in Icon Composer):
- leaf.png: the leaf alone, as drawn. Everything else places it with OFFSET.
- AmberNotes.icon: the Icon Composer document, the app icon on iOS 26 and macOS 26.
- render-1024.png: Apple's own render of it (ictool, iOS Default, converted to sRGB), rounded, with
  the system's lighting. Every "app icon" picture outside the app is cut from it.
- AppIcon_1024.png: flat and opaque, unmasked, for places that mask it themselves.
The last three are written by `sources`.
"""
import io
import os
import shutil
import subprocess
import struct
import sys
from io import BytesIO

from PIL import Image, ImageCms, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
AMBER = (0xE7, 0x7C, 0x0E)
# Where the leaf sits, in px at 1024 from its drawn position (+x right, +y down). As drawn, its centre
# of mass was 28 px right of and 26 px above the centre, so it looked high and to the right, most of
# all in circle crops. This puts the centre of mass at the centre, a touch lower to balance the tip.
OFFSET = (-23, 28)
ICTOOL = "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"


def src(name):
    return Image.open(os.path.join(HERE, name)).convert("RGBA")


def out(path):
    path = os.path.join(REPO, path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def sized(im, px):
    return im if im.width == px else im.resize((px, px), Image.LANCZOS)


def save(im, path, px=None, opaque=False):
    im = sized(im, px) if px else im
    (im.convert("RGB") if opaque else im).save(out(path), optimize=True)


def placed_leaf():
    leaf = src("leaf.png")
    canvas = Image.new("RGBA", leaf.size, (0, 0, 0, 0))
    canvas.alpha_composite(leaf, OFFSET)
    return canvas


def favicon(px, fill=0.59):
    """The leaf on a rounded amber square, filling 59% of it as in the app icon, and placed the same
    way. At 16px it's a plain silhouette, which stays crisp where the lines would blur."""
    leaf = placed_leaf()
    x0, y0, x1, y1 = leaf.split()[3].getbbox()
    s = px * 16
    base = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(base).rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.225), fill=AMBER + (255,))
    c = leaf.resize((round(leaf.width * fill * s / max(x1 - x0, y1 - y0)),) * 2, Image.LANCZOS)
    if px <= 16:
        c = Image.merge("RGBA", [Image.new("L", c.size, v) for v in (0xFF, 0xF4, 0xE6)] + [c.split()[3]])
    base.alpha_composite(c, ((s - c.width) // 2, (s - c.height) // 2))
    return base.resize((px, px), Image.LANCZOS)


def ico(path, sizes):
    """An ICO of PNG frames in the given order. Google reads the first frame, so 48 goes first."""
    frames = []
    for px in sizes:
        b = BytesIO()
        favicon(px).save(b, "PNG", optimize=True)
        frames.append((px, b.getvalue()))
    head = struct.pack("<HHH", 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    entries, data = b"", b""
    for px, png in frames:
        entries += struct.pack("<BBBBHHII", px % 256, px % 256, 0, 0, 1, 32, len(png), offset + len(data))
        data += png
    with open(out(path), "wb") as f:
        f.write(head + entries + data)


def maskable(px):
    """Android crops a maskable icon to as little as a centred circle of 80% width; the leaf
    reaches 91% of that, so it's drawn at 85% on the same amber."""
    flat = src("AppIcon_1024.png")
    s = 1024
    inner = flat.resize((int(s * 0.85), int(s * 0.85)), Image.LANCZOS)
    base = Image.new("RGBA", (s, s), AMBER + (255,))
    base.alpha_composite(inner, ((s - inner.width) // 2, (s - inner.height) // 2))
    return sized(base, px)


def mac_tile(px):
    """The macOS asset-catalog icon: the rounded render on the 824 grid of a 1024 canvas, with a soft shadow."""
    s, inset = 1024, 100
    body = src("render-1024.png").resize((s - 2 * inset,) * 2, Image.LANCZOS)
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    shadow = Image.new("L", (s, s), 0)
    shadow.paste(body.split()[3].point(lambda v: v * 110 // 255), (inset, inset + 12))
    canvas.paste(Image.new("RGBA", (s, s), (0, 0, 0, 255)), (0, 0), shadow.filter(ImageFilter.GaussianBlur(18)))
    canvas.alpha_composite(body, (inset, inset))
    return sized(canvas, px)


def web():
    render = src("render-1024.png")
    save(render, "web/public/mark.png")
    save(render, "web/public/mark-256.png", 256)
    save(render, "web/public/icon-192.png", 192)
    save(render, "web/app/icon.png", 512)
    for px in (16, 32, 48, 96):
        save(favicon(px), f"web/public/icon-{px}.png")
    save(maskable(512), "web/public/icon-maskable-512.png", opaque=True)
    save(src("AppIcon_1024.png"), "web/app/apple-icon.png", 180, opaque=True)
    ico("web/app/favicon.ico", [48, 32, 16])


def brand():
    render, flat = src("render-1024.png"), src("AppIcon_1024.png")
    save(flat, "brand/directory/icon-1024.png", opaque=True)
    save(flat, "brand/directory/icon-512.png", 512, opaque=True)
    save(render, "brand/directory/mark-512.png", 512)
    save(render, "brand/directory/mark-128.png", 128)
    plugin = "brand/directory/chatgpt-plugin/assets"
    for name in ("logo", "logo-dark"):
        save(flat, f"{plugin}/{name}.png", 512, opaque=True)
    for name in ("icon", "icon-dark"):
        save(favicon(128, fill=0.84), f"{plugin}/{name}.png")
    save(render, "docs/images/icon.png", 256)


def app():
    dest = out("Pane/Resources/AppIcon.icon")
    shutil.rmtree(dest, ignore_errors=True)
    shutil.copytree(os.path.join(HERE, "AmberNotes.icon"), dest)
    cat = "Pane/Resources/Assets.xcassets"
    save(src("AppIcon_1024.png"), f"{cat}/AppIcon.appiconset/icon-ios.png", opaque=True)
    for pt in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            save(mac_tile(pt * scale), f"{cat}/AppIcon.appiconset/icon-mac-{pt}@{scale}x.png")
    render = src("render-1024.png")
    save(render, f"{cat}/Mark.imageset/mark.png")
    save(render, f"{cat}/MarkTight.imageset/mark-tight.png")


def social():
    """The GitHub social preview (1280 x 640) and a square avatar that circle crops well."""
    save(src("AppIcon_1024.png"), "brand/social/avatar-1024.png", opaque=True)
    w, h = 1280, 640
    card = Image.new("RGBA", (w, h), (0xFF, 0xF4, 0xE6, 255))
    icon = src("render-1024.png").resize((300, 300), Image.LANCZOS)
    x, y = 96, (h - 300) // 2
    shadow = Image.new("L", (w, h), 0)
    shadow.paste(icon.split()[3].point(lambda v: v * 90 // 255), (x, y + 22))
    card = Image.composite(Image.new("RGBA", (w, h), (60, 20, 0, 255)), card, shadow.filter(ImageFilter.GaussianBlur(26)))
    card.alpha_composite(icon, (x, y))
    d = ImageDraw.Draw(card)
    fonts = os.path.join(REPO, "web", "lib", "og")
    d.text((464, 232), "Amber Notes", font=ImageFont.truetype(f"{fonts}/Inter-ExtraBold.ttf", 104), fill=(0x2A, 0x1D, 0x10))
    d.text((468, 372), "The notes app your AI can actually use.", font=ImageFont.truetype(f"{fonts}/Inter-SemiBold.ttf", 38), fill=(0x74, 0x60, 0x4C))
    save(card, "brand/social/github-social-preview.png", opaque=True)


def sources():
    """Places the leaf by OFFSET in the Icon Composer document, the flat icon and Apple's render."""
    leaf = placed_leaf()
    leaf.save(os.path.join(HERE, "AmberNotes.icon", "Assets", "leaf.png"), optimize=True)
    # The flat icon: a soft, squashed cast shadow under the leaf on the amber fill.
    sh = Image.new("L", (1024, 1024), 0)
    sh.paste(leaf.split()[3].resize((1024, 380)).filter(ImageFilter.GaussianBlur(10)), (0, 560))
    sh = sh.filter(ImageFilter.GaussianBlur(26)).point(lambda v: int(v * 0.42))
    flat = Image.new("RGBA", (1024, 1024), AMBER + (255,))
    flat.alpha_composite(Image.merge("RGBA", [Image.new("L", (1024, 1024), c) for c in (120, 50, 0)] + [sh]))
    flat.alpha_composite(leaf)
    flat.convert("RGB").save(os.path.join(HERE, "AppIcon_1024.png"), optimize=True)
    # Apple's render writes Display P3; convert to sRGB so every viewer shows the same amber.
    path = os.path.join(HERE, "render-1024.png")
    subprocess.run([ICTOOL, os.path.join(HERE, "AmberNotes.icon"), "--export-image", "--output-file", path,
                    "--platform", "iOS", "--rendition", "Default", "--width", "1024", "--height", "1024", "--scale", "1"],
                   check=True, capture_output=True)
    im = Image.open(path)
    p3 = ImageCms.ImageCmsProfile(io.BytesIO(im.info["icc_profile"]))
    ImageCms.profileToProfile(im.convert("RGBA"), p3, ImageCms.createProfile("sRGB"), outputMode="RGBA").save(path, optimize=True)


if __name__ == "__main__":
    targets = {"sources": sources, "web": web, "brand": brand, "app": app, "social": social}
    for name in sys.argv[1:] or [t for t in targets if t != "sources"]:
        targets[name]()
