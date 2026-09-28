-- Signing in AI connectors (ChatGPT, Claude) with OAuth 2.1 instead of pasting a secret.
--
-- The MCP function is the authorization server. A connector registers itself (RFC 7591),
-- sends the person to /authorize, and Amber Notes shows the consent sheet. Approving
-- creates a grant: a row in mcp_tokens with kind = 'oauth', so the app's existing list
-- shows it and revoking it (revoked_at) cuts the connector off at once. Codes, access
-- tokens and refresh tokens are stored only as SHA-256 hashes.
-- Only the MCP function (service role / postgres) reads these tables; nothing is exposed
-- to the anon or authenticated roles except the grant rows the app already sees.

alter table public.mcp_tokens
  add column if not exists kind text not null default 'token' check (kind in ('token', 'oauth')),
  add column if not exists client_id text,
  add column if not exists redirect_host text,
  -- Set when a legacy token arrived inside the URL, so the app can flag it as less safe.
  add column if not exists url_used_at timestamptz;

-- Old tokens are resolved only by hash; oauth grants carry a random placeholder hash
-- nobody can present, so resolve_mcp_token never matches them.
create or replace function public.resolve_mcp_token(token text)
returns table (user_id uuid, token_id uuid, name text, can_write boolean)
language sql security definer set search_path = '' as $$
  update public.mcp_tokens t set last_used_at = now()
  where t.token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
    and t.revoked_at is null and t.kind = 'token'
  returning t.user_id, t.id, t.name, t.can_write
$$;
revoke all on function public.resolve_mcp_token(text) from public, anon, authenticated;

create table public.oauth_clients (
  id text primary key,
  client_name text not null check (char_length(client_name) between 1 and 100),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 10),
  created_at timestamptz not null default now()
);

create table public.oauth_requests (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.oauth_clients (id) on delete cascade,
  redirect_uri text not null,
  state text,
  code_challenge text not null,
  scope text,
  resource text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  decided_at timestamptz,
  grant_id uuid references public.mcp_tokens (id) on delete cascade,
  code_hash text unique,
  code_expires_at timestamptz,
  code_used_at timestamptz
);

create table public.oauth_tokens (
  token_hash text primary key,
  grant_id uuid not null references public.mcp_tokens (id) on delete cascade,
  kind text not null check (kind in ('access', 'refresh')),
  resource text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- Refresh tokens: set when exchanged. Presenting one again revokes the whole grant.
  used_at timestamptz
);
create index oauth_tokens_grant on public.oauth_tokens (grant_id);

-- Sliding-window counters for /register, /authorize and /token, by hashed client IP.
create table public.oauth_rate (
  bucket text not null,
  ip_hash text not null,
  at timestamptz not null default now()
);
create index oauth_rate_lookup on public.oauth_rate (bucket, ip_hash, at);

alter table public.oauth_clients enable row level security;
alter table public.oauth_requests enable row level security;
alter table public.oauth_tokens enable row level security;
alter table public.oauth_rate enable row level security;
revoke all on public.oauth_clients, public.oauth_requests, public.oauth_tokens, public.oauth_rate from anon, authenticated;

-- Resolves an OAuth access token to its grant; only the MCP function may call it.
create or replace function public.resolve_oauth_token(token text)
returns table (user_id uuid, token_id uuid, name text, can_write boolean, resource text)
language sql security definer set search_path = '' as $$
  update public.mcp_tokens g set last_used_at = now()
  from public.oauth_tokens t
  where t.token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
    and t.kind = 'access' and t.expires_at > now()
    and g.id = t.grant_id and g.revoked_at is null and g.kind = 'oauth'
  returning g.user_id, g.id, g.name, g.can_write, t.resource
$$;
revoke all on function public.resolve_oauth_token(text) from public, anon, authenticated;
