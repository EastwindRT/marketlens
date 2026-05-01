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
  ('twitter_poll_interval_hours', '8'::jsonb)
on conflict (key) do nothing;

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
