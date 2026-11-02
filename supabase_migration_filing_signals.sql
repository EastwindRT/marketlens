-- ─────────────────────────────────────────────────────────────────────────────
-- Unified filing triage schema (13D/13G ownership, Form 4 insider, 8-K events)
-- Supersedes supabase_migration_ownership_filing_triage.sql: the ownership
-- triage never went live, so there is no data to migrate. Run this in the
-- Supabase SQL editor before enabling OWNERSHIP_TRIAGE_ENABLED.
-- Depends on app_settings from supabase_migration_news_alerts.sql.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.filing_signals (
  id uuid primary key default gen_random_uuid(),
  accession_no text unique not null,
  filing_type text not null check (filing_type in ('ownership', 'insider', 'event')),
  form_type text not null,             -- 13D | 13G | 13D/A | 13G/A | 4 | 4/A | 8-K | 8-K/A
  symbol text,                         -- null when the company did not resolve to a ticker
  subject_company text not null,
  subject_cik text,
  filer_name text not null,            -- 13D/G filer, Form 4 insider, or 8-K issuer
  filed_date date not null,
  filing_url text not null,

  -- Unified triage output
  priority integer not null default 0 check (priority between 0 and 100),
  priority_tier text not null default 'low' check (priority_tier in ('critical', 'high', 'medium', 'low')),
  materiality_score numeric,           -- Jev 0-3
  materiality_confidence numeric,      -- Jev 0-1
  signals jsonb not null default '{}'::jsonb,  -- type-specific typed Jev answers (see filingTriage.cjs)
  jev_raw jsonb,
  jev_model text,

  -- LLM deep read, only for filings that cleared the type's escalation rule
  escalated boolean not null default false,
  llm_thesis jsonb,
  llm_model text,

  sector text,
  industry text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists filing_signals_filed_date_idx on public.filing_signals (filed_date desc);
create index if not exists filing_signals_priority_idx on public.filing_signals (priority desc, filed_date desc);
create index if not exists filing_signals_type_idx on public.filing_signals (filing_type, filed_date desc);
create index if not exists filing_signals_symbol_idx on public.filing_signals (symbol);
create index if not exists filing_signals_escalated_idx on public.filing_signals (escalated) where escalated = true;

alter table public.filing_signals enable row level security;

drop policy if exists "filing_signals_public_read" on public.filing_signals;
create policy "filing_signals_public_read"
  on public.filing_signals for select
  using (true);

-- Writes use the service-role key from server.cjs only (bypasses RLS), matching
-- the news_items / agent_run_logs pattern.

insert into public.app_settings (key, value)
values ('filing_triage_enabled', 'false'::jsonb)
on conflict (key) do nothing;
