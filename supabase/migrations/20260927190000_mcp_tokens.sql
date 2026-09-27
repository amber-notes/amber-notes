-- Access tokens for AI clients (Claude, ChatGPT, Claude Code, Codex).
-- Only a SHA-256 hash is stored; the token is shown once when created.

create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  token_hash text not null unique,
  can_write boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.mcp_tokens enable row level security;

create policy "own tokens read" on public.mcp_tokens for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own tokens revoke" on public.mcp_tokens for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.mcp_tokens from anon;
revoke insert, delete on public.mcp_tokens from authenticated;
grant select, update (revoked_at, name) on public.mcp_tokens to authenticated;

-- Creates a token for the signed-in user and returns it once.
create or replace function public.create_mcp_token(token_name text, write_access boolean default true)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  raw text := 'pane_' || encode(extensions.gen_random_bytes(32), 'hex');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.mcp_tokens (user_id, name, token_hash, can_write)
  values (auth.uid(), token_name, encode(extensions.digest(raw, 'sha256'), 'hex'), write_access);
  return raw;
end $$;

revoke all on function public.create_mcp_token(text, boolean) from public, anon;
grant execute on function public.create_mcp_token(text, boolean) to authenticated;

-- Resolves a token to its owner; only the MCP server (service role) may call it.
create or replace function public.resolve_mcp_token(token text)
returns table (user_id uuid, token_id uuid, name text, can_write boolean)
language sql security definer set search_path = '' as $$
  update public.mcp_tokens t set last_used_at = now()
  where t.token_hash = encode(extensions.digest(token, 'sha256'), 'hex') and t.revoked_at is null
  returning t.user_id, t.id, t.name, t.can_write
$$;

revoke all on function public.resolve_mcp_token(text) from public, anon, authenticated;
