-- ─────────────────────────────────────────────────────────────────────────────
-- Ownership Filing Triage schema migration (13D / 13G / 13D-A / 13G-A)
-- Run this in the Supabase SQL editor (or via supabase db push) against the
-- live project before deploying the Ownership Filings triage feature.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ownership_filing_signals ─────────────────────────────────────────────────
-- One row per scored 13D/13G filing. accession_no dedupes across scan cycles
-- so a filing is never re-sent to Jev or the LLM once it has a row here.
-- Jev (TypeSafe System One, jev-latest) produces the classification fields;
-- the llm_* fields are populated only for filings that clear the escalation
-- threshold (see ESCALATION_RULES in server.cjs / docs/ownership-filing-triage.md).

create table if not exists public.ownership_filing_signals (
  id uuid primary key default gen_random_uuid(),
  accession_no text unique not null,
  symbol text,                         -- null when the subject company didn't resolve to a ticker
  subject_company text not null,
  subject_cik text,
  filer_name text not null,
  form_type text not null,             -- 13D | 13G | 13D/A | 13G/A
  filed_date date not null,
  filing_url text not null,

  -- Jev classification (Tier: fast structured triage)
  investor_type text,                  -- activist | passive_index | strategic_acquirer | other
  investor_type_confidence numeric,
  board_or_strategic_intent numeric,   -- noul probability 0-1
  new_position numeric,                -- noul probability 0-1
  mechanical_crossing numeric,         -- noul probability 0-1
  materiality_score numeric,           -- 0-3 continuous, see docs
  materiality_confidence numeric,
  jev_raw jsonb,                       -- full Jev response for audit/debugging
  jev_model text,

  -- LLM deep read (Tier: only for filings that cleared the Jev gate)
  escalated boolean not null default false,
  llm_thesis jsonb,                    -- structured QUANT_PROMPT output
  llm_model text,

  sector text,
  industry text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ownership_filing_signals_filed_date_idx
  on public.ownership_filing_signals (filed_date desc);
create index if not exists ownership_filing_signals_materiality_idx
  on public.ownership_filing_signals (materiality_score desc);
create index if not exists ownership_filing_signals_symbol_idx
  on public.ownership_filing_signals (symbol);
create index if not exists ownership_filing_signals_escalated_idx
  on public.ownership_filing_signals (escalated) where escalated = true;

-- ── Row-level security ────────────────────────────────────────────────────────

alter table public.ownership_filing_signals enable row level security;

create policy "ownership_filing_signals_public_read"
  on public.ownership_filing_signals for select
  using (true);

-- Writes go through the service-role key from server.cjs only (no insert/update
-- policy for anon/authenticated — service-role bypasses RLS, matching the
-- news_items / agent_run_logs pattern in supabase_migration_news_alerts.sql).

-- ── app_settings flags used by this feature ─────────────────────────────────
-- Reuses the app_settings table created in supabase_migration_news_alerts.sql.
-- If that migration has not been run yet, run it first.

insert into public.app_settings (key, value)
values ('ownership_triage_enabled', 'false'::jsonb)
on conflict (key) do nothing;
