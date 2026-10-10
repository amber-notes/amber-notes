#!/usr/bin/env python3
"""A stand-in for OpenWeather's current-weather API on this Mac, for the note pages demo only.
   python3 scripts/note-pages-weather-mock.py   (serves http://localhost:8790)
Answers /data/2.5/weather?q=<city>&appid=<key> with made-up but plausible weather; 401 without a key."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        if url.path != "/data/2.5/weather":
            return self.send(404, {"message": "not found"})
        if not q.get("appid", [""])[0]:
            return self.send(401, {"cod": 401, "message": "Invalid API key."})
        city = q.get("q", ["Lisbon"])[0]
        self.send(200, {
            "name": city,
            "main": {"temp": 21.4, "feels_like": 20.8},
            "weather": [{"description": "clear sky"}],
            "wind": {"speed": 4.1},
            "daily": [{"day": d, "max": hi, "min": lo} for d, hi, lo in
                      [("Tue", 22, 15), ("Wed", 23, 16), ("Thu", 20, 14), ("Fri", 19, 14), ("Sat", 24, 16)]],
        })

    def send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", 8790), Handler).serve_forever()
