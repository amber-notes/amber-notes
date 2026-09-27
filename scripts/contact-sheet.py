#!/usr/bin/env python3
"""Tiles a run's step screenshots into one labelled image: contact-sheet.py <dir> [cols] [width]"""
import sys, glob, os
from PIL import Image, ImageDraw
d = sys.argv[1]; cols = int(sys.argv[2]) if len(sys.argv) > 2 else 4; w = int(sys.argv[3]) if len(sys.argv) > 3 else 300
files = sorted(f for f in glob.glob(os.path.join(d, "[0-9][0-9]-*.png")))
ims = []
for f in files:
    im = Image.open(f).convert("RGB"); h = int(im.height * w / im.width)
    ims.append((os.path.basename(f)[:-4], im.resize((w, h))))
if not ims: sys.exit("no shots")
h = max(i.height for _, i in ims) + 22
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (w + 8), rows * h), "white")
dr = ImageDraw.Draw(sheet)
for k, (name, im) in enumerate(ims):
    x, y = (k % cols) * (w + 8), (k // cols) * h
    dr.text((x + 4, y + 4), name, fill="black")
    sheet.paste(im, (x, y + 20))
out = os.path.join(d, "sheet.png"); sheet.save(out); print(out)
