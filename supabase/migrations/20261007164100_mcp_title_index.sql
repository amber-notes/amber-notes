-- The MCP file tools' path index, per account: every note's title and every folder's name, sealed
-- with the account's key as one box (context "title-index:<user id>"), with each note's version, so
-- a call opens one box and only the titles that changed instead of every note's head. Like any
-- sealed column, the server can't read it; it's rebuilt from the notes whenever it's missing or stale.
create table public.mcp_title_index (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  index_ct text not null check (index_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(index_ct) <= 20000000),
  updated_at timestamptz not null default now()
);

alter table public.mcp_title_index enable row level security;
create policy "own title index" on public.mcp_title_index for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke all on public.mcp_title_index from anon;
grant select, insert, update, delete on public.mcp_title_index to authenticated;
