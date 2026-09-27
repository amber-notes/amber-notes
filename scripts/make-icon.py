#!/usr/bin/env python3
"""Draws Pane's icon: a frosted glass pane with an amber edge on a deep ground."""
import sys
from PIL import Image, ImageDraw, ImageFilter

def ground(size):
    im = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(im)
    for y in range(size):
        t = y / size
        d.line([(0, y), (size, y)], fill=(int(24 + 16 * t), int(22 + 12 * t), int(30 + 6 * t)))
    # Warm light blooming from the top right, for the glass to catch.
    glow = Image.new("L", (size, size), 0)
    ImageDraw.Draw(glow).ellipse([size * 0.35, -size * 0.35, size * 1.35, size * 0.65], fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.18))
    amber = Image.new("RGB", (size, size), (245, 170, 60))
    return Image.composite(amber, im, glow.point(lambda v: int(v * 0.55)))

def pane(size, base):
    s = size
    card = [s * 0.24, s * 0.2, s * 0.8, s * 0.82]
    r = s * 0.09
    # Frost: blur what's behind the card and lift it.
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle(card, r, fill=255)
    frosted = base.filter(ImageFilter.GaussianBlur(s * 0.05))
    frosted = Image.blend(frosted, Image.new("RGB", (s, s), (255, 255, 255)), 0.16)
    shadow = Image.new("L", (s, s), 0)
    ImageDraw.Draw(shadow).rounded_rectangle([card[0], card[1] + s * 0.03, card[2], card[3] + s * 0.03], r, fill=150)
    shadow = shadow.filter(ImageFilter.GaussianBlur(s * 0.04))
    out = Image.composite(Image.new("RGB", (s, s), (0, 0, 0)), base, shadow.point(lambda v: int(v * 0.6)))
    out = Image.composite(frosted, out, mask)
    d = ImageDraw.Draw(out, "RGBA")
    # Specular rim.
    d.rounded_rectangle(card, r, outline=(255, 255, 255, 90), width=max(2, int(s * 0.006)))
    # Lines of writing, the first one amber like a title.
    x0, x1 = card[0] + s * 0.08, card[2] - s * 0.08
    y = card[1] + s * 0.12
    d.rounded_rectangle([x0, y, x0 + (x1 - x0) * 0.62, y + s * 0.05], s * 0.025, fill=(247, 178, 64, 255))
    y += s * 0.12
    for w in (1.0, 0.86, 0.94, 0.58):
        d.rounded_rectangle([x0, y, x0 + (x1 - x0) * w, y + s * 0.028], s * 0.014, fill=(255, 255, 255, 150))
        y += s * 0.075
    return out

def ios(path):
    s = 1024
    pane(s, ground(s)).save(path)

def mac(path, size):
    s = 1024
    art = pane(s, ground(s))
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    inset, radius = 100, 185
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([inset, inset, s - inset, s - inset], radius, fill=255)
    art = art.resize((s - 2 * inset, s - 2 * inset))
    body = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    body.paste(art, (inset, inset))
    sh = Image.new("L", (s, s), 0)
    ImageDraw.Draw(sh).rounded_rectangle([inset, inset + 12, s - inset, s - inset + 12], radius, fill=110)
    sh = sh.filter(ImageFilter.GaussianBlur(18))
    canvas.paste(Image.new("RGBA", (s, s), (0, 0, 0, 255)), (0, 0), sh)
    canvas.paste(body, (0, 0), mask)
    canvas.resize((size, size), Image.LANCZOS).save(path)

d = sys.argv[1]
ios(f"{d}/icon-ios.png")
mac(f"{d}/icon-mac-512.png", 512)
mac(f"{d}/icon-mac-1024.png", 1024)
