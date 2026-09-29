# dmgbuild settings for the Amber Notes installer window. Use scripts/dmg/build-dmg.sh, which runs:
#   dmgbuild -s scripts/dmg/settings.py -D repo=<repo> -D app=<Amber Notes.app> [-D background=warm] \
#     "Amber Notes" <out.dmg>
# The positions come from brand/dmg/layout.json, the same file the background is drawn to.
import json
import os

repo = defines.get("repo", os.getcwd())  # noqa: F821 (dmgbuild provides `defines`)
app = defines["app"]  # noqa: F821
direction = defines.get("background", "warm")  # noqa: F821: a folder in brand/dmg
layout = json.load(open(os.path.join(repo, "brand", "dmg", "layout.json")))
name = os.path.basename(app)

format = "UDZO"
compression_level = 9
filesystem = "HFS+"
files = [app]
symlinks = {"Applications": "/Applications"}
hide_extensions = [name]
icon = os.path.join(app, "Contents", "Resources", "AppIcon.icns")  # the volume icon is the app's own
background = os.path.join(repo, "brand", "dmg", direction, "background.tiff")  # 1x and 2x reps

# The bounds include the title bar (about 28 pt), so the content area is 540 x ~352 and the icons
# and labels are centred in that; the picture is drawn at the full 540 x 380, its bottom unseen.
width, height = layout["window"]
window_rect = ((200, 140), (width, height))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
show_icon_preview = False
arrange_by = None
label_pos = "bottom"
icon_size = layout["icon_size"]
text_size = layout["text_size"]
icon_locations = {name: tuple(layout["app"]), "Applications": tuple(layout["applications"])}
