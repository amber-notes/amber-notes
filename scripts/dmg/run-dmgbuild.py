"""dmgbuild, with hdiutil made dependable on this Mac.

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
import sys
import time

import dmgbuild.core as core
from dmgbuild.__main__ import main

_hdiutil = core.hdiutil


def hdiutil(cmd, *args, **kwargs):
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
sys.exit(main())
