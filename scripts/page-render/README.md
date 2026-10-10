# App render service

`check_app` and `preview_app` need a browser, and Supabase edge functions can't run one. The MCP server sends a note's app to this service and gets back measurements and screenshots. In the app, the HTML runs the same way: the same CSP, the `--amber-*` theme, the `window.amber` bridge and no network.

```sh
RENDER_SECRET=… deno run -A scripts/page-render/server.ts --port 8790
# MCP server: RENDER_URL=https://render.internal.example, RENDER_SECRET=…
```

`POST /render` takes `{ html, markdown, data, today, views: [{ width, scheme }], capture, interact, probes }` with `Authorization: Bearer <RENDER_SECRET>`.

It returns, for each view:
- script errors
- overflow
- body contrast
- small or faint text
- unlabeled controls
- headings and a text excerpt
- a PNG (when `capture` is set)

It also returns the result of trying the app's first control, and probes over changed notes: a new row with markup in it, an empty note, and 400 rows. Without `RENDER_URL`, `check_app` runs only the checks that need no browser, and `preview_app` says it's unavailable.

## What it sees

By default the MCP server sends the app's HTML with a sample note and sample data (`app_sample.ts`). The sample keeps the same tables, columns, checklists and data keys, but every word and number is replaced. `preview_app` with `data: "real"` sends the real note and data only when the person has turned on `profiles.app_previews_real`; the switch for it in the app's settings is still to be built.

That trust level matches the MCP server, which already opens notes in memory for an AI's request. The service stores nothing and logs only timings and sizes. Each request gets fresh browser contexts, and the page's own requests are refused. Run it with outbound network blocked and reachable only from the MCP server.

## Measured here (Apple Silicon, WebKit)

| Call | Views | Time |
| --- | --- | --- |
| `check_app` | 3 (390 light, 390 dark, 1280 light), the probes and one interaction | 2.8 to 4.6 s |
| `preview_app` | 4 screenshots | about 2 s |

One render runs at a time per instance.

## Hosting it (estimate, not deployed)

- Image: Deno plus Playwright's WebKit and its system libraries, about 700 MB.
- Google Cloud Run in europe-north1, 2 vCPU and 2 GiB per instance, concurrency 1:
  - A 3 s render costs about $0.0002.
  - 10,000 checks and previews a month is about $2. 100,000 is about $20.
  - Scaling to zero costs nothing idle, but the first call after a quiet spell waits 4 to 6 s for WebKit to start.
  - One warm instance removes that wait for roughly $10 to $15 a month.
- Fly.io: a shared-cpu-2x machine with 2 GB, always on, is about $11 a month and handles a few hundred renders an hour.
- Either way: TLS, the shared secret, no public listing, and outbound network denied.
