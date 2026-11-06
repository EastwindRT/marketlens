-- Allow the additional filing types (Form 144 sale notices, NT 10-K/10-Q late filings, tender offers,
-- contested proxies, and Canadian SEDI insider trades). Already applied to the live project.
alter table public.filing_signals drop constraint if exists filing_signals_filing_type_check;
alter table public.filing_signals add constraint filing_signals_filing_type_check
  check (filing_type in ('ownership', 'insider', 'event', 'sale_notice', 'late_filing', 'takeover', 'proxy_fight', 'ca_insider'));

alter table public.filing_triage_seen drop constraint if exists filing_triage_seen_filing_type_check;
alter table public.filing_triage_seen add constraint filing_triage_seen_filing_type_check
  check (filing_type in ('ownership', 'insider', 'event', 'sale_notice', 'late_filing', 'takeover', 'proxy_fight', 'ca_insider'));
