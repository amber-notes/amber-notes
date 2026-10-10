-- The MCP file tools' word index, per account, in 64 shards: for each note, its version, the words
-- in its text and the files it shows (id and name), so search reads these boxes and opens only the
-- notes that can match, and a glob finds notes' files. Each shard is sealed with the account's key
-- (context "word-index:<user id>:<shard>", gzip inside); the server can't read it. Rebuilt from the
-- notes as searches open them.
create table public.mcp_word_index (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  shard smallint not null check (shard between 0 and 63),
  shard_ct text not null check (shard_ct ~ '^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$' and octet_length(shard_ct) <= 20000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, shard)
);

alter table public.mcp_word_index enable row level security;
create policy "own word index" on public.mcp_word_index for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke all on public.mcp_word_index from anon;
grant select, insert, update, delete on public.mcp_word_index to authenticated;
