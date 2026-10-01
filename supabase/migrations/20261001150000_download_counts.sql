-- Mac downloads from the website, as one total per day and product.
--
-- "Download for Mac" on ambernotes.app goes to /download/mac (web/lib/downloads.ts), which calls
-- count_download('mac') with the anon key and redirects to the DMG. Sparkle updates fetch the
-- versioned DMG directly and are never counted.
--
-- Nothing about a person is stored: no address, browser, cookie or time of day, only the date and a
-- number. anon can add one through count_download and do nothing else: it can't read, write or
-- delete the table, and can't read the view. The totals are read with the service key
-- (scripts/downloads.sh reads site_downloads_daily).

create table public.site_downloads (
  day date not null default (now() at time zone 'utc')::date,
  product text not null check (product in ('mac')),
  downloads bigint not null default 0 check (downloads >= 0),
  primary key (day, product)
);
alter table public.site_downloads enable row level security;
-- No policies: nobody reaches the rows through PostgREST except the service key, which reads them.
revoke all on table public.site_downloads from public, anon, authenticated, service_role;
grant select on table public.site_downloads to service_role;

-- Adds one to today's (UTC) total for the product. Returns nothing, so calling it reveals no count.
create function public.count_download(p_product text) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.site_downloads as d (day, product, downloads)
  values ((now() at time zone 'utc')::date, p_product, 1)
  on conflict (day, product) do update set downloads = d.downloads + 1
$$;
revoke all on function public.count_download(text) from public, anon, authenticated;
grant execute on function public.count_download(text) to anon, service_role;

-- Daily totals, newest first, with the running total for each product.
create view public.site_downloads_daily with (security_invoker = true) as
  select day, product, downloads,
         sum(downloads) over (partition by product order by day) as total
  from public.site_downloads
  order by day desc, product;
revoke all on table public.site_downloads_daily from public, anon, authenticated, service_role;
grant select on table public.site_downloads_daily to service_role;
