#!/bin/zsh
# Prints the JSON body that sets what the production project's account emails say, for
# PATCH https://api.supabase.com/v1/projects/<ref>/config/auth (docs/Technical/auth-emails.md):
# the site URL their links open, the sender name, and all seven subjects and templates.
#   scripts/auth-email-config.sh > /tmp/auth-email.json
# With --setup it adds what a project needs the first time (docs/Technical/password-reset.md): SMTP
# through Resend, the sender address, the limits, and the "password changed" notice turned on.
#   scripts/auth-email-config.sh --setup > /tmp/auth-email.json
# It sends nothing and reads no secret: the SMTP password is passed in by whoever applies it.
# The words are in scripts/auth-emails.ts; the sender is in supabase/functions/_shared/sender.ts.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" == "--setup" ]]; then
  deno run --allow-read scripts/auth-emails.ts config setup
else
  deno run --allow-read scripts/auth-emails.ts config
fi
