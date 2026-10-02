#!/bin/zsh
# Prints the JSON body that sets the production project's reset email and the "password changed"
# notice, for
# PATCH https://api.supabase.com/v1/projects/<ref>/config/auth (docs/Technical/password-reset.md).
# It sends nothing and reads no secret: the SMTP password is passed in by whoever applies it.
#   scripts/auth-email-config.sh > /tmp/auth-email.json
set -euo pipefail
cd "$(dirname "$0")/.."
jq -n --rawfile recovery supabase/templates/recovery.html --rawfile changed supabase/templates/password_changed.html '{
  site_url: "https://ambernotes.app",
  mailer_subjects_recovery: "Reset your Amber Notes password",
  mailer_templates_recovery_content: $recovery,
  mailer_otp_exp: 3600,
  mailer_notifications_password_changed_enabled: true,
  mailer_subjects_password_changed_notification: "Your Amber Notes password was changed",
  mailer_templates_password_changed_notification_content: $changed,
  smtp_max_frequency: 60,
  smtp_host: "smtp.resend.com",
  smtp_port: "465",
  smtp_user: "resend",
  smtp_admin_email: "hello@ambernotes.app",
  smtp_sender_name: "Amber Notes",
  rate_limit_email_sent: 30
}'
