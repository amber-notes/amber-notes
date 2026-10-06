#!/bin/bash
# The Linux check: run inside a throwaway Debian 12 container (on the fleet Windows box's Docker,
# WSL2 kernel), with /work holding amber-linux-x64, check.sh and a git archive of the repo.
# Runs inside a throwaway debian:bookworm-slim container: the local MCP server harness, and the
# linux-x64 binary against it.
set -e
(apt-get update -qq && apt-get install -y -qq ca-certificates unzip) >/dev/null 2>&1 || echo "apt failed"
curl -fsSL https://deno.land/install.sh | sh -s -- -y >/dev/null 2>&1
export PATH=/root/.deno/bin:$PATH
mkdir -p /repo && tar -xzf /work/repo.tgz -C /repo
echo "== $(uname -srm); $(grep PRETTY_NAME /etc/os-release | cut -d= -f2)"
cd /repo/cli
deno run -A e2e/local_server.ts --port 8787 --token-file /tmp/tok > /tmp/server.log 2>&1 &
for i in $(seq 1 120); do curl -s http://127.0.0.1:8787/__ready >/dev/null && break; sleep 1; done
B=/work/amber-linux-x64
chmod +x $B
set -x
$B --version
export XDG_CONFIG_HOME=/tmp/cfg
$B login --server http://127.0.0.1:8787/mcp < /tmp/tok
stat -c '%a %n' /tmp/cfg/amber/config.json
$B pull /tmp/notes
(cd /tmp/notes && find . -name '*.md' | sort)
sed -i 's/- \[ \] Butter/- [x] Butter/' /tmp/notes/Groceries.md
printf 'Made on Linux\n\nHello from the server.\n' > /tmp/notes/Work/Linux.md
$B sync /tmp/notes
$B status /tmp/notes
rm -rf /tmp/notes2 && $B pull /tmp/notes2
grep -n "Butter" /tmp/notes2/Groceries.md
cat /tmp/notes2/Work/Linux.md
$B sync /tmp/notes2
set +x
echo '== classic tools'
deno run -A e2e/local_server.ts --port 8788 --token-file /tmp/tok2 --classic > /tmp/server2.log 2>&1 &
for i in $(seq 1 120); do curl -s http://127.0.0.1:8788/__ready >/dev/null && break; sleep 1; done
export AMBER_TOKEN=$(cat /tmp/tok2)
set -x
$B pull /tmp/classic --server http://127.0.0.1:8788/mcp
sed -i 's/- \[ \] Milk/- [x] Milk/' /tmp/classic/Groceries.md
$B sync /tmp/classic --server http://127.0.0.1:8788/mcp
rm -rf /tmp/classic2
$B pull /tmp/classic2 --server http://127.0.0.1:8788/mcp --quiet
grep -n Milk /tmp/classic2/Groceries.md
set +x
echo '== token in any output or synced file?'
for t in /tmp/tok /tmp/tok2; do grep -rl "$(cat $t)" /tmp/notes /tmp/notes2 /tmp/classic /tmp/classic2 || echo none; done
