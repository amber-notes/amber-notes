-- Add a device: a signed-in device without the account's key gets it from one that has it, sealed
-- so the server never holds it in the clear (docs/Evidence/add-device-threat-model.md).
--
-- The new device makes a key pair and two pairing secrets (a QR code and a typed code) and files a
-- request with hashes of what those secrets derive. A device with the key reads one of the
-- secrets from the new device's screen, inside the app, finds the request with it, checks the
-- new device's public key against it, and stores the key sealed to that public key. The new
-- device picks it up once.
--
-- Stricter than connecting an AI, because this hands over the whole key:
--   * same account only: every function works on rows of auth.uid() and nothing else
--   * a request is answered once, expires after 5 minutes, and dies after 5 wrong answers
--   * what's stored is ciphertext for the new device, handed only to its pickup secret, and
--     deleted when that device has it (within the hour otherwise)
--   * requests, lookups and answers are rate-limited per account

create table public.device_adds (
  -- Made by the new device: its tags name the request.
  id           uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- The new device's own random id, kept in a Keychain item that stays on it (not the install id
  -- pane_devices counts with).
  device_id    uuid not null,
  platform     text not null check (platform in ('ios', 'macos')),
  -- P-256, raw uncompressed (65 bytes), base64.
  public_key   text not null check (public_key ~ '^B[A-Za-z0-9+/]{86}=$'),
  -- The account's key when the request was made: an answer is for that key only.
  key_id       text not null check (key_id ~ '^[0-9a-f]{16}$'),
  -- Per pairing secret: SHA-256 of the answer it derives, the tag that vouches for the public
  -- key and kind above, and the device's name sealed under the secret (amb2n). The server can
  -- check neither tag and read neither name.
  scan_hash    text not null check (scan_hash ~ '^[0-9a-f]{64}$'),
  scan_tag     text not null check (scan_tag ~ '^[0-9a-f]{64}$'),
  scan_name    text not null check (scan_name ~ '^amb2n\.[A-Za-z0-9+/]+={0,2}$' and char_length(scan_name) <= 400),
  code_hash    text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  code_tag     text not null check (code_tag ~ '^[0-9a-f]{64}$'),
  code_name    text not null check (code_name ~ '^amb2n\.[A-Za-z0-9+/]+={0,2}$' and char_length(code_name) <= 400),
  -- SHA-256 of the secret the new device collects the answer with.
  pickup_hash  text not null check (pickup_hash ~ '^[0-9a-f]{64}$'),
  attempts     integer not null default 0,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '5 minutes',
  answered_at  timestamptz,
  -- The id of the device that answered.
  answered_by  uuid,
  via          text check (via in ('scan', 'code')),
  -- The key sealed to public_key (amb2d): 65 + 12 + 53 + 16 bytes. Gone once the new device
  -- says it has it, or with the row.
  sealed       text check (sealed ~ '^amb2d\.[A-Za-z0-9+/]{195}=$'),
  picked_up_at timestamptz
);
create index device_adds_user on public.device_adds (user_id, created_at);
create unique index device_adds_scan on public.device_adds (scan_hash);
create unique index device_adds_code on public.device_adds (code_hash);
alter table public.device_adds enable row level security;
-- No policies: only the functions below read or write it.
revoke all on public.device_adds from anon, authenticated;

-- A token bucket per account (pane_rate), for the functions here. A refused take is rolled back
-- with the statement, so being refused doesn't cost a token.
create or replace function public.pane_device_take(p_bucket text, p_cap double precision, p_per_second double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare
  left_over double precision;
begin
  insert into public.pane_rate as r (user_id, bucket, tokens, at)
  values (auth.uid(), p_bucket, p_cap - 1, clock_timestamp())
  on conflict (user_id, bucket) do update
    set tokens = least(p_cap, r.tokens + extract(epoch from clock_timestamp() - r.at) * p_per_second) - 1,
        at = clock_timestamp()
  returning tokens into left_over;
  if left_over < 0 then
    raise exception 'Too many attempts. Wait a few minutes and try again.' using errcode = 'PT429', hint = 'rate_limited';
  end if;
end $$;
revoke all on function public.pane_device_take(text, double precision, double precision) from public, anon, authenticated;

create or replace function public.pane_sha256_hex(p_hex text) returns text
language sql immutable set search_path = '' as $$ select encode(sha256(decode(p_hex, 'hex')), 'hex') $$;

-- The new device files its request. One live request per new device: a newer one replaces it.
-- At most 10 per account in 10 minutes. Returns when it expires.
create or replace function public.device_add_request(
  p_id uuid, p_device uuid, p_platform text, p_public_key text,
  p_scan_hash text, p_scan_tag text, p_scan_name text, p_code_hash text, p_code_tag text, p_code_name text, p_pickup_hash text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  k text;
  ends timestamptz;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select key_id into k from public.account_keys where user_id = uid;
  if k is null then raise exception 'This account has no key yet.' using errcode = '22023', hint = 'no_key'; end if;
  perform public.pane_device_take('device-add', 10, 1.0 / 60);
  delete from public.device_adds where expires_at < now() - interval '30 minutes';
  delete from public.device_adds where user_id = uid and device_id = p_device;
  insert into public.device_adds (id, user_id, device_id, platform, public_key, key_id,
                                  scan_hash, scan_tag, scan_name, code_hash, code_tag, code_name, pickup_hash)
  values (p_id, uid, p_device, p_platform, p_public_key, k,
          p_scan_hash, p_scan_tag, p_scan_name, p_code_hash, p_code_tag, p_code_name, p_pickup_hash)
  returning expires_at into ends;
  return ends;
end $$;
revoke all on function public.device_add_request(uuid, uuid, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.device_add_request(uuid, uuid, text, text, text, text, text, text, text, text, text) to authenticated;

-- A device with the key read a pairing secret: the request it belongs to, if it's this account's
-- and still open. Another account's code finds nothing. The tag and the sealed name returned are
-- the ones for the secret that was read; the device checks the tag against the public key before
-- it seals anything.
create or replace function public.device_add_find(p_answer text)
returns table (id uuid, device_id uuid, platform text, name text, public_key text, tag text, via text,
               created_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  h text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_answer is null or p_answer !~ '^[0-9a-f]{64}$' then return; end if;
  perform public.pane_device_take('device-add-answer', 20, 1.0 / 30);
  h := public.pane_sha256_hex(p_answer);
  return query
    select a.id, a.device_id, a.platform,
           case when a.scan_hash = h then a.scan_name else a.code_name end, a.public_key,
           case when a.scan_hash = h then a.scan_tag else a.code_tag end,
           case when a.scan_hash = h then 'scan' else 'code' end,
           a.created_at, a.expires_at
    from public.device_adds a
    where a.user_id = uid and (a.scan_hash = h or a.code_hash = h)
      and a.answered_at is null and a.expires_at > now() and a.attempts < 5;
end $$;
revoke all on function public.device_add_find(text) from public, anon;
grant execute on function public.device_add_find(text) to authenticated;

-- The answer: the key sealed to the new device. Once per request, for this account's request
-- only, with the pairing secret's answer, while the account's key is the one the request was
-- made for. 'added', 'wrong' (counted: five and the request is over) or 'expired'. Every device
-- of the account is told a device was added.
create or replace function public.device_add_answer(p_id uuid, p_answer text, p_sealed text, p_device uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.device_adds;
  h text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform public.pane_device_take('device-add-answer', 20, 1.0 / 30);
  select * into r from public.device_adds where id = p_id and user_id = uid for update;
  if not found or r.answered_at is not null or r.expires_at <= now() or r.attempts >= 5 then return 'expired'; end if;
  if r.key_id is distinct from (select key_id from public.account_keys where user_id = uid) then
    delete from public.device_adds where id = p_id;
    return 'expired';
  end if;
  if p_answer is null or p_answer !~ '^[0-9a-f]{64}$' then
    update public.device_adds set attempts = attempts + 1 where id = p_id;
    return 'wrong';
  end if;
  h := public.pane_sha256_hex(p_answer);
  if h <> r.scan_hash and h <> r.code_hash then
    update public.device_adds set attempts = attempts + 1 where id = p_id;
    return 'wrong';
  end if;
  update public.device_adds
    set answered_at = now(), answered_by = p_device, sealed = p_sealed,
        via = case when h = r.scan_hash then 'scan' else 'code' end
    where id = p_id;
  insert into public.account_notices (user_id, kind, what) values (uid, 'device_added', 'A device was added');
  return 'added';
end $$;
revoke all on function public.device_add_answer(uuid, text, text, uuid) from public, anon;
grant execute on function public.device_add_answer(uuid, text, text, uuid) to authenticated;

-- The new device asks whether it was answered, with its pickup secret. The sealed key is handed
-- only to that secret, and stays until the device says it has it (device_add_done), so an answer
-- lost on the way can be asked for again. {state: waiting | answered | taken | expired | gone,
-- sealed, via}.
create or replace function public.device_add_pickup(p_id uuid, p_pickup text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.device_adds;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_pickup is null or p_pickup !~ '^[0-9a-f]{64}$' then return jsonb_build_object('state', 'gone'); end if;
  select * into r from public.device_adds where id = p_id and user_id = uid;
  if not found or r.pickup_hash <> public.pane_sha256_hex(p_pickup) then return jsonb_build_object('state', 'gone'); end if;
  if r.answered_at is not null then
    if r.sealed is null then return jsonb_build_object('state', 'taken'); end if;
    return jsonb_build_object('state', 'answered', 'sealed', r.sealed, 'via', r.via);
  end if;
  if r.expires_at <= now() or r.attempts >= 5 then return jsonb_build_object('state', 'expired'); end if;
  return jsonb_build_object('state', 'waiting');
end $$;
revoke all on function public.device_add_pickup(uuid, text) from public, anon;
grant execute on function public.device_add_pickup(uuid, text) to authenticated;

-- The new device has the key (or gave up on this answer): the sealed copy goes now.
create or replace function public.device_add_done(p_id uuid, p_pickup text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_pickup is null or p_pickup !~ '^[0-9a-f]{64}$' then return; end if;
  update public.device_adds set sealed = null, picked_up_at = now()
    where id = p_id and user_id = auth.uid() and pickup_hash = public.pane_sha256_hex(p_pickup) and answered_at is not null;
end $$;
revoke all on function public.device_add_done(uuid, text) from public, anon;
grant execute on function public.device_add_done(uuid, text) to authenticated;

-- "A device was added" joins the things every device says.
alter table public.account_notices drop constraint account_notices_kind_check;
alter table public.account_notices add constraint account_notices_kind_check
  check (kind in ('ai_connected', 'started_fresh', 'wrong_number', 'device_added'));

-- MARK: Where the key is kept
--
-- Each device that holds the key lists itself, so Privacy & Security can show where the key is
-- kept and say so when it's on one device only. The server can't tell who holds the key: a row
-- counts in the apps only when its tag (an HMAC under a subkey of the key) verifies, and a
-- removal only when its removal tag does. So someone who has the password but not the key can
-- neither add a device to the list nor make a device throw its key away.
create table public.key_devices (
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- The device's own random id (see device_adds.device_id).
  device_id   uuid not null,
  platform    text not null check (platform in ('ios', 'macos')),
  -- How the key got there: made on it, brought by iCloud Keychain, added from another device,
  -- or opened with the recovery key. Unknown: it had the key before it first listed itself.
  how         text not null check (how in ('made', 'keychain', 'added', 'recovery', 'unknown')),
  -- The device keeps the key as an iCloud Keychain item (which syncs when iCloud Keychain is on).
  backed_up   boolean not null,
  key_id      text not null check (key_id ~ '^[0-9a-f]{16}$'),
  -- Made by the device each time it comes to hold the key. Its tag and any removal name it, so a
  -- removal from before the device was added again doesn't count.
  epoch       text not null check (epoch ~ '^[0-9a-f]{32}$'),
  -- The device's name, sealed with the account's key like a folder's name.
  name_ct     text not null check (char_length(name_ct) <= 400),
  tag         text not null check (tag ~ '^[0-9a-f]{64}$'),
  added_at    timestamptz not null default now(),
  seen_at     timestamptz not null default now(),
  -- Removed from another device: this one drops its key the next time it looks.
  removed_at  timestamptz,
  removal_tag text check (removal_tag ~ '^[0-9a-f]{64}$'),
  primary key (user_id, device_id),
  constraint key_devices_removal check ((removed_at is null) = (removal_tag is null)),
  constraint key_devices_name_sealed check (name_ct ~ ('^amb2\.' || key_id || '\.[A-Za-z0-9+/]+={0,2}$'))
);
alter table public.key_devices enable row level security;
create policy "own key devices read" on public.key_devices for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.key_devices from anon;
revoke insert, update, delete, truncate on public.key_devices from authenticated;
grant select on public.key_devices to authenticated;

-- A device with the key says so, when it gets the key and each time it opens. Rows for a key the
-- account no longer has go (it started fresh). At most 20 devices: the longest unseen goes.
-- Checking in again clears a removal: the device got the key again.
create or replace function public.key_device_check_in(
  p_device uuid, p_platform text, p_name_ct text, p_how text, p_backed_up boolean, p_key_id text, p_epoch text, p_tag text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_key_id is distinct from (select key_id from public.account_keys where user_id = uid) then
    raise exception 'That key isn''t this account''s.' using errcode = '22023', hint = 'stale_key';
  end if;
  perform public.pane_device_take('device-list', 60, 0.1);
  delete from public.key_devices where user_id = uid and key_id <> p_key_id;
  insert into public.key_devices as d (user_id, device_id, platform, name_ct, how, backed_up, key_id, epoch, tag)
  values (uid, p_device, p_platform, p_name_ct, p_how, p_backed_up, p_key_id, p_epoch, p_tag)
  on conflict (user_id, device_id) do update
    set platform = excluded.platform, name_ct = excluded.name_ct, how = excluded.how, backed_up = excluded.backed_up,
        key_id = excluded.key_id, epoch = excluded.epoch, tag = excluded.tag, seen_at = now(), removed_at = null, removal_tag = null,
        added_at = case when d.removed_at is null then d.added_at else now() end;
  delete from public.key_devices
    where user_id = uid and device_id in (
      select device_id from public.key_devices where user_id = uid order by seen_at desc, device_id offset 20);
end $$;
revoke all on function public.key_device_check_in(uuid, text, text, text, boolean, text, text, text) from public, anon;
grant execute on function public.key_device_check_in(uuid, text, text, text, boolean, text, text, text) to authenticated;

-- Remove a device, from another one that has the key (the tag proves that to the device being
-- removed). A removal already there is replaced, so one written without the key can't block a
-- real one. True when there was such a device.
create or replace function public.remove_key_device(p_device uuid, p_removal_tag text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform public.pane_device_take('device-list', 60, 0.1);
  update public.key_devices set removed_at = now(), removal_tag = p_removal_tag
    where user_id = uid and device_id = p_device;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.remove_key_device(uuid, text) from public, anon;
grant execute on function public.remove_key_device(uuid, text) to authenticated;

-- The removed device has dropped its key (or a device signs its key away): its row goes.
create or replace function public.forget_key_device(p_device uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.key_devices where user_id = auth.uid() and device_id = p_device;
$$;
revoke all on function public.forget_key_device(uuid) from public, anon;
grant execute on function public.forget_key_device(uuid) to authenticated;

-- MARK: Forgetting
--
-- A request is over five minutes after it's made; an answer the new device never confirmed is
-- ciphertext only that device could open, and goes within the hour (every 15 minutes, whatever
-- ended 30 minutes ago). A device not seen for a year leaves the list.
create or replace function public.pane_forget_device_adds() returns void
language sql security definer set search_path = '' as $$
  delete from public.device_adds where expires_at < now() - interval '30 minutes';
  delete from public.key_devices where seen_at < now() - interval '12 months';
$$;
revoke all on function public.pane_forget_device_adds() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('amber-forget-device-adds', '*/15 * * * *', 'select public.pane_forget_device_adds()');
  end if;
end $$;
