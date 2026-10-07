#!/bin/zsh
# The staging environment: a Supabase project of its own, a site on Vercel and Amber Notes Beta,
# for trying what's on `dev` without touching production (docs/Technical/staging.md).
#
#   scripts/staging.sh create          make the Supabase project "amber-staging" (paid compute, ask first)
#   scripts/staging.sh db              push every migration in this checkout
#   scripts/staging.sh functions       deploy mcp, account, account-status and share-files
#   scripts/staging.sh secrets         set the functions' secrets
#   scripts/staging.sh auth            copy production's auth settings, pointed at staging
#   scripts/staging.sh app-config      write Config/Backend.staging.local.xcconfig for the beta builds
#   scripts/staging.sh web             deploy web/ to the Vercel project amber-notes-staging
#   scripts/staging.sh seed            the test account and its sample notes
#   scripts/staging.sh lifecycle       the onboarding emails, on production's hourly schedule
#   scripts/staging.sh lifecycle-next <email> [days]
#                                      fast-forward one account: its sign-up and earlier emails move
#                                      back by days (default 3), then a round runs at once
#   scripts/staging.sh dev-app [--wait]
#                                      build Amber Notes Beta for this Mac from origin/dev and install it
#                                      as /Applications/Amber Notes Beta.app (never opens it). If it's
#                                      running, it stops before replacing it; --wait waits for it to quit
#   scripts/staging.sh all             db, functions, secrets, auth, app-config and web, in order
#   scripts/staging.sh status          what's where
#
# State lives in .secrets/staging.env in the main checkout (the project ref and its database password),
# and the test account in .secrets/staging-account.txt. Neither is ever printed.
# Production is only read, never written: the script refuses to run against its ref.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
SECRETS="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)/.secrets"
ENVF="$SECRETS/staging.env"
PROD_REF=rodegaeruhyybqilrnpn
ORG=yzmaqnfbfbxcifodipqi
REGION=eu-central-1
TEAM=emil-wagman-personal
WEB_PROJECT=amber-notes-staging
SITE=https://amber-notes-staging.vercel.app
SCHEME=ambernotes-beta
BETA_BUNDLE=dev.emilwagman.pane.beta
FUNCTIONS=(mcp account account-status share-files)

mkdir -p "$SECRETS"
[[ -f $ENVF ]] && source "$ENVF"
REF=${STAGING_REF:-}

need_ref() {
  [[ -n $REF ]] || { echo "No staging project yet: scripts/staging.sh create" >&2; exit 1; }
  [[ $REF != "$PROD_REF" ]] || { echo "That's the production project. Refusing." >&2; exit 1; }
}
save() { (umask 077; print -r -- "$1" >> "$ENVF"); }

# The Management API, with SUPABASE_ACCESS_TOKEN or the token `supabase login` keeps in the Keychain.
token() {
  if [[ -n ${SUPABASE_ACCESS_TOKEN:-} ]]; then print -r -- "$SUPABASE_ACCESS_TOKEN"; return; fi
  local t; t=$(security find-generic-password -s "Supabase CLI" -a access-token -w 2>/dev/null) || { echo "No Supabase token: supabase login" >&2; exit 1; }
  t=${t#go-keyring-base64:}; [[ $t == sbp_* ]] || t=$(print -r -- "$t" | /usr/bin/base64 -D)
  print -r -- "$t"
}
api() {  # api METHOD PATH [json body file]
  local auth="Authorization: Bearer $(token)"
  if [[ -n ${3:-} ]]; then curl -sSf -X "$1" "https://api.supabase.com$2" -H "$auth" -H "content-type: application/json" --data-binary @"$3"
  else curl -sSf -X "$1" "https://api.supabase.com$2" -H "$auth"; fi
}
keys() { supabase projects api-keys --project-ref "$REF" -o json 2>/dev/null; }
anon_key() { keys | python3 -c "import sys,json;k=json.JSONDecoder().raw_decode(sys.stdin.read())[0];print(next(x['api_key'] for x in k if x.get('name')=='anon'))"; }
service_key() { keys | python3 -c "import sys,json;k=json.JSONDecoder().raw_decode(sys.stdin.read())[0];print(next(x['api_key'] for x in k if x.get('name')=='service_role'))"; }
pooler() { api GET "/v1/projects/$REF/config/database/pooler" | python3 -c "import sys,json;p=json.load(sys.stdin);p=p[0] if isinstance(p,list) else p;print(p['db_host'])"; }
db_url() { print -r -- "postgresql://postgres.$REF:$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$STAGING_DB_PASSWORD")@$(pooler):5432/postgres"; }
url() { print -r -- "https://$REF.supabase.co"; }
mcp_url() { print -r -- "$(url)/functions/v1/mcp"; }

cmd_create() {
  if [[ -n $REF ]]; then echo "Already made: $REF"; return; fi
  local pw; pw=$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-32)
  local out; out=$(supabase projects create amber-staging --org-id "$ORG" --region "$REGION" --db-password "$pw" --size micro -o json)
  REF=$(print -r -- "$out" | python3 -c "import sys,json;d=json.JSONDecoder().raw_decode(sys.stdin.read())[0];print(d.get('id') or d.get('ref'))")
  [[ -n $REF && $REF != "$PROD_REF" ]] || { echo "Couldn't read the new project's ref." >&2; exit 1; }
  save "STAGING_REF=$REF"; save "STAGING_DB_PASSWORD='$pw'"
  echo "Made amber-staging: $REF. Waiting for it to come up…"
  until [[ $(api GET "/v1/projects/$REF" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status'))") == ACTIVE_HEALTHY ]]; do sleep 10; done
  echo "Up."
}

cmd_db() {
  need_ref
  supabase db push --db-url "$(db_url)" --include-seed=false <<< "y"
}

cmd_functions() {
  need_ref
  for f in $FUNCTIONS; do supabase functions deploy "$f" --project-ref "$REF"; done
}

cmd_secrets() {
  need_ref
  local f; f=$(mktemp); trap "rm -f '$f'" EXIT
  [[ -n ${STAGING_PROXY_SECRET:-} ]] || { STAGING_PROXY_SECRET=$(openssl rand -hex 32); save "STAGING_PROXY_SECRET=$STAGING_PROXY_SECRET"; }
  [[ -n ${STAGING_STATUS_SALT:-} ]] || { STAGING_STATUS_SALT=$(openssl rand -hex 32); save "STAGING_STATUS_SALT=$STAGING_STATUS_SALT"; }
  # The app renderer (scripts/page-render) on Railway, which production doesn't use yet.
  local render_secret; render_secret=$(cd scripts/page-render/deploy && railway variables --service amber-render --kv 2>/dev/null | sed -n 's/^RENDER_SECRET=//p')
  local render_url; render_url=https://amber-render-production.up.railway.app
  (umask 077; cat > "$f" <<EOF
AMBER_MCP_TOOLS=files
MCP_PUBLIC_URL=$(mcp_url)
MCP_ALIAS_URLS=$(mcp_url)
CONNECT_PAGE_URL=$SITE/connect
FUNCTION_REGION=$REGION
DB_POOLER_HOST=$(pooler)
MCP_PROXY_SECRET=$STAGING_PROXY_SECRET
ACCOUNT_STATUS_SALT=$STAGING_STATUS_SALT
EOF
  [[ -n $render_secret ]] && printf 'RENDER_URL=%s\nRENDER_SECRET=%s\n' "$render_url" "$render_secret" >> "$f")
  supabase secrets set --project-ref "$REF" --env-file "$f" >/dev/null
  echo "Secrets set: $(cut -d= -f1 "$f" | tr '\n' ' ')"
}

# Production's auth settings (providers, SMTP, templates, limits), read and never changed, with
# staging's addresses, the beta app's bundle id and "[Staging]" on every subject.
cmd_auth() {
  need_ref
  local prod body; prod=$(mktemp); body=$(mktemp); trap "rm -f '$prod' '$body'" EXIT
  (umask 077; api GET "/v1/projects/$PROD_REF/config/auth" > "$prod")
  python3 - "$prod" "$body" "$SITE" "$SCHEME" "$BETA_BUNDLE" <<'PY'
import json, sys
src, out, site, scheme, bundle = sys.argv[1:]
prod = json.load(open(src))
keep = ("external_apple_", "external_google_", "external_email_enabled", "mailer_", "smtp_", "password_", "rate_limit_",
        "security_", "sessions_", "jwt_exp", "refresh_token_rotation_enabled", "disable_signup", "external_anonymous_users_enabled")
skip = ("mailer_subjects_custom_contents", "mailer_templates_custom_contents")
c = {k: v for k, v in prod.items() if k.startswith(keep) and not k.startswith(skip) and v is not None}
c["site_url"] = site
c["uri_allow_list"] = f"{scheme}://auth-callback,{site}/connect**,{site}/**"
c["external_apple_client_id"] = f"app.ambernotes.signin,{bundle}"
for k, v in list(c.items()):
    if k.startswith("mailer_subjects_") and isinstance(v, str) and not v.startswith("[Staging]"):
        c[k] = "[Staging] " + v
c["smtp_sender_name"] = "Amber Notes Staging"
json.dump(c, open(out, "w"))
PY
  api PATCH "/v1/projects/$REF/config/auth" "$body" >/dev/null
  echo "Auth settings copied from production, pointed at $SITE"
}

cmd_app_config() {
  need_ref
  (umask 077; cat > Config/Backend.staging.local.xcconfig <<XC
// Written by scripts/staging.sh: the staging project, for Amber Notes Beta (Config/Beta.xcconfig). Gitignored.
PANE_SUPABASE_URL = https:/\$()/$REF.supabase.co
PANE_SUPABASE_KEY = $(anon_key)
PANE_SHARE_URL = ${SITE/https:\/\//https:/\$()/}
PANE_MCP_URL = $(mcp_url | sed 's|https://|https:/$()/|')
XC
)
  echo "Wrote Config/Backend.staging.local.xcconfig"
}

# A copy of web/ goes up, so the beta app's universal links can be swapped in without touching the
# checkout. Its own Vercel project: production's project and its variables are never touched.
cmd_web() {
  need_ref
  vercel project add "$WEB_PROJECT" --scope "$TEAM" >/dev/null 2>&1 || true
  local stage; stage=$(mktemp -d); trap "rm -rf '$stage'" EXIT
  rsync -a --exclude node_modules --exclude .next --exclude .vercel web/ "$stage/"
  python3 - "$stage/public/.well-known/apple-app-site-association" "4UM3XVUN9Y.$BETA_BUNDLE" <<'PY'
import json, sys
path, app = sys.argv[1:]
a = json.load(open(path))
for d in a.get("applinks", {}).get("details", []):
    if "appIDs" in d: d["appIDs"] = [app]
    if "appID" in d: d["appID"] = app
json.dump(a, open(path, "w"), indent=2)
PY
  # A project made from the CLI has no framework preset; without Next.js the middleware doesn't build.
  python3 -c 'import json,sys;p=sys.argv[1];v=json.load(open(p));v["framework"]="nextjs";json.dump(v,open(p,"w"),indent=2)' "$stage/vercel.json"
  [[ -n ${STAGING_REPORT_SALT:-} ]] || { STAGING_REPORT_SALT=$(openssl rand -hex 32); save "STAGING_REPORT_SALT=$STAGING_REPORT_SALT"; }
  cd "$stage"
  vercel link --yes --project "$WEB_PROJECT" --scope "$TEAM" >/dev/null
  local pairs=("SUPABASE_URL=$(url)" "SUPABASE_ANON_KEY=$(cd "$ROOT" && anon_key)" "REPORT_SALT=$STAGING_REPORT_SALT"
    "FUNCTION_REGION=$REGION" "NEXT_PUBLIC_APP_SCHEME=$SCHEME" "NEXT_PUBLIC_APP_LINK_ORIGIN=$SITE" "SITE_NOINDEX=1")
  for pair in "${pairs[@]}"; do
    local name=${pair%%=*} value=${pair#*=}
    vercel env rm "$name" production --yes --scope "$TEAM" >/dev/null 2>&1 || true
    printf '%s' "$value" | vercel env add "$name" production --scope "$TEAM" >/dev/null
  done
  local deployed; deployed=$(vercel deploy --prod --yes --scope "$TEAM" 2>/dev/null | tail -1)
  vercel alias set "$deployed" "${SITE#https://}" --scope "$TEAM" >/dev/null 2>&1 || true
  cd "$ROOT"
  echo "Site: $SITE ($deployed)"
}

# The test account, with the review account's sample notes, end-to-end encrypted like the apps do it.
cmd_seed() {
  need_ref
  local acct="$SECRETS/staging-account.txt"
  if [[ ! -s $acct ]]; then
    local email="amber-staging-$(openssl rand -hex 3)@ambernotes.app" pw; pw=$(openssl rand -base64 18 | tr -d '/+=')
    local svc; svc=$(service_key)
    curl -sSf -X POST "$(url)/auth/v1/admin/users" -H "apikey: $svc" -H "Authorization: Bearer $svc" -H "content-type: application/json" \
      -d "$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"password":sys.argv[2],"email_confirm":True}))' "$email" "$pw")" >/dev/null
    (umask 077; printf 'Staging test account (scripts/staging.sh seed)\nEmail: %s\nPassword: %s\n' "$email" "$pw" > "$acct")
  fi
  AMBER_REVIEW_SECRETS="$acct" AMBER_BACKEND_CONFIG="$ROOT/Config/Backend.staging.local.xcconfig" AMBER_MCP_URL="$(mcp_url)" \
    python3 scripts/review-account.py seed
  echo "Test account in $acct"
}

# The onboarding emails (docs/Technical/lifecycle-emails.md) as production sends them, from the same
# sender, with "[Staging] " on every subject and links to the staging site. They only ever reach
# accounts on this project. Accounts that existed before the first run (the seeded test and bench
# accounts, whose addresses nobody reads) are opted out, as if they'd pressed Stop these emails.
# LIFECYCLE_SINCE stays early so lifecycle-next can move an account's sign-up back.
cmd_lifecycle() {
  need_ref
  # A Resend API key that can send as ambernotes.app (the SMTP key in .secrets is tied to another domain).
  local key; key=$(sed -n 's/^RESEND_API_KEY=//p' ~/.config/amber-resend.env 2>/dev/null | tr -d '"')
  [[ -n $key ]] || { echo "No RESEND_API_KEY in ~/.config/amber-resend.env" >&2; exit 1; }
  # The opt-out of existing accounts happens on the first run only: later, lifecycle-next moves sign-ups back.
  local first=0
  [[ -n ${STAGING_LIFECYCLE_SINCE:-} ]] || { first=1; STAGING_LIFECYCLE_SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ); save "STAGING_LIFECYCLE_SINCE=$STAGING_LIFECYCLE_SINCE"; }
  [[ -n ${STAGING_LIFECYCLE_CRON:-} ]] || { STAGING_LIFECYCLE_CRON=$(openssl rand -hex 32); save "STAGING_LIFECYCLE_CRON=$STAGING_LIFECYCLE_CRON"; }
  [[ -n ${STAGING_LIFECYCLE_UNSUB:-} ]] || { STAGING_LIFECYCLE_UNSUB=$(openssl rand -hex 32); save "STAGING_LIFECYCLE_UNSUB=$STAGING_LIFECYCLE_UNSUB"; }
  supabase functions deploy lifecycle --project-ref "$REF"
  local f; f=$(mktemp); trap "rm -f '$f'" EXIT
  (umask 077; print -r -- "LIFECYCLE_ENABLED=true
LIFECYCLE_SINCE=2026-01-01T00:00:00Z
RESEND_LIFECYCLE_KEY=$key
LIFECYCLE_CRON_SECRET=$STAGING_LIFECYCLE_CRON
LIFECYCLE_UNSUBSCRIBE_SECRET=$STAGING_LIFECYCLE_UNSUB
LIFECYCLE_SITE=$SITE
LIFECYCLE_SUBJECT_PREFIX=\"[Staging] \"
LIFECYCLE_MANUAL_ROUNDS=true" > "$f")
  supabase secrets set --project-ref "$REF" --env-file "$f" >/dev/null
  # The hourly tick (pg_cron, already scheduled by the migration) needs pg_net and the vault's two entries.
  python3 -c '
import json, sys
out, fn, secret, since, first = sys.argv[1:]
q = f"""create extension if not exists pg_net with schema extensions;
delete from vault.secrets where name in ($$lifecycle_url$$, $$lifecycle_cron_secret$$);
select vault.create_secret($${fn}$$, $$lifecycle_url$$);
select vault.create_secret($${secret}$$, $$lifecycle_cron_secret$$);"""
if first == "1":
    q += f"""
insert into public.email_unsubscribes (user_id, source)
  select id, $$link$$ from auth.users where created_at < $${since}$$ on conflict (user_id) do nothing;"""
json.dump({"query": q}, open(out, "w"))' "$f" "$(url)/functions/v1/lifecycle" "$STAGING_LIFECYCLE_CRON" "$STAGING_LIFECYCLE_SINCE" "$first"
  api POST "/v1/projects/$REF/database/query" "$f" >/dev/null
  echo "Onboarding emails on, hourly like production, for accounts made after $STAGING_LIFECYCLE_SINCE."
}

cmd_lifecycle_next() {
  need_ref
  local email=${1:?usage: scripts/staging.sh lifecycle-next <email> [days]} days=${2:-3}
  [[ $days == <1-60> ]] || { echo "days: 1 to 60" >&2; exit 1; }
  local f; f=$(mktemp); trap "rm -f '$f'" EXIT
  python3 -c '
import json, sys
out, email, days = sys.argv[1], sys.argv[2].lower(), int(sys.argv[3])
assert "$$" not in email
q = f"""with u as (select id from auth.users where lower(email) = $${email}$$),
s as (update public.email_sends e set created_at = e.created_at - make_interval(days => {days}),
        sent_at = e.sent_at - make_interval(days => {days}) from u where e.user_id = u.id returning 1)
update auth.users a set created_at = a.created_at - make_interval(days => {days}) from u where a.id = u.id returning a.id"""
json.dump({"query": q}, open(out, "w"))' "$f" "$email" "$days"
  [[ $(api POST "/v1/projects/$REF/database/query" "$f") == *'"id"'* ]] || { echo "No account $email on staging." >&2; exit 1; }
  curl -sS -X POST "$(url)/functions/v1/lifecycle?any_hour=1" -H "x-lifecycle-secret: $STAGING_LIFECYCLE_CRON" -H "content-type: application/json" -d '{}'
  echo
}

# Amber Notes Beta for daily use on this Mac, from the tip of origin/dev, against staging. The same
# build as the Mac TestFlight beta (target Pane, Config/Beta.xcconfig: sandboxed, App Store
# entitlements) signed with the team's Apple Development certificate and an automatic provisioning
# profile. Every rebuild has the same bundle id, team and keychain group, so it keeps its container,
# its keychain items (the session and the account's key) and its device: nothing to sign in or link
# again. Built in its own clean worktree (../AmberNotes-devapp), so no work in progress goes in.
cmd_dev_app() {
  need_ref
  local wait=${1:-}
  local tree="$ROOT/../AmberNotes-devapp" dest="/Applications/Amber Notes Beta.app"
  [[ -f $ROOT/Config/Backend.staging.local.xcconfig ]] || cmd_app_config
  git -C "$ROOT" fetch -q origin dev
  [[ -d $tree ]] || git -C "$ROOT" worktree add -q --detach "$tree" origin/dev
  git -C "$tree" checkout -q -f --detach origin/dev
  cp "$ROOT/Config/Backend.staging.local.xcconfig" "$tree/Config/"
  local commit; commit=$(git -C "$tree" rev-parse --short HEAD)
  local build; build=$(date +%y%m%d%H%M)
  local dd="$tree/build/dd-devapp" app="$tree/build/dd-devapp/Build/Products/Release/Amber Notes Beta.app"
  mkdir -p "$tree/build"
  mkdir -p "$tree/build"
  (cd "$tree" && xcodegen generate >/dev/null)
  rm -rf "$app"
  echo "→ Building Amber Notes Beta $build from dev $commit"
  DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer} nice -n 10 xcodebuild \
    -project "$tree/Pane.xcodeproj" -scheme Pane -configuration Release -destination 'platform=macOS' \
    -derivedDataPath "$dd" -xcconfig "$tree/Config/Beta.xcconfig" \
    -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
    DEVELOPMENT_TEAM=4UM3XVUN9Y CODE_SIGN_STYLE=Automatic CODE_SIGN_IDENTITY="Apple Development" \
    PROVISIONING_PROFILE_SPECIFIER= CURRENT_PROJECT_VERSION="$build" build > "$tree/build/dev-app.log" 2>&1 \
    || { grep -E ' error: ' "$tree/build/dev-app.log" | head; echo "Build failed: $tree/build/dev-app.log" >&2; exit 1; }
  # Every piece of code in the app signed by the same team, or the app won't start.
  codesign --verify --deep --strict "$app"
  local teams; teams=$({ print -r -- "$app"; find "$app/Contents" \( -name '*.app' -o -name '*.appex' -o -name '*.framework' -o -name '*.dylib' -o -name '*.xpc' \); } \
    | while IFS= read -r c; do codesign -dv "$c" 2>&1 | sed -n 's/^TeamIdentifier=//p'; done | sort -u | tr '\n' ' ')
  [[ $teams == "4UM3XVUN9Y " ]] || { echo "Signed by more than one team: $teams" >&2; exit 1; }
  if pgrep -f "^$dest/Contents/MacOS/" >/dev/null; then
    if [[ $wait != --wait ]]; then
      echo "Amber Notes Beta is open. Quit it and run this again (or pass --wait). Built: $app"
      exit 3
    fi
    echo "→ Waiting for Amber Notes Beta to quit"
    while pgrep -f "^$dest/Contents/MacOS/" >/dev/null; do sleep 5; done
  fi
  # TestFlight installs its copy as root, which this can't replace: it goes to the Trash by hand.
  if [[ -e $dest && ! -O $dest ]]; then
    echo "$dest belongs to $(stat -f %Su "$dest") (TestFlight installs it that way). Move it to the Trash in Finder, then run this again. Built: $app" >&2
    exit 4
  fi
  rm -rf "$dest"
  ditto "$app" "$dest"
  echo "✓ Installed $dest: build $build from dev $commit ($(codesign -dvv "$dest" 2>&1 | sed -n 's/^Authority=//p' | head -1)). Not opened."
}

cmd_status() {
  echo "Supabase   ${REF:-not made} $( [[ -n $REF ]] && url)"
  echo "MCP        $( [[ -n $REF ]] && mcp_url)"
  echo "Site       $SITE"
  echo "App config $( [[ -f Config/Backend.staging.local.xcconfig ]] && echo written || echo missing)"
  echo "Account    $( [[ -s $SECRETS/staging-account.txt ]] && echo "in $SECRETS/staging-account.txt" || echo none)"
}

case ${1:-status} in
  create) cmd_create ;;
  db) cmd_db ;;
  functions) cmd_functions ;;
  secrets) cmd_secrets ;;
  auth) cmd_auth ;;
  app-config) cmd_app_config ;;
  web) cmd_web ;;
  seed) cmd_seed ;;
  lifecycle) cmd_lifecycle ;;
  lifecycle-next) shift; cmd_lifecycle_next "$@" ;;
  dev-app) shift; cmd_dev_app "$@" ;;
  all) cmd_db; cmd_functions; cmd_secrets; cmd_auth; cmd_app_config; cmd_web ;;
  status) cmd_status ;;
  *) sed -n 2,25p "$0" >&2; exit 2 ;;
esac
