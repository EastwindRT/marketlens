-- X / Twitter social trend polling schema
-- Run this in Supabase SQL editor before enabling twitter_enabled.

create table if not exists public.x_accounts (
  username text primary key,
  user_id text,
  display_name text,
  enabled boolean not null default true,
  priority integer not null default 50,
  notes text,
  last_polled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.x_posts (
  id text primary key,
  author_id text,
  account_username text references public.x_accounts(username) on delete set null,
  text text not null,
  posted_at timestamptz not null,
  url text,
  public_metrics jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);

create table if not exists public.x_symbol_mentions (
  id uuid primary key default gen_random_uuid(),
  post_id text not null references public.x_posts(id) on delete cascade,
  symbol text not null,
  cashtag text not null,
  account_username text,
  posted_at timestamptz not null,
  engagement_score numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (post_id, symbol)
);

create index if not exists x_accounts_enabled_idx on public.x_accounts (enabled, priority desc);
create index if not exists x_posts_posted_at_idx on public.x_posts (posted_at desc);
create index if not exists x_symbol_mentions_symbol_posted_idx on public.x_symbol_mentions (symbol, posted_at desc);
create index if not exists x_symbol_mentions_posted_idx on public.x_symbol_mentions (posted_at desc);

insert into public.app_settings (key, value)
values
  ('twitter_enabled', 'false'::jsonb),
  ('twitter_poll_interval_hours', '8'::jsonb),
  ('x_list_since_id', 'null'::jsonb)
on conflict (key) do nothing;

insert into public.x_accounts (username, display_name, enabled, priority, notes)
values
  ('lizannsonders', 'Liz Ann Sonders', true, 98, 'seed: market strategist'),
  ('10kdiver', '10-K Diver', true, 96, 'seed: investing analysis'),
  ('aswathdamodaran', 'Aswath Damodaran', true, 95, 'seed: valuation analysis'),
  ('brianferoldi', 'Brian Feroldi', true, 93, 'seed: stock analysis'),
  ('investorslive', 'InvestorsLive', true, 92, 'seed: trading analysis'),
  ('reddogt3', 'Scott Redler', true, 92, 'seed: technical trading'),
  ('optionshawk', 'OptionsHawk', true, 90, 'seed: options analysis'),
  ('peterlbrandt', 'Peter Brandt', true, 90, 'seed: chart analysis'),
  ('sjosephburns', 'Steve Burns', true, 88, 'seed: trading education'),
  ('harmongreg', 'Greg Harmon', true, 88, 'seed: technical analysis'),
  ('lynaldencontact', 'Lyn Alden', true, 88, 'seed: macro analysis'),
  ('macroalf', 'Macro Alf', true, 86, 'seed: macro trading analysis'),
  ('northmantrader', 'Sven Henrich', true, 86, 'seed: market technicals'),
  ('mebfaber', 'Meb Faber', true, 85, 'seed: investing analysis'),
  ('michaelbatnick', 'Michael Batnick', true, 84, 'seed: market analysis'),
  ('awealthofcs', 'Ben Carlson', true, 84, 'seed: market analysis'),
  ('reformedbroker', 'Josh Brown', true, 84, 'seed: market analysis'),
  ('doombergt', 'Doomberg', true, 83, 'seed: energy and macro analysis'),
  ('raoulgmi', 'Raoul Pal', true, 83, 'seed: macro analysis'),
  ('dividendgrowth', 'Dividend Growth Investor', true, 82, 'seed: dividend analysis'),
  ('chrisbloomstran', 'Chris Bloomstran', true, 82, 'seed: value analysis'),
  ('cullenroche', 'Cullen Roche', true, 81, 'seed: macro analysis'),
  ('callieabost', 'Callie Cox', true, 80, 'seed: market analysis'),
  ('samro', 'Sam Ro', true, 80, 'seed: market analysis'),
  ('claudia_sahm', 'Claudia Sahm', true, 78, 'seed: macro analysis'),
  ('ericbalchunas', 'Eric Balchunas', true, 78, 'seed: ETF analysis'),
  ('nategeraci', 'Nate Geraci', true, 77, 'seed: ETF analysis'),
  ('danniles', 'Dan Niles', true, 77, 'seed: tech and market analysis'),
  ('mohnishpabrai', 'Mohnish Pabrai', true, 76, 'seed: value investing'),
  ('raydalio', 'Ray Dalio', true, 76, 'seed: macro investing'),
  ('patrickboyle', 'Patrick Boyle', true, 74, 'seed: market analysis'),
  ('jesse_livermore', 'Jesse Livermore', true, 74, 'seed: investing analysis'),
  ('kashflowtrades', 'KashFlowTrades', true, 72, 'seed: trading analysis'),
  ('traderstewie', 'Trader Stewie', true, 72, 'seed: swing trading'),
  ('ivanhoff2', 'Ivanhoff', true, 72, 'seed: momentum trading'),
  ('markflowchatter', 'Mark Flowchatter', true, 70, 'seed: market flow analysis'),
  ('the_real_fly', 'The Fly', true, 70, 'seed: trader commentary'),
  ('wifeyalpha', 'Wifey Alpha', true, 70, 'seed: market analysis'),
  ('wallstjesus', 'Wall Street Jesus', true, 68, 'seed: trader commentary'),
  ('peterschiff', 'Peter Schiff', true, 66, 'seed: macro and market commentary')
on conflict (username) do update
set
  display_name = excluded.display_name,
  priority = greatest(public.x_accounts.priority, excluded.priority),
  notes = coalesce(public.x_accounts.notes, excluded.notes),
  updated_at = now();

alter table public.x_accounts enable row level security;
alter table public.x_posts enable row level security;
alter table public.x_symbol_mentions enable row level security;

create policy "x_accounts_public_read"
  on public.x_accounts for select
  using (true);

create policy "x_posts_public_read"
  on public.x_posts for select
  using (true);

create policy "x_symbol_mentions_public_read"
  on public.x_symbol_mentions for select
  using (true);
