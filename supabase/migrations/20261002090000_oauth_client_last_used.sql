-- MCP clients (Claude, ChatGPT, Glama and others) cache the client_id they registered and reuse it,
-- sometimes days later. /register used to forget a client after a day if it had no connection yet,
-- so a client that registered once and came back later hit "unknown_app" at /authorize.
--
-- /authorize now stamps last_used_at, and /register forgets a client only when it has no
-- connection and nothing happened on it (registration or authorize) for 90 days.

alter table public.oauth_clients add column last_used_at timestamptz;
