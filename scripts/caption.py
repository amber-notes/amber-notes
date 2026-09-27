#!/usr/bin/env python3
"""Trims a clip and overlays captions (rendered as rounded pills with Pillow).
caption.py in.mp4 out.mp4 start width "t0-t1:text" ...   (times in the trimmed clip, seconds)"""
import os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
src, out, start, width = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
font = ImageFont.truetype("/System/Library/Fonts/SFNSRounded.ttf", int(width * 0.042))
tmp = tempfile.mkdtemp()
inputs, chain, last = [], [f"[0:v]scale={width}:-2[v0]"], "v0"
for i, spec in enumerate(sys.argv[5:]):
    span, text = spec.split(":", 1)
    a, b = span.split("-")
    l, t, r, btm = font.getbbox(text)
    padx, pady = int(width * 0.04), int(width * 0.022)
    w, h = r - l + padx * 2, btm - t + pady * 2
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w - 1, h - 1], h // 2, fill=(18, 18, 20, 200))
    d.text((padx - l, pady - t), text, font=font, fill=(255, 255, 255, 255))
    path = os.path.join(tmp, f"c{i}.png")
    img.save(path)
    inputs += ["-i", path]
    chain.append(f"[{last}][{i+1}:v]overlay=x=(W-w)/2:y=H-h-{int(width*0.19)}:enable='between(t,{a},{b})'[v{i+1}]")
    last = f"v{i+1}"
cmd = ["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-i", src, *inputs, "-filter_complex", ";".join(chain),
       "-map", f"[{last}]", "-c:v", "libx264", "-crf", "21", "-preset", "slow", "-pix_fmt", "yuv420p", "-an", out]
subprocess.run(cmd, check=True)
print(out)
