-- Notes saved against triaged filings (by a person or by Claude Code over MCP). Already applied to the live project.
create table if not exists public.filing_findings (
  id uuid primary key default gen_random_uuid(),
  accession_no text not null,
  author text not null default 'claude-code',
  verdict text check (verdict in ('bullish', 'bearish', 'neutral', 'watch', 'dismiss')),
  confidence numeric check (confidence between 0 and 1),
  summary text not null check (char_length(summary) between 1 and 1000),
  details text check (char_length(details) <= 8000),
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists filing_findings_accession_idx on public.filing_findings (accession_no, created_at desc);
create index if not exists filing_findings_created_idx on public.filing_findings (created_at desc);
alter table public.filing_findings enable row level security;
drop policy if exists "filing_findings_public_read" on public.filing_findings;
create policy "filing_findings_public_read" on public.filing_findings for select using (true);
-- Writes use the service-role key from server.cjs only (bypasses RLS).
