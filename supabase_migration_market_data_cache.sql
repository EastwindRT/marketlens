create table if not exists public.market_data_sync_state (
  dataset text primary key,
  synced_at timestamptz not null default now(),
  row_count integer not null default 0
);

create table if not exists public.congress_trades (
  id text primary key,
  member text not null,
  party text,
  state text,
  ticker text not null,
  asset_description text,
  type text not null,
  amount text,
  amount_min bigint not null default 0,
  transaction_date date not null,
  disclosure_date date,
  filing_url text,
  chamber text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists congress_trades_ticker_idx on public.congress_trades (ticker);
create index if not exists congress_trades_transaction_date_idx on public.congress_trades (transaction_date desc);
create index if not exists congress_trades_member_idx on public.congress_trades (member);

create table if not exists public.ca_insider_filings (
  id text primary key,
  symbol text not null,
  company_name text,
  insider_name text,
  title text,
  type text not null,
  open_market boolean not null default false,
  transaction_date date,
  filing_date date,
  shares numeric,
  price_per_share numeric,
  total_value numeric,
  market text not null default 'CA',
  exchange text not null default 'TSX',
  source text not null default 'TMX/SEDI',
  filing_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ca_insider_filings_symbol_idx on public.ca_insider_filings (symbol);
create index if not exists ca_insider_filings_filing_date_idx on public.ca_insider_filings (filing_date desc);
create index if not exists ca_insider_filings_open_market_idx on public.ca_insider_filings (open_market, filing_date desc);

alter table public.market_data_sync_state enable row level security;
alter table public.congress_trades enable row level security;
alter table public.ca_insider_filings enable row level security;

drop policy if exists "No direct market data sync state access" on public.market_data_sync_state;
create policy "No direct market data sync state access"
  on public.market_data_sync_state
  for all
  using (false)
  with check (false);

drop policy if exists "No direct congress trades access" on public.congress_trades;
create policy "No direct congress trades access"
  on public.congress_trades
  for all
  using (false)
  with check (false);

drop policy if exists "No direct CA insider filings access" on public.ca_insider_filings;
create policy "No direct CA insider filings access"
  on public.ca_insider_filings
  for all
  using (false)
  with check (false);
