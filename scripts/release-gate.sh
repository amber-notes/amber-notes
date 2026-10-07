#!/bin/zsh
# The release gate: performance, security, storage and network of one commit, measured the way people
# run it, written to docs/Evidence/release-gate/<date>-<ref>.md (docs/Technical/release-gate.md).
#
#   scripts/release-gate.sh <candidate ref> [--baseline <last release ref>]
#       [--sizes 1,2000,20000] [--runs 3] [--only perf,security,storage,network] [--rebuild] [--host fleet-air]
#       [--reuse-perf] [--rescore <report.json>]
#
# Exits 0 when it passes. Needs: Xcode with the team's Apple ID, .secrets/staging.env, a
# `supabase login`, Config/Backend.staging.local.xcconfig (scripts/staging.sh app-config), gitleaks,
# pnpm, deno, and ssh to a Mac with nobody using Amber Notes Beta on it (fleet-air by default).
set -euo pipefail
cd "$(dirname "$0")/.."
exec deno run -A scripts/release-gate/gate.ts "$@"
