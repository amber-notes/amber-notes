-- Note apps: an AI's new version that failed its tests or smoke check is kept as a draft and never
-- runs; page_ct stays the last version that passed. The AI keeps working on the draft (the MCP
-- file tools read it while there is one); a passing save makes it the page and clears the draft.
--   draft_ct: sealed like page_ct (context "page:<note id>"), the same project format.
--   draft_problems: what failed, written by the MCP server: test and check names only, never any
--   note content or data.
alter table public.note_pages
  add column draft_ct text check (draft_ct is null or (draft_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(draft_ct) <= 4500000)),
  add column draft_problems text check (draft_problems is null or char_length(draft_problems) <= 4000);

-- A device that couldn't open the live version (a script error, or nothing drawn in 8 seconds)
-- went back to an earlier one and says so here, for the AI's next look at the app. The error
-- message only (as the web view reports it), never the app's data.
create table public.app_load_failures (
  id bigint generated always as identity primary key,
  note_id uuid not null references public.notes (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message text not null check (char_length(message) <= 1000),
  -- Which device: iPhone, iPad or Mac.
  device text check (device is null or char_length(device) <= 40),
  at timestamptz not null default now()
);
create index app_load_failures_note on public.app_load_failures (note_id, at desc);

alter table public.app_load_failures enable row level security;
create policy "own load failures" on public.app_load_failures for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.notes n where n.id = note_id and n.user_id = (select auth.uid())));
revoke all on public.app_load_failures from anon;
