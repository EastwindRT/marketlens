-- MoneyTalks League Schema
-- Paste this entire file into Supabase → SQL Editor → Run

-- Players table (you'll seed 8 players manually or via INSERT below)
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pin text not null,
  avatar_color text not null default '#1652F0',
  cash numeric(12,2) not null default 1000.00,
  created_at timestamptz default now()
);

-- Holdings per player
create table if not exists holdings (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  symbol text not null,
  exchange text not null default 'NASDAQ',
  shares numeric(12,4) not null,
  avg_cost numeric(12,4) not null,
  updated_at timestamptz default now(),
  unique(player_id, symbol)
);

-- Trade history
create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  symbol text not null,
  exchange text not null default 'NASDAQ',
  trade_type text not null check (trade_type in ('BUY', 'SELL')),
  shares numeric(12,4) not null,
  price numeric(12,4) not null,
  total numeric(12,2) not null,
  traded_at timestamptz default now()
);

-- Enable Row Level Security but allow all reads (public leaderboard)
alter table players enable row level security;
alter table holdings enable row level security;
alter table trades enable row level security;

-- Allow anyone to read (leaderboard is public within the group)
create policy "Public read players" on players for select using (true);
create policy "Public read holdings" on holdings for select using (true);
create policy "Public read trades" on trades for select using (true);

-- Allow insert/update/delete for all (PIN-gated at app level)
create policy "Allow all writes players" on players for all using (true) with check (true);
create policy "Allow all writes holdings" on holdings for all using (true) with check (true);
create policy "Allow all writes trades" on trades for all using (true) with check (true);

-- Real-time: enable for leaderboard live updates
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table holdings;
alter publication supabase_realtime add table trades;

-- Seed players — add more later via Supabase Table Editor
insert into players (name, pin, avatar_color, cash) values
  ('Eastwind',  '1989', '#1652F0', 1000),
  ('Not Last',  '1111', '#05B169', 1000),
  ('DROGON',    '2222', '#F6465D', 1000),
  ('Tikismash', '3333', '#F0A716', 1000),
  ('Skillz',    '4444', '#9B59B6', 1000),
  ('thanos',    '5555', '#E67E22', 1000),
  ('rascals',   '6666', '#1ABC9C', 1000),
  ('friction',  '7777', '#E74C3C', 1000)
on conflict do nothing;
