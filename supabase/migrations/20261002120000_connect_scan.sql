-- Connecting by scanning: the connect page shows a QR code instead of asking you to sign in. The
-- code holds the request, a one-time scan secret and the SHA-256 of the page's key. The ask has no
-- account until a device that scanned the code answers it with the secret; no device sees it
-- before then (the read policy is by account). Signing in on the page for a notification instead
-- still makes an account's ask with number matching.
alter table public.connect_asks alter column user_id drop not null;
alter table public.connect_asks alter column match_commit drop not null;
alter table public.connect_asks add column scan_hash text check (scan_hash ~ '^[0-9a-f]{64}$');
alter table public.connect_asks add constraint connect_asks_scan_or_account
  check (scan_hash is not null or (user_id is not null and match_commit is not null));
