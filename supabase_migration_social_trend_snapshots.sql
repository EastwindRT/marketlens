-- Social trend snapshots for Reddit and X mention trajectory.
-- Stores lightweight sampled counts so TARS can show direction/acceleration
-- instead of only the latest mention total.

create table if not exists public.social_trend_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('reddit', 'x')),
  filter text not null default 'default',
  symbol text not null,
  sampled_at timestamptz not null default now(),
  mentions integer not null default 0,
  rank integer,
  upvotes integer,
  unique_accounts integer,
  engagement_score numeric not null default 0,
  raw jsonb not null default '{}'::jsonb
);

create index if not exists social_trend_snapshots_lookup_idx
  on public.social_trend_snapshots (source, filter, symbol, sampled_at desc);

create index if not exists social_trend_snapshots_sampled_idx
  on public.social_trend_snapshots (sampled_at desc);

alter table public.social_trend_snapshots enable row level security;

create policy "social_trend_snapshots_public_read"
  on public.social_trend_snapshots for select
  using (true);

