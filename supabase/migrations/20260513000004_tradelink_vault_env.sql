-- ============================================================
-- Platform Tradelink credentials from Supabase Vault
--
-- Expects two named secrets in Vault:
--   TRADELINK_ID   — portal / API login id
--   TRADELINK_PASS — matching secret (password)
--
-- Retrieved only via service-role RPC from server-side code.
-- ============================================================

create or replace function public.get_tradelink_vault_env_secrets()
returns table (
  tradelink_id   text,
  tradelink_pass text
)
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id   text;
  v_pass text;
begin
  if current_setting('request.jwt.claims', true)::json->>'role' not in ('service_role', '')
     and current_role not in ('service_role', 'postgres', 'supabase_admin')
  then
    raise exception 'Insufficient privileges: service role required';
  end if;

  select ds.decrypted_secret
  into v_id
  from vault.decrypted_secrets ds
  where ds.name = 'TRADELINK_ID'
  limit 1;

  select ds.decrypted_secret
  into v_pass
  from vault.decrypted_secrets ds
  where ds.name = 'TRADELINK_PASS'
  limit 1;

  if v_id is null or v_pass is null then
    raise exception 'TRADELINK_ID or TRADELINK_PASS vault secret is missing or not readable';
  end if;

  return query select v_id, v_pass;
end;
$$;

revoke all on function public.get_tradelink_vault_env_secrets() from public;
revoke all on function public.get_tradelink_vault_env_secrets() from anon;
revoke all on function public.get_tradelink_vault_env_secrets() from authenticated;

grant execute on function public.get_tradelink_vault_env_secrets() to service_role;
