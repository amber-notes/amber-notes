#!/usr/bin/env python3
"""A local stand-in for ambernotes.app for recording the template flow: everything comes from the
website's dev server (cd web && pnpm dev, port 5210), except an app template that isn't in the
public library yet ("Evening tracker"), which is served from this folder.
  python3 demo/onboarding/site.py   (port 5211)"""
import http.server, json, os, re, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEV = "http://127.0.0.1:5210"
SLUG = "evening-tracker"

TEMPLATE = {
    "version": 1, "slug": SLUG, "title": "Evening tracker", "category": "Habits and health",
    "audience": "For anyone who wants a two-minute check-in at the end of the day.",
    "description": "A small app for your evenings: how the day went, sleep and mood, with your week and trends. Your AI can change it.",
    "folder": "Habits",
    "note": "Evening tracker\n\nA two-minute check-in at the end of the day.\n",
    "instructions": [], "app": f"/templates/apps/{SLUG}.json", "preview": f"/templates/apps/{SLUG}.jpg",
    "ask": "Add a sleep column to my Evening tracker.",
    "url": f"https://ambernotes.app/templates/{SLUG}",
}

def fetch(path):
    with urllib.request.urlopen(DEV + path) as r:
        return r.read(), r.headers.get("Content-Type", "text/html")

def evening_page():
    """The real template page's frame (header, styles, footer) with the Evening app in it."""
    html, _ = fetch("/templates/habit-tracker")
    h = html.decode()
    h = re.sub(r"<script\b[^>]*>.*?</script>", "", h, flags=re.S)   # a static copy: no hydration
    h = h.replace(">Habit tracker</h1>", ">Evening tracker</h1>")
    h = re.sub(r'(<p class="templates_lede__[^"]*"[^>]*>).*?(</p>)', r"\1" + TEMPLATE["description"] + r"\2", h, count=1, flags=re.S)
    h = re.sub(r'(<p class="templates_for__[^"]*"[^>]*>).*?(</p>)', r"\1" + TEMPLATE["audience"] + r"\2", h, count=1, flags=re.S)
    h = h.replace('href="/open/template/habit-tracker"', f'href="ambernotes://template/{SLUG}"')
    h = h.replace("Use template opens Amber Notes and adds the note.", "Use template opens Amber Notes and adds the app.")
    # The picture: the app itself instead of the note's slice.
    h = re.sub(r'(<div class="templates_heroStage__[^"]*" style=")[^"]*(">).*?(</figure>)',
               r'\1--ground:#c98a4b\2<img src="/templates/apps/' + SLUG + r'.jpg" alt="The Evening tracker app" style="display:block;width:62%;margin:6% auto;border-radius:28px;box-shadow:0 18px 40px rgba(60,30,5,.25)">',
               h, count=1, flags=re.S)
    h = h.replace("<title>Habit tracker", "<title>Evening tracker")
    # An app has no prompt or markdown to copy: just Use template.
    h = re.sub(r'<div class="templates_promptCopy__.*?</div></div>', "", h, count=1, flags=re.S)
    h = re.sub(r'<button type="button" class="templates_quiet__.*?</button>', "", h, count=1, flags=re.S)
    return h.encode()

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        try:
            if path == f"/templates/{SLUG}":
                body, kind = evening_page(), "text/html; charset=utf-8"
            elif path == f"/templates/{SLUG}.json":
                body, kind = json.dumps(TEMPLATE).encode(), "application/json"
            elif path.startswith("/templates/apps/"):
                name = os.path.basename(path)
                with open(os.path.join(HERE, "apps", name), "rb") as f: body = f.read()
                kind = "application/json" if name.endswith(".json") else "image/jpeg"
            else:
                body, kind = fetch(self.path)
            self.send_response(200)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            self.send_response(404); self.end_headers(); self.wfile.write(str(e).encode())
    def log_message(self, *a): pass

http.server.ThreadingHTTPServer(("127.0.0.1", 5211), Handler).serve_forever()
