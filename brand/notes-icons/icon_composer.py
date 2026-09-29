#!/usr/bin/env python3
"""Writes the app icon as an Icon Composer bundle, Pane/Resources/AppIcon.icon, which Xcode 26
compiles for macOS 26 and iOS 26 (the system adds the glass, the edge and the shadow).

    cd brand/notes-icons && python3 icon_composer.py [out.icon]

Two layers from the same source as the C2 art (final_s1.py), each a full 1024 canvas:
- ground: the amber gradient (three stops, which an Icon Composer linear fill can't hold, so an image)
- page: the turned page with its rules and leaf, placed by RAISE and PAGE_SCALE; its shadow comes
  from the system (the group's shadow), not baked in.

Needs rsvg-convert (brew install librsvg).
"""
import json
import os
import subprocess
import sys
import tempfile

from final_s1 import D, GROUND_SVG, page

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "Pane", "Resources", "AppIcon.icon")


def srgb(hex_):
    r, g, b = (int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return f"srgb:{r:.5f},{g:.5f},{b:.5f},1.00000"


ICON = {
    "fill": {"solid": srgb("#D96A06")},  # behind the ground image; also what tinted modes start from
    "groups": [
        {
            "name": "Page",
            "layers": [{"name": "page", "image-name": "page.png", "glass": False, "hidden": False,
                        "position": {"scale": 1, "translation-in-points": [0, 0]}}],
            "shadow": {"kind": "neutral", "opacity": 0.5},
            "translucency": {"enabled": False, "value": 0},
            "specular": True,
        },
        {
            "name": "Ground",
            "layers": [{"name": "ground", "image-name": "ground.png", "glass": False, "hidden": False,
                        "position": {"scale": 1, "translation-in-points": [0, 0]}}],
            "shadow": {"kind": "none", "opacity": 0},
            "translucency": {"enabled": False, "value": 0},
            "specular": False,
        },
    ],
    "supported-platforms": {"squares": "shared"},
}


def svg(inner):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">{D}{inner}</svg>'


def main(out=OUT, icon=ICON):
    assets = os.path.join(out, "Assets")
    os.makedirs(assets, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, inner in (("ground", GROUND_SVG), ("page", page(shadow=False))):
            src = os.path.join(tmp, f"{name}.svg")
            open(src, "w").write(svg(inner))
            subprocess.run(["rsvg-convert", "-w", "1024", "-h", "1024", src, "-o", os.path.join(assets, f"{name}.png")], check=True)
    with open(os.path.join(out, "icon.json"), "w") as f:
        json.dump(icon, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main(*sys.argv[1:2])
