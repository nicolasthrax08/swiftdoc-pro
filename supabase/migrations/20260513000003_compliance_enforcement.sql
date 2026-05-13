-- ============================================================
-- Migration: DB-level compliance enforcement for declarations
--
-- 1. Adds `ad_valorem_tax` column with a CHECK constraint
--    enforcing the HK$0.20 minimum floor.
-- 2. Adds `departure_date` column (ISO date, nullable) used
--    by the 14-day watchdog.
-- 3. Adds a trigger that automatically transitions
--    status → 'CRITICAL' when departure_date is more than
--    14 days in the past.
--
-- Companion: src/lib/compliance.ts (application-layer enforcement)
-- ============================================================

-- ----------------------------------------------------------------
-- Extend declaration_status enum with CRITICAL state
-- ----------------------------------------------------------------
do $$ begin
  alter type public.declaration_status add value if not exists 'critical';
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------
-- Add departure_date column
--
-- Stored as timestamptz so timezone-aware comparisons work correctly
-- with NOW() in the trigger.  Application layer passes an ISO 8601
-- string; Postgres coerces it automatically.
-- ----------------------------------------------------------------
alter table public.declarations
  add column if not exists departure_date timestamptz;

-- ----------------------------------------------------------------
-- Add ad_valorem_tax column with floor constraint
--
-- The application layer calculates and stores the tax when a
-- declaration is created or updated.  The CHECK constraint acts as
-- a hard backstop: no row may have a tax below HK$0.20.
-- ----------------------------------------------------------------
alter table public.declarations
  add column if not exists ad_valorem_tax numeric(12, 2);

alter table public.declarations
  add constraint declarations_ad_valorem_floor
    check (ad_valorem_tax is null or ad_valorem_tax >= 0.20);

-- ----------------------------------------------------------------
-- Trigger: auto-set status = 'critical' when the 14-day window
--          has been breached.
--
-- Fires BEFORE INSERT OR UPDATE so the status is correct before
-- the row is written to disk.  The trigger only overrides the
-- status for rows whose departure_date has passed 14 days ago;
-- it leaves all other rows untouched.
--
-- Idempotent — safe to re-run; CREATE OR REPLACE is used.
-- ----------------------------------------------------------------
create or replace function public.enforce_declaration_critical_status()
returns trigger
language plpgsql
as $$
begin
  -- Only apply when departure_date is set and the deadline is breached
  if new.departure_date is not null
     and new.departure_date < now() - interval '14 days'
  then
    new.status := 'critical';
  end if;
  return new;
end;
$$;

-- Drop and recreate so the trigger stays up-to-date on re-runs
drop trigger if exists declarations_enforce_critical_status
  on public.declarations;

create trigger declarations_enforce_critical_status
  before insert or update
  on public.declarations
  for each row
  execute function public.enforce_declaration_critical_status();

-- ----------------------------------------------------------------
-- Back-fill: immediately mark any existing rows where the 14-day
--            window has already been breached.
-- ----------------------------------------------------------------
update public.declarations
  set status = 'critical'
  where departure_date is not null
    and departure_date < now() - interval '14 days'
    and status != 'critical';

-- ----------------------------------------------------------------
-- Index: speed up the periodic sweep query for overdue declarations
-- ----------------------------------------------------------------
create index if not exists declarations_departure_date_idx
  on public.declarations (departure_date)
  where departure_date is not null;
