-- ─────────────────────────────────────────────────────────────────────────────
-- filing_triage_seen: remembers every accession number the triage job has
-- handled, including filings it deliberately skipped (mechanical Form 4s,
-- routine 8-Ks). Without it the job would re-download and re-parse thousands
-- of skipped filings on every run. Run after supabase_migration_filing_signals.sql.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.filing_triage_seen (
  accession_no text primary key,
  filing_type text not null check (filing_type in ('ownership', 'insider', 'event')),
  outcome text not null check (outcome in ('scored', 'skipped')),
  seen_at timestamptz not null default now()
);

create index if not exists filing_triage_seen_seen_at_idx on public.filing_triage_seen (seen_at desc);

-- Service-role only: RLS on with no policies denies anon/authenticated access.
alter table public.filing_triage_seen enable row level security;
