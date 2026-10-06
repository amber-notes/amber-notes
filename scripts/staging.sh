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
  all) cmd_db; cmd_functions; cmd_secrets; cmd_auth; cmd_app_config; cmd_web ;;
  status) cmd_status ;;
  *) sed -n 2,17p "$0" >&2; exit 2 ;;
esac
