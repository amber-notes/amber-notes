#!/usr/bin/env python3
"""Composes the App Store screenshots from the simulator captures.

    scripts/store-art/capture.sh                 # 1. real scenes, 1320x2868
    python3 scripts/store-art/render.py [A B C]  # 2. frames per variant, plus compare.png

Needs Pillow (for element bounds and the compare sheet) and Google Chrome (headless, for layout).
Every pop-out is placed from the capture itself: Vision OCR (locate.swift) gives each line's box,
and card edges are found in the pixels, so nothing is positioned by eye.

Variants:
  A  Bold: big type, the phone large and cropped at the bottom, crisp pop-outs.
  B  Calm: smaller type, more air, the whole phone top visible, soft shadows.
  C  Close-up: no phone; the part of the note that matters, cropped and enlarged, like a card.
"""
import json, os, subprocess, sys, tempfile
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HERE = os.path.dirname(os.path.abspath(__file__))
CAP = os.path.join(ROOT, ".shots/appstore/art/captures")
OUT = os.path.join(ROOT, ".shots/appstore/art")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W, H = 1320, 2868

BG = {"amber": "#F0901A", "cream": "#FFF6EA", "brown": "#3A1F0B"}
INK = {"amber": "#2A1606", "cream": "#3A1F0B", "brown": "#FFF6EA"}
KEY = {"amber": "#FFFFFF", "cream": "#D0700A", "brown": "#F6B35F"}

FRAMES = [
    dict(n=1, cap="1-paella", bg="amber", title="Notes <em>ChatGPT and Claude</em> can edit",
         sub="Simple notes. Your AI keeps them up to date.",
         focus=("Paella rice", "Smoked paprika"), bubble="Add what I need for Sunday's paella", note_title="Groceries",
         chip="Added by ChatGPT", c_focus=("Groceries", "Spinach")),
    dict(n=2, cap="2-lisbon", bg="amber", title="Ask once. Your notes <em>update.</em>",
         focus=("Plan", "Hotel in Príncipe Real"), bubble="Ask Memmo for a late checkout, and add it to my Lisbon plan", note_title="Lisbon",
         chip="Added by Claude", chip_row="Late checkout requested", c_focus=("Lisbon", "Ramiro")),
    dict(n=3, cap="3-list", bg="cream", title="Just notes. <em>Nothing to learn.</em>",
         focus=("All Notes", "Standup notes")),
    dict(n=4, cap="4-groceries", bg="cream", title="Lists you tick off <em>in a tap</em>",
         focus=("Oat milk", "Spinach"), lift_row="Olive oil", c_focus=("Groceries", "Spinach")),
    dict(n=5, cap="5-files", bg="cream", title="Keep the <em>files</em> with the note",
         focus=("Trip documents", "Lisboa OFFICIAL Site"), lift_card="Flight itinerary.pdf"),
    dict(n=6, cap="6-lisbon-dark", bg="brown", title="Easy on the eyes <em>at night</em>",
         focus=("Lisbon", "LX Factory on Sunday"), c_focus=("Lisbon", "Ramiro")),
]

VARIANTS = {
    "A": dict(name="Bold", size=118, weight=780, sub=46, top=150, gap=28, phone_w=1210, phone_top=None, shadow=1.0, pop=1.0),
    "B": dict(name="Calm", size=96, weight=650, cap_w=880, sub=40, top=190, gap=34, phone_w=980, phone_top=None, shadow=0.6, pop=0.9),
    "C": dict(name="Close-up", size=112, weight=800, sub=44, top=150, gap=28, phone_w=None, phone_top=None, shadow=1.0, pop=1.0),
}


def boxes(cap):
    return json.load(open(os.path.join(CAP, cap + ".json")))


def find(cap, text):
    for b in boxes(cap):
        if b["text"].lstrip("•·–-— ").startswith(text):
            return b
    raise SystemExit(f"{cap}: no line starting with {text!r}")


def card_bounds(img, x, y):
    """The rounded card around (x, y): walk outwards until the pixels match the page again."""
    px = img.load()
    page = px[20, y]
    def same(a, b):
        return sum(abs(a[i] - b[i]) for i in range(3)) < 6
    l = x
    while l > 1 and not same(px[l, y], page): l -= 1
    r = x
    while r < img.width - 2 and not same(px[r, y], page): r += 1
    t = y
    while t > 1 and not same(px[x, t], page): t -= 1
    b = y
    while b < img.height - 2 and not same(px[x, b], page): b += 1
    return l, t, r, b


def phone_html(v, f, img_url, caption_bottom):
    """A generic modern phone: a dark body with an even bezel, cropped by the bottom of the frame."""
    s = v["phone_w"] / W                       # capture px -> canvas px
    bezel = round(20 * s * 1.1)
    radius = round(190 * s)
    left = (W - v["phone_w"]) // 2 - bezel
    top = caption_bottom + 70
    return s, left + bezel, top + bezel, f"""
  <div class="phone" style="left:{left}px;top:{top}px;width:{v['phone_w'] + 2 * bezel}px;height:{round(H * s) + 2 * bezel}px;border-radius:{radius + bezel}px;padding:{bezel}px">
    <div class="btn" style="left:-7px;top:{round(430 * s)}px;height:{round(150 * s)}px"></div>
    <div class="btn" style="left:-7px;top:{round(640 * s)}px;height:{round(150 * s)}px"></div>
    <div class="btn" style="right:-7px;top:{round(560 * s)}px;height:{round(240 * s)}px"></div>
    <img src="{img_url}" style="width:{v['phone_w']}px;border-radius:{radius}px">
  </div>"""


def frame_html(key, v, f):
    img_path = os.path.join(CAP, f["cap"] + ".png")
    img = Image.open(img_path).convert("RGB")
    url = "file://" + img_path
    bg = f["bg"]
    title = f["title"]
    sub = f.get("sub")
    cap_lines = 2
    caption_h = v["top"] + round(v["size"] * 1.02 * cap_lines) + ((v["gap"] + round(v["sub"] * 1.3)) if sub else 0)
    pops = []
    body = ""

    if key == "C":
        # No phone: a slice of the note from its title down, at full-bleed size, as a card.
        a, b = find(f["cap"], (f.get("c_focus") or f["focus"])[0]), find(f["cap"], (f.get("c_focus") or f["focus"])[1])
        s = 1.0
        x0 = 30
        card_w = 1260
        y0 = max(0, a["y"] - 60)
        y1 = min(img.height, b["y"] + b["h"] + 24)   # stop in the gap below the last row, never mid-row
        card_left = (W - card_w) // 2
        card_top = caption_h + 110
        room = H - card_top - 90
        crop_h = min(y1 - y0, int(room / s))
        body = f"""
  <div class="card" style="left:{card_left}px;top:{card_top}px;width:{card_w}px;height:{round(crop_h * s)}px">
    <img src="{url}" style="position:absolute;left:{-round(x0 * s)}px;top:{-round(y0 * s)}px;width:{round(W * s)}px">
  </div>"""
        ox, oy = card_left - x0 * s, card_top - y0 * s
        f = dict(f, c_card_top=card_top)
    else:
        s, ox, oy, body = phone_html(v, f, url, caption_h)

    def to_canvas(x, y):
        return ox + x * s, oy + y * s

    # Pop-outs, placed from the capture.
    if f.get("bubble"):
        # Just above the note's title (over the date line), never over the note's own lines.
        t = find(f["cap"], f["note_title"])
        _, ty = to_canvas(0, t["y"])
        if key == "C":
            ty = f["c_card_top"] + 200   # the bubble's bottom sits 180 px into the card, clear of the caption
        pops.append(f"""
  <div class="bubble" style="right:{50}px;bottom:{round(H - ty + 18)}px;max-width:{round(820 * v['pop'])}px;font-size:{round(42 * v['pop'])}px">
    <span class="who">You, to your AI</span>{f['bubble']}</div>""")
    if f.get("chip"):
        row = find(f["cap"], f.get("chip_row") or f["focus"][0])
        _, ry = to_canvas(0, row["y"] + row["h"])
        pops.append(f"""
  <div class="chip" style="right:{70}px;top:{round(ry + 26)}px;font-size:{round(40 * v['pop'])}px"><i></i>{f['chip']}</div>""")
    if f.get("lift_row"):
        row = find(f["cap"], f["lift_row"])
        y0, y1 = row["y"] - 34, row["y"] + row["h"] + 34
        x0, x1 = 30, 760
        zoom = 1.28 * v["pop"]
        cx, cy = to_canvas(x0, y0)
        w = (x1 - x0) * s * zoom
        h = (y1 - y0) * s * zoom
        cx -= (w - (x1 - x0) * s) * 0.18
        cy -= (h - (y1 - y0) * s) / 2
        pops.append(f"""
  <div class="lift" style="left:{round(cx)}px;top:{round(cy)}px;width:{round(w)}px;height:{round(h)}px">
    <img src="{url}" style="position:absolute;left:{-round(x0 * s * zoom)}px;top:{-round(y0 * s * zoom)}px;width:{round(W * s * zoom)}px"></div>""")
    if f.get("lift_card"):
        t = find(f["cap"], f["lift_card"])
        l, tp, r, b = card_bounds(img, t["x"] - 20, t["y"] + t["h"] // 2)
        zoom = 1.18 * v["pop"]
        cx, cy = to_canvas(l, tp)
        w, h = (r - l) * s * zoom, (b - tp) * s * zoom
        cx -= (w - (r - l) * s) / 2
        cy -= (h - (b - tp) * s) / 2
        pops.append(f"""
  <div class="lift" style="left:{round(cx)}px;top:{round(cy)}px;width:{round(w)}px;height:{round(h)}px;border-radius:{round(34 * s * zoom)}px">
    <img src="{url}" style="position:absolute;left:{-round(l * s * zoom)}px;top:{-round(tp * s * zoom)}px;width:{round(W * s * zoom)}px"></div>""")

    shadow = v["shadow"]
    sub_html = f'<p class="sub">{sub}</p>' if sub else ""
    return f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="file://{HERE}/fonts/fonts.css">
<style>
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:{BG[bg]}}}
.head{{position:absolute;left:{(W - v.get('cap_w', 1180)) // 2}px;width:{v.get('cap_w', 1180)}px;top:{v['top']}px;text-align:center}}
h1{{margin:0;font:{v['weight']} {v['size']}px/1.02 "Bricolage Grotesque";font-variation-settings:"opsz" 96;letter-spacing:-0.012em;color:{INK[bg]};text-wrap:balance}}
h1 em{{font-style:normal;color:{KEY[bg]}}}
.sub{{margin:{v['gap']}px auto 0;max-width:1000px;font:500 {v['sub']}px/1.3 "Onest";color:{INK[bg]};opacity:.86}}
.phone{{position:absolute;background:#15110d;box-sizing:content-box;
  box-shadow:0 0 0 3px #2c241c inset,0 {round(40 * shadow)}px {round(120 * shadow)}px rgba(40,18,0,{0.28 * shadow:.2f}),0 {round(10 * shadow)}px {round(30 * shadow)}px rgba(40,18,0,{0.22 * shadow:.2f})}}
.phone img{{display:block}}
.btn{{position:absolute;width:7px;background:#2c241c;border-radius:4px}}
.card{{position:absolute;overflow:hidden;border-radius:56px;background:#fff;
  box-shadow:0 {round(40 * shadow)}px {round(110 * shadow)}px rgba(40,18,0,{0.26 * shadow:.2f}),0 8px 24px rgba(40,18,0,.14)}}
.bubble{{position:absolute;max-width:760px;background:#1F1A15;color:#fff;border-radius:44px 44px 12px 44px;padding:30px 38px;font-family:"Onest";font-weight:500;line-height:1.3;
  box-shadow:0 24px 60px rgba(30,12,0,.35),0 6px 16px rgba(30,12,0,.25)}}
.bubble .who{{display:block;font-size:.62em;letter-spacing:.06em;text-transform:uppercase;color:#F6B35F;margin-bottom:10px;font-weight:600}}
.chip{{position:absolute;display:flex;align-items:center;gap:14px;background:#fff;color:#3A1F0B;border-radius:999px;padding:20px 34px;font-family:"Onest";font-weight:600;
  box-shadow:0 18px 44px rgba(30,12,0,.28),0 4px 12px rgba(30,12,0,.18)}}
.chip i{{width:20px;height:20px;border-radius:50%;background:#F0901A;display:block}}
.lift{{position:absolute;overflow:hidden;background:#fff;border-radius:28px;
  box-shadow:0 30px 80px rgba(30,12,0,.32),0 8px 22px rgba(30,12,0,.2)}}
</style></head><body>
<div class="head"><h1>{title}</h1>{sub_html}</div>
{body}
{''.join(pops)}
</body></html>"""


def render(html, out):
    """Headless Chrome writes the screenshot quickly but may not exit (its updater lingers), so wait
    for a complete file, then stop the Chrome this call started (its own process group only)."""
    import signal, time
    if os.path.exists(out):
        os.remove(out)
    with tempfile.TemporaryDirectory() as tmp:
        page = os.path.join(tmp, "frame.html")
        open(page, "w").write(html)
        proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
                                 "--no-default-browser-check", "--disable-component-update",
                                 f"--user-data-dir={tmp}/profile", "--force-device-scale-factor=1",
                                 f"--window-size={W},{H}", "--allow-file-access-from-files",
                                 f"--screenshot={out}", "file://" + page],
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
    im = Image.open(out)
    assert im.size == (W, H), f"{out} is {im.size}"


def compare(keys):
    th = 390
    tw = round(W * th / H)
    pad, label = 24, 70
    sheet = Image.new("RGB", (pad + 6 * (tw + pad), len(keys) * (th + label + pad) + pad), "#EDE7DD")
    from PIL import ImageDraw, ImageFont
    d = ImageDraw.Draw(sheet)
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 26)
    for r, k in enumerate(keys):
        y = pad + r * (th + label + pad)
        d.text((pad, y + 10), f"{k} · {VARIANTS[k]['name']}    ·  App Store search size; only the first three show in results", fill="#3A1F0B", font=font)
        for i in range(6):
            im = Image.open(os.path.join(OUT, k, f"{i + 1:02d}.png")).resize((tw, th), Image.LANCZOS)
            sheet.paste(im, (pad + i * (tw + pad), y + label))
    sheet.save(os.path.join(OUT, "compare.png"))


def main():
    keys = [k for k in sys.argv[1:] if k in VARIANTS] or list(VARIANTS)
    for k in keys:
        os.makedirs(os.path.join(OUT, k), exist_ok=True)
        for f in FRAMES:
            out = os.path.join(OUT, k, f"{f['n']:02d}.png")
            render(frame_html(k, VARIANTS[k], f), out)
            print(out)
    compare(keys)
    print(os.path.join(OUT, "compare.png"))


if __name__ == "__main__":
    main()
