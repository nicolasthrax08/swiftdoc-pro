-- ============================================================
-- Migration: waybill_extractions table
--
-- Stores structured data extracted from mixed-language
-- (Cantonese/English) waybill documents via Gemini 1.5 Pro.
-- Each row is linked to a filing_jobs record (optional) and
-- captures the full raw Gemini response for auditability.
-- ============================================================

-- ----------------------------------------------------------------
-- Table: waybill_extractions
-- ----------------------------------------------------------------
create table if not exists public.waybill_extractions (
  id                  uuid primary key default gen_random_uuid(),

  -- Optional FK to a filing job — may be null when the extraction
  -- is performed before a filing job exists.
  filing_id           uuid references public.filing_jobs(id) on delete set null,

  -- Structured extraction results
  consignee           text,
  departure_date      date,
  total_value_hkd     numeric(18, 2),
  hkhs_code           text,

  -- AI confidence score (0.0 – 1.0)
  confidence_score    numeric(4, 3) check (
    confidence_score is null
    or (confidence_score >= 0 and confidence_score <= 1)
  ),

  -- Full Gemini response stored for auditability / re-processing
  raw_extraction      jsonb not null default '{}',

  created_at          timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------
alter table public.waybill_extractions enable row level security;

-- Tenants may select their own rows through the filing_jobs join.
-- Service-role writes bypass RLS (no explicit policy needed for
-- service role). The authenticated SELECT policy checks ownership
-- via the parent filing_job's declaration → tenant chain.
--
-- For extractions with no filing_id (pre-filing uploads), service
-- role is the only writer/reader path — the app layer controls
-- access by verifying the session before calling the route.

create policy "waybill_extractions_tenant_select"
  on public.waybill_extractions
  for select
  using (
    filing_id is null
    or exists (
      select 1
      from public.filing_jobs fj
      join public.declarations d on d.id = fj.declaration_id
      where fj.id = waybill_extractions.filing_id
        and d.tenant_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------
create index if not exists waybill_extractions_filing_id_idx
  on public.waybill_extractions (filing_id)
  where filing_id is not null;

create index if not exists waybill_extractions_created_at_idx
  on public.waybill_extractions (created_at desc);
