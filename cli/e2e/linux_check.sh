#!/bin/bash
# The Linux check, run inside a throwaway Debian 12 container with /work holding repo.tgz (a git
# archive), dist/amber-linux-x64 and dist/SHA256SUMS. Installs amber with install.sh, starts the
# local server, signs in headless (no display: amber prints the address, the "browser elsewhere"
# approves, the landed address is pasted back), uses every verb, renews the token, signs out.
set -e
(apt-get update -qq && apt-get install -y -qq ca-certificates unzip) >/dev/null 2>&1 || echo "apt failed"
curl -fsSL https://deno.land/install.sh | sh -s -- -y >/dev/null 2>&1
export PATH=/root/.deno/bin:/root/.local/bin:$PATH
mkdir -p /repo && tar -xzf /work/repo.tgz -C /repo && cd /repo/cli
echo "== $(uname -srm); $(grep PRETTY_NAME /etc/os-release | cut -d= -f2)"
deno run -A e2e/local_server.ts --port 8787 > /tmp/server.log 2>&1 &
for i in $(seq 1 120); do curl -s http://127.0.0.1:8787/__ready >/dev/null && break; sleep 1; done
export AMBER_SERVER=http://127.0.0.1:8787/mcp
echo '$ curl -fsSL <install.sh> | sh'
AMBER_DOWNLOAD_BASE=file:///work/dist sh install.sh
echo; echo '$ amber login     # no display here'
mkfifo /tmp/in
amber login < /tmp/in > /tmp/login.out 2> /tmp/login.err &
LOGIN=$!
exec 3>/tmp/in
until grep -q authorize /tmp/login.err; do sleep 0.2; done
URL=$(grep -o 'http://127.0.0.1:[0-9]*/mcp/authorize?[^ ]*' /tmp/login.err)
ADDR=$(ELSEWHERE=1 sh e2e/approve.sh "$URL")
echo "$ADDR" >&3; exec 3>&-
wait $LOGIN
cat /tmp/login.err; echo "${ADDR%%code=*}code=…"; cat /tmp/login.out
echo; set -x
stat -c '%a %n' ~/.config/amber/credentials.json
amber status
amber search milk
amber read Groceries.md
amber edit Groceries.md '- [ ] Milk' '- [x] Milk'
printf 'Made on Linux\n' | amber create Work/Linux.md
amber move Work/Linux.md Archive/
amber history Groceries.md
amber pin Archive/Linux.md
amber delete Archive/Linux.md
amber list 'Recently Deleted/'
set +x
python3 - 2>/dev/null <<'PY' || sed -i 's/"expires_at": [0-9]*/"expires_at": 1/' ~/.config/amber/credentials.json
import json,os; p=os.path.expanduser('~/.config/amber/credentials.json'); d=json.load(open(p))
for v in d.values(): v['expires_at']=1
json.dump(d,open(p,'w'))
PY
echo '(access token expiry set in the past)'
set -x
pids=""; for i in 1 2 3 4 5; do amber list Work/ > /tmp/par.$i 2>&1 & pids="$pids $!"; done
codes=""; for p in $pids; do wait $p && codes="$codes 0" || codes="$codes $?"; done
echo "exit codes:$codes"
grep -c "Work/Weekly review.md" /tmp/par.*
amber read Groceries.md --json | grep -c '"version"'
amber logout
amber list || true
set +x
echo '== any token on disk or in the output above?'
grep -rlE '(pane|amb_at|amb_rt|amb_code)_[0-9a-f]{20,}' ~/.config /tmp/login.out /tmp/login.err /tmp/par.* || echo none
