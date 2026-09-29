-- Reporting shared pages (App Store Review Guideline 1.2: user content that anyone can see
-- needs a way to report it and a way to take it down).
--
-- Anyone viewing a shared page can report it. Reports are stored for review; once three
-- different people have reported the same live link, the link is taken down automatically
-- (revoked, exactly like the owner pressing Stop Sharing). The owner can share the note
-- again, which makes a new link; the admin can dismiss reports or take a link down by hand:
--
--   select * from public.share_reports where status = 'open' order by created_at desc;
--   select public.admin_take_down('<slug>');      -- revoke now, mark its reports actioned
--   select public.admin_dismiss_reports('<slug>'); -- keep it up, mark its reports dismissed
--
-- Both admin functions are only callable with the service role or from the SQL editor.

create table public.share_reports (
  id          bigint generated always as identity primary key,
  slug        text not null,
  reason      text not null check (char_length(reason) between 1 and 1000),
  contact     text check (contact is null or char_length(contact) <= 200),
  -- A salted hash of who reported (the site sends a hash of the visitor's address), so three
  -- reports from one person don't take a page down. Never the address itself.
  reporter    text not null check (reporter ~ '^[0-9a-f]{64}$'),
  status      text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at  timestamptz not null default now()
);
create index share_reports_slug on public.share_reports (slug, status);
create index share_reports_reporter on public.share_reports (reporter, created_at);

alter table public.share_reports enable row level security;
-- No policies: nobody reads or writes the table directly. Reports come in through the RPC.
revoke all on public.share_reports from anon, authenticated;

create or replace function public.report_share(p_slug text, p_reason text, p_reporter text, p_contact text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.note_shares;
  why text := btrim(coalesce(p_reason, ''));
  who text := lower(btrim(coalesce(p_reporter, '')));
  reach text := nullif(btrim(coalesce(p_contact, '')), '');
  distinct_reporters int;
begin
  if p_slug is null or p_slug !~ '^[A-Za-z0-9_-]{24,64}$' then return 'not_found'; end if;
  if why = '' then raise exception 'Say what is wrong with this page.' using errcode = '22023'; end if;
  if char_length(why) > 1000 then why := left(why, 1000); end if;
  if reach is not null and char_length(reach) > 200 then reach := left(reach, 200); end if;
  if who !~ '^[0-9a-f]{64}$' then raise exception 'Invalid report.' using errcode = '22023'; end if;

  -- One person: at most 5 reports an hour. One page: at most 50 reports a day.
  if (select count(*) from public.share_reports r where r.reporter = who and r.created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.share_reports r where r.slug = p_slug and r.created_at > now() - interval '1 day') >= 50 then
    raise exception 'Too many reports. Try again later.' using errcode = 'P0429';
  end if;

  select * into s from public.note_shares where slug = p_slug and revoked_at is null;
  if not found then return 'not_found'; end if;

  -- The same person reporting the same page again only counts once.
  if exists (select 1 from public.share_reports r where r.slug = p_slug and r.reporter = who and r.status = 'open') then
    return 'received';
  end if;

  insert into public.share_reports (slug, reason, contact, reporter)
    values (p_slug, why, reach, who);

  select count(distinct r.reporter) into distinct_reporters
    from public.share_reports r where r.slug = p_slug and r.status = 'open';
  if distinct_reporters >= 3 then
    update public.note_shares set revoked_at = now() where slug = s.slug and revoked_at is null;
    return 'taken_down';
  end if;
  return 'received';
end $$;

revoke all on function public.report_share(text, text, text, text) from public;
grant execute on function public.report_share(text, text, text, text) to anon, authenticated;

create or replace function public.admin_take_down(p_slug text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.note_shares set revoked_at = now() where slug = p_slug and revoked_at is null;
  get diagnostics n = row_count;
  update public.share_reports set status = 'actioned' where slug = p_slug and status = 'open';
  return n > 0;
end $$;

create or replace function public.admin_dismiss_reports(p_slug text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.share_reports set status = 'dismissed' where slug = p_slug and status = 'open';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.admin_take_down(text) from public, anon, authenticated;
revoke all on function public.admin_dismiss_reports(text) from public, anon, authenticated;
