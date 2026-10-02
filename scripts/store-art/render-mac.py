#!/usr/bin/env python3
"""Composes the Mac App Store screenshots (2880x1800) from the window captures.

    scripts/store-art/capture-mac.sh            # 1. real windows, 2560x1600 and panels
    python3 scripts/store-art/render-mac.py     # 2. frames in .shots/appstore/mac/

A caption over the app's main window, shown whole; scenes with a second window
(Connect an AI, a template, the Apple Notes import) show it in front, on the right, the way it
opens over the notes. Same type and colours as the iPhone screenshots. Needs Google Chrome.
"""
import os, signal, subprocess, tempfile, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts", "fonts.css")
CAP = os.path.join(ROOT, ".shots/appstore/mac/captures")
OUT = os.path.join(ROOT, ".shots/appstore/mac")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W, H = 2880, 1800

LOOK = {
    "cream": dict(bg="#FCEFDF", ink="#2A1606", sub="#6B4A2E", mark="rgba(240,144,26,.42)"),
    "brown": dict(bg="#3A1F0B", ink="#FFF6EA", sub="#E9CFAE", mark="rgba(240,144,26,.55)"),
}

FRAMES = [
    dict(name="1-ai-change", look="cream", title="The notes app <em>your AI</em> can actually use.",
         sub="See every line ChatGPT or Claude changed. Undo in a click."),
    dict(name="2-connect", look="cream", title="Works with <em>ChatGPT and Claude</em>",
         sub="You approve every connection, and can disconnect any time.", panel=True),
    dict(name="3-template", look="cream", title="Start from a <em>template</em>",
         sub="Trackers, plans and checklists your AI keeps up to date.", panel=True),
    dict(name="4-import", look="cream", title="Bring all your <em>Apple Notes</em>",
         sub="Every note and folder in one step. Nothing in Apple Notes changes.", panel=True),
    dict(name="5-notes-dark", look="brown", title="Simple notes, <em>on every device</em>",
         sub="Checklists, tables and sub-notes, synced in about a second."),
]


def html(f):
    c = LOOK[f["look"]]
    main = "file://" + os.path.join(CAP, f["name"] + "-main.png")
    # The main window: 2560x1600 captured, shown whole at 2080 wide (the receipt sits at its bottom).
    if f.get("panel"):
        win = '<img class="win" src="%s" style="left:200px;top:440px;width:2080px">' % main
        panel = os.path.join(CAP, f["name"] + "-panel.png")
        win += '<img class="win panel" src="file://%s" style="right:170px;top:560px;height:1060px">' % panel
    else:
        win = '<img class="win" src="%s" style="left:400px;top:440px;width:2080px">' % main
    return f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="file://{FONTS}">
<style>
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:{c['bg']}}}
.head{{position:absolute;left:0;right:0;top:120px;text-align:center}}
h1{{margin:0;font:780 128px/1.05 "Bricolage Grotesque";letter-spacing:-2.5px;color:{c['ink']}}}
h1 em{{font-style:normal;background:linear-gradient(transparent 56%,{c['mark']} 56%,{c['mark']} 94%,transparent 94%);padding:0 6px}}
p{{margin:34px 0 0;font:500 50px/1.3 Onest;color:{c['sub']}}}
.win{{position:absolute;border-radius:22px;filter:drop-shadow(0 30px 60px rgba(58,31,11,.22)) drop-shadow(0 4px 12px rgba(58,31,11,.14))}}
.panel{{border-radius:20px;filter:drop-shadow(0 40px 80px rgba(58,31,11,.30)) drop-shadow(0 6px 16px rgba(58,31,11,.18))}}
</style></head><body>
<div class="head"><h1>{f['title']}</h1><p>{f['sub']}</p></div>
{win}
</body></html>"""


def render(page_html, out):
    """Headless Chrome writes the screenshot but may not exit; stop only the Chrome this started."""
    if os.path.exists(out):
        os.remove(out)
    with tempfile.TemporaryDirectory() as tmp:
        page = os.path.join(tmp, "frame.html")
        open(page, "w").write(page_html)
        proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
                                 "--no-default-browser-check", "--disable-component-update",
                                 f"--user-data-dir={tmp}/profile", "--force-device-scale-factor=1",
                                 f"--window-size={W},{H}", "--allow-file-access-from-files",
                                 "--virtual-time-budget=3000", f"--screenshot={out}", "file://" + page],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        try:
            deadline, last = time.time() + 90, -1
            while time.time() < deadline:
                if proc.poll() is not None and os.path.exists(out):
                    break
                if os.path.exists(out):
                    size = os.path.getsize(out)
                    if size > 0 and size == last:
                        break
                    last = size
                time.sleep(0.5)
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(5)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
    info = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", out], capture_output=True, text=True).stdout.split()
    size = (int(info[info.index("pixelWidth:") + 1]), int(info[info.index("pixelHeight:") + 1]))
    assert size == (W, H), f"{out} is {size}"


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in FRAMES:
        out = os.path.join(OUT, f["name"] + ".png")
        render(html(f), out)
        print(out)


if __name__ == "__main__":
    main()
