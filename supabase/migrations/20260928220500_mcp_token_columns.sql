-- Signed-in users may only rename or revoke their tokens. The earlier column grant didn't
-- remove the table-wide UPDATE that Supabase grants by default, so a token's owner could
-- flip can_write on, change its hash, or un-revoke it.
revoke update on public.mcp_tokens from authenticated;
grant update (revoked_at, name) on public.mcp_tokens to authenticated;

-- Revoking is final: a revoked token never works again.
create or replace function public.mcp_token_stay_revoked() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.revoked_at is not null then
    new.revoked_at := old.revoked_at;
  end if;
  return new;
end $$;

create trigger mcp_tokens_stay_revoked before update on public.mcp_tokens
  for each row execute function public.mcp_token_stay_revoked();
