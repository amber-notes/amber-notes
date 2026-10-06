-- What an AI connection has read, so the MCP file tools can refuse an edit to something it hasn't
-- read, or that changed since it read it (like a coding agent's read-before-edit rule).
--   session: the client's Mcp-Session-Id, or a hash of its token when it sends none.
--   item: what was read ("note:<id>", "file:<note id>:/src/App.tsx", "data:<note id>").
--   stamp: the version read (a note's version, or a hash of the file's text). Never content.
-- Rows older than a day are never used, and are removed as new ones are written.
create table public.mcp_reads (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session text not null check (char_length(session) between 1 and 100),
  item text not null check (char_length(item) <= 600),
  stamp text not null check (char_length(stamp) <= 100),
  read_at timestamptz not null default now(),
  primary key (user_id, session, item)
);
create index mcp_reads_age on public.mcp_reads (user_id, read_at);

alter table public.mcp_reads enable row level security;
create policy "own reads" on public.mcp_reads for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke all on public.mcp_reads from anon;
grant select, insert, update, delete on public.mcp_reads to authenticated;
