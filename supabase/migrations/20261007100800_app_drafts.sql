-- Note apps (prototype): an AI's save goes live on devices only when it passes the app's tests and
-- a smoke check (run by the MCP server). A version that fails is kept here as the draft the AI keeps
-- working on, with what failed (as the checks saw it over a sample of the data); page_ct stays the last version
-- that passed, so the person never gets a broken app from an AI edit. Devices read page_ct only.
alter table public.note_pages
  add column if not exists draft_ct text check (draft_ct is null or (draft_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(draft_ct) <= 4500000)),
  add column if not exists draft_problems text check (draft_problems is null or octet_length(draft_problems) <= 4000);
