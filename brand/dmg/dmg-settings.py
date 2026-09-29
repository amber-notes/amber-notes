# dmgbuild settings for the Amber Notes download. Run via scripts/release-mac.sh:
#   dmgbuild -s brand/dmg/dmg-settings.py -D app=<path to Amber Notes.app> "Amber Notes" <out.dmg>
import os
app = defines["app"]
here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else "brand/dmg"
format = "UDRW"  # compressed afterwards by scripts/release-mac.sh (hdiutil convert is unreliable here)
filesystem = "HFS+"
files = [app]
symlinks = {"Applications": "/Applications"}
icon_locations = {os.path.basename(app): (170, 215), "Applications": (470, 215)}
background = os.path.join("brand", "dmg", "background.tiff")
window_rect = ((200, 160), (640, 400))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
icon_size = 112
text_size = 13
