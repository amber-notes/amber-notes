#!/bin/sh
# Stages only what the render service needs (render.ts, server.ts, the server modules it imports
# and the libraries the app ships) and deploys it to the Railway service amber-render:
#   scripts/page-render/deploy/deploy.sh            (needs `railway login` and `railway link` once)
set -eu
root=$(cd "$(dirname "$0")/../../.." && pwd)
stage=$(mktemp -d "${TMPDIR:-/tmp}/amber-render.XXXXXX")
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/scripts/page-render" "$stage/supabase/functions/mcp" "$stage/Pane/Resources"
cp "$root/scripts/page-render/render.ts" "$root/scripts/page-render/server.ts" "$stage/scripts/page-render/"
for f in amber-base.ts data_ops.ts libraries.ts notes.ts page.ts page_input.ts; do cp "$root/supabase/functions/mcp/$f" "$stage/supabase/functions/mcp/"; done
cp -R "$root/Pane/Resources/AppLibraries" "$stage/Pane/Resources/"
mkdir -p "$stage/scripts/page-render/.libcache"
cp "$root/scripts/page-render/deploy/Dockerfile" "$root/scripts/page-render/deploy/railway.json" "$root/scripts/page-render/deploy/fonts.conf" "$stage/"
# railway links this folder to the project; the upload is the staged folder.
cd "$root/scripts/page-render/deploy"
railway up "$stage" --path-as-root --ci --service amber-render
