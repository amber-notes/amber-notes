-- Note pages (prototype): the names of the API keys a person has set up for apps in their notes,
-- so an AI can tell them which key an app needs. Never the values: those stay in the Keychain on
-- the person's devices. Sealed like everything else (context "api-key:<id>"):
--   {"name": "OpenWeather", "hosts": ["api.openweathermap.org"], "set": true}
create table public.api_key_names (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  meta_ct text not null check (meta_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(meta_ct) <= 4000),
  updated_at timestamptz not null default now()
);
alter table public.api_key_names enable row level security;
create policy "own api key names" on public.api_key_names for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.api_key_names from anon;
