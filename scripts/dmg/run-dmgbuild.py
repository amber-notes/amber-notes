"""dmgbuild, with hdiutil made dependable on this Mac and a background that Finder always finds.

The background picture: dmgbuild records it only as a classic alias, which resolves by volume
name. With another "Amber Notes" volume mounted (an older download, say), it points at that
volume's picture and Finder shows its default window instead. So the alias is pinned to
/Volumes/<name> as an ejectable disk, and the .DS_Store also gets a Foundation bookmark (pBBk),
the record Finder writes itself, which finds the volume by its UUID.

`hdiutil convert` to a compressed UDIF image fails with "Resource temporarily unavailable"
(EAGAIN while writing the UDIF header) on every try when the image has a GUID partition map,
and on some tries without one. So the image is created without a partition map (a plain HFS+
volume, which mounts the same way) and the convert is retried a few times.

    build/dmg-venv/bin/python scripts/dmg/run-dmgbuild.py <dmgbuild arguments>

For a local test build only, DMG_UNCOMPRESSED_OK=1 ships the read-write image as is when every
convert fails: the same window and contents, just larger. Releases never set it.
"""
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import time

import dmgbuild.core as core
from dmgbuild.__main__ import main
from ds_store import DSStore
from mac_alias import ALIAS_EJECTABLE_DISK, Alias

HERE = os.path.dirname(os.path.abspath(__file__))
_hdiutil = core.hdiutil
background = []  # the background picture's path inside the mounted image


class PinnedAlias(Alias):
    @classmethod
    def for_file(cls, path):
        a = super().for_file(path)
        a.volume.posix_path = b"/Volumes/" + a.volume.name
        a.volume.disk_type = ALIAS_EJECTABLE_DISK
        background.append(path)
        return a


class RawBookmark:
    def __init__(self, data):
        self.data = data

    def to_bytes(self):
        return self.data


def add_bookmark():
    path = background.pop()
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "bookmark")
        subprocess.run(["/usr/bin/xcrun", "swift", os.path.join(HERE, "bookmark.swift"), path, out], check=True)
        data = open(out, "rb").read()
    with DSStore.open(os.path.join(os.path.dirname(path), ".DS_Store"), "r+") as d:
        d["."]["pBBk"] = RawBookmark(data)


def hdiutil(cmd, *args, **kwargs):
    if cmd == "detach" and background:  # the .DS_Store is written; the image is still mounted
        add_bookmark()
    if cmd == "create":
        args = ("-layout", "NONE") + args
    if cmd != "convert":
        return _hdiutil(cmd, *args, **kwargs)
    for attempt in range(int(os.environ.get("DMG_CONVERT_TRIES", "12"))):
        try:
            ret, out = _hdiutil(cmd, *args, **kwargs)
            if ret == 0:
                return ret, out
        except plistlib.InvalidFileException:  # a failed convert prints no plist
            ret, out = 1, "hdiutil convert failed"
        print(f"hdiutil convert failed, retrying ({attempt + 1})", file=sys.stderr)
        time.sleep(2)
    if os.environ.get("DMG_UNCOMPRESSED_OK") == "1":
        src, dst = args[0], args[args.index("-o") + 1]
        shutil.copyfile(src, dst)
        print(f"hdiutil convert kept failing; wrote the uncompressed image to {dst}", file=sys.stderr)
        return 0, {}
    return ret, out


core.hdiutil = hdiutil
core.Alias = PinnedAlias
sys.exit(main())
