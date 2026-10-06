#!/bin/sh
# A stand-in browser for scripted runs (AMBER_BROWSER=e2e/approve.sh): follows /authorize to the
# connect page, presses Allow (or Don't Allow with APPROVE=0), and follows the redirect back to
# amber's loopback address, as a browser would. With ELSEWHERE=1 it stops before that last step and
# prints the address instead, like a browser on another machine whose 127.0.0.1 isn't amber's.
set -e
connect=$(curl -s -o /dev/null -w '%{redirect_url}' "$1")
id=${connect##*request=}
origin=$(printf '%s' "$connect" | sed -E 's#^(https?://[^/]+).*#\1#')
back=$(curl -s -o /dev/null -w '%{redirect_url}' --data "id=$id&allow=${APPROVE:-1}&write=1" "$origin/connect/answer")
if [ "${ELSEWHERE:-0}" = 1 ]; then printf '%s\n' "$back"; else curl -s -o /dev/null "$back"; fi
