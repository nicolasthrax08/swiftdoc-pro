-- ============================================================
-- Migration: filing_jobs table
-- Tracks every Skyvern browser-agent task for a declaration,
-- providing full auditability of the filing pipeline.
-- ============================================================

-- ----------------------------------------------------------------
-- Enum: filing job status
-- ----------------------------------------------------------------
do $$ begin
  create type public.filing_job_status as enum (
    'queued',        -- created, not yet submitted to Skyvern
    'running',       -- Skyvern task in flight
    'completed',     -- Skyvern task completed successfully
    'failed',        -- terminal failure (all retries exhausted)
    'cancelled'      -- manually cancelled
  );
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------
-- Table: filing_jobs
-- ----------------------------------------------------------------
create table if not exists public.filing_jobs (
  id                uuid primary key default gen_random_uuid(),
  declaration_id    uuid not null references public.declarations(id) on delete cascade,
  tenant_id         uuid not null references public.tenants(id)      on delete cascade,

  -- Skyvern task tracking
  skyvern_task_id   text,                -- null until the task is submitted
  skyvern_run_id    text,                -- Skyvern workflow run ID if using workflows

  -- Job lifecycle
  status            public.filing_job_status not null default 'queued',
  retry_count       integer not null default 0,
  max_retries       integer not null default 3,

  -- Error information (no credentials or sensitive portal data)
  last_error_code   text,               -- machine-readable error class
  last_error_msg    text,               -- safe human-readable summary

  -- Audit log: append-only JSONB array of stage events
  -- Each entry shape: { ts, stage, success, msg, metadata }
  audit_log         jsonb not null default '[]'::jsonb,

  -- Timing
  queued_at         timestamptz not null default now(),
  started_at        timestamptz,
  completed_at      timestamptz,

  -- The reference number captured from the portal on success
  portal_ref        text
);

alter table public.filing_jobs enable row level security;

-- Tenants read only their own jobs
create policy "filing_jobs_tenant_select" on public.filing_jobs
  for select
  using (auth.uid() = tenant_id);

-- Indexes
create index if not exists filing_jobs_declaration_idx
  on public.filing_jobs (declaration_id);

create index if not exists filing_jobs_skyvern_task_idx
  on public.filing_jobs (skyvern_task_id)
  where skyvern_task_id is not null;

create index if not exists filing_jobs_status_idx
  on public.filing_jobs (status, queued_at);

-- ----------------------------------------------------------------
-- Function: append_filing_job_audit_entry
--
-- Appends a structured entry to filing_jobs.audit_log.
-- Called from application code via rpc() with service-role client.
-- ----------------------------------------------------------------
create or replace function public.append_filing_job_audit_entry(
  p_job_id  uuid,
  p_entry   jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.filing_jobs
  set audit_log = audit_log || jsonb_build_array(
    p_entry || jsonb_build_object('ts', now())
  )
  where id = p_job_id;
end;
$$;

revoke all on function public.append_filing_job_audit_entry(uuid, jsonb) from public;
revoke all on function public.append_filing_job_audit_entry(uuid, jsonb) from anon;
revoke all on function public.append_filing_job_audit_entry(uuid, jsonb) from authenticated;
