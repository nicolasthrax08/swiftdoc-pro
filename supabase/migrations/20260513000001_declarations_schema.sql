-- ============================================================
-- Migration: Declarations schema, Tradelink credentials,
--            and Vault-backed credential retrieval helper
-- ============================================================

-- ----------------------------------------------------------------
-- Enable required extensions (idempotent)
-- ----------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "pgsodium";       -- required by Vault
create extension if not exists "vault" schema vault;  -- Supabase Vault

-- ----------------------------------------------------------------
-- Enum: declaration filing status
-- ----------------------------------------------------------------
do $$ begin
  create type public.declaration_status as enum (
    'pending',
    'in_progress',
    'filed',
    'failed',
    'manual_required'
  );
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------
-- Table: tenants  (minimal; extend as needed)
-- ----------------------------------------------------------------
create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  created_at  timestamptz not null default now()
);

alter table public.tenants enable row level security;

-- Owners can read their own tenant row
create policy "tenants_owner_select" on public.tenants
  for select
  using (auth.uid() = id);

-- ----------------------------------------------------------------
-- Table: tradelink_credentials
--
-- Stores Tradelink portal credentials per tenant.  The plaintext
-- password is NEVER stored here; only a Vault secret UUID is kept
-- so that the password can be retrieved through vault.decrypted_secrets
-- by a service-role function only.
-- ----------------------------------------------------------------
create table if not exists public.tradelink_credentials (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  username           text not null,
  vault_secret_id    uuid not null,      -- references vault.secrets(id)
  environment        text not null default 'staging'
                       check (environment in ('staging', 'production')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint tradelink_credentials_tenant_environment_unique
    unique (tenant_id, environment)
);

alter table public.tradelink_credentials enable row level security;

-- Tenants may only read their own credential record (no password column exposed)
create policy "tradelink_creds_owner_select" on public.tradelink_credentials
  for select
  using (auth.uid() = tenant_id);

-- Service role can do everything (bypasses RLS with service role key)
-- No explicit policy needed — service role bypasses RLS when
-- auth.role() = 'service_role'.

-- ----------------------------------------------------------------
-- Table: declarations
-- ----------------------------------------------------------------
create table if not exists public.declarations (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  status              public.declaration_status not null default 'pending',

  -- TDEC data payload (validated at application layer)
  declaration_data    jsonb not null default '{}',

  -- Tradelink reference number, populated after successful filing
  tradelink_ref       text,

  -- Deadline for manual fallback notification
  filing_deadline     timestamptz,

  -- Timestamps
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  filed_at            timestamptz
);

alter table public.declarations enable row level security;

create policy "declarations_tenant_select" on public.declarations
  for select
  using (auth.uid() = tenant_id);

create policy "declarations_tenant_insert" on public.declarations
  for insert
  with check (auth.uid() = tenant_id);

create policy "declarations_tenant_update" on public.declarations
  for update
  using (auth.uid() = tenant_id);

-- Index on tenant + status for dashboard queries
create index if not exists declarations_tenant_status_idx
  on public.declarations (tenant_id, status);

-- ----------------------------------------------------------------
-- Trigger: auto-update updated_at on declarations
-- ----------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger declarations_updated_at
  before update on public.declarations
  for each row execute function public.set_updated_at();

create trigger tradelink_credentials_updated_at
  before update on public.tradelink_credentials
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------
-- Function: get_tradelink_credential_for_tenant
--
-- SERVICE-ROLE ONLY.  Returns the username and decrypted password
-- for a tenant in the given environment.  Called from Next.js
-- server side using the admin (service-role) Supabase client via rpc().
--
-- Access pattern: service role → function → vault.decrypted_secrets
-- The function is NOT callable by the anon or authenticated roles.
-- ----------------------------------------------------------------
create or replace function public.get_tradelink_credential_for_tenant(
  p_tenant_id   uuid,
  p_environment text default 'staging'
)
returns table (
  username   text,
  password   text,
  cred_id    uuid
)
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_cred record;
  v_decrypted text;
begin
  -- Restrict to service role
  if current_setting('request.jwt.claims', true)::json->>'role' not in ('service_role', '')
     and current_role not in ('service_role', 'postgres', 'supabase_admin')
  then
    raise exception 'Insufficient privileges: service role required';
  end if;

  -- Look up credential record
  select tc.id, tc.username, tc.vault_secret_id
  into v_cred
  from public.tradelink_credentials tc
  where tc.tenant_id  = p_tenant_id
    and tc.environment = p_environment
  limit 1;

  if not found then
    raise exception 'No Tradelink credentials found for tenant % env %',
      p_tenant_id, p_environment;
  end if;

  -- Retrieve decrypted secret from Vault
  select decrypted_secret
  into v_decrypted
  from vault.decrypted_secrets
  where id = v_cred.vault_secret_id;

  if not found then
    raise exception 'Vault secret not found for credential id %', v_cred.id;
  end if;

  return query select v_cred.username, v_decrypted, v_cred.id;
end;
$$;

-- Revoke public access; only service role and superuser may call this
revoke all on function public.get_tradelink_credential_for_tenant(uuid, text) from public;
revoke all on function public.get_tradelink_credential_for_tenant(uuid, text) from anon;
revoke all on function public.get_tradelink_credential_for_tenant(uuid, text) from authenticated;
