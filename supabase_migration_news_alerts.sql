-- ─────────────────────────────────────────────────────────────────────────────
-- News Impact + Agent Alerts schema migration
-- Run this in the Supabase SQL editor (or via supabase db push) against the
-- live project before deploying the News Impact / Alerts features.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── news_items ───────────────────────────────────────────────────────────────
-- Stores Claude-scored headlines that passed the market-impact filter.
-- dedup_key prevents re-scoring the same headline across fetch cycles.

create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  headline text not null,
  source text not null,
  published_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  url text,
  impact_score integer not null check (impact_score between 1 and 10),
  category text not null,   -- macro | sector | company | policy | us_politics | canada_macro | trade_policy | geopolitical
  summary text not null,    -- one sentence from Claude
  affected_tickers text[] not null default '{}',
  seen_by_agent boolean not null default false,
  raw_query text,           -- which NewsAPI query / source produced this headline
  dedup_key text unique not null  -- sha1(headline + published_at), prevents re-scoring
);

create index if not exists news_items_published_at_idx  on public.news_items (published_at desc);
create index if not exists news_items_impact_score_idx  on public.news_items (impact_score desc);
create index if not exists news_items_category_idx      on public.news_items (category);
create index if not exists news_items_seen_by_agent_idx on public.news_items (seen_by_agent) where seen_by_agent = false;

-- ── agent_alerts ─────────────────────────────────────────────────────────────
-- One row per agent briefing run per player.
-- source_news_ids + source_filings give an audit trail of what fed the briefing.

create table if not exists public.agent_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  player_id uuid,           -- null = global fallback briefing (no watchlist match)
  briefing_text text not null,            -- full markdown from Claude
  bullets text[] not null default '{}',   -- parsed bullet list (max 5)
  source_news_ids uuid[] not null default '{}',
  source_filings jsonb not null default '[]',
  watchlist_snapshot text[] not null default '{}',  -- tickers at time of run
  delivered boolean not null default false
);

create index if not exists agent_alerts_created_at_idx  on public.agent_alerts (created_at desc);
create index if not exists agent_alerts_player_id_idx   on public.agent_alerts (player_id);

-- ── agent_run_logs ────────────────────────────────────────────────────────────
-- One row per scheduled job execution. Used for cost observability.
-- Only service-role can write; no public read.

create table if not exists public.agent_run_logs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  job text not null,           -- 'news-impact' | 'agent-briefing'
  items_processed integer not null default 0,
  tokens_used integer not null default 0,
  ms_elapsed integer not null default 0,
  error text                   -- null = success
);

create index if not exists agent_run_logs_run_at_idx on public.agent_run_logs (run_at desc);
create index if not exists agent_run_logs_job_idx    on public.agent_run_logs (job);

-- ── app_settings ─────────────────────────────────────────────────────────────
-- Key/value feature flags. Checked at runtime by server jobs.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Seed the Twitter/X phase-2 scaffold flag (off by default)
insert into public.app_settings (key, value)
values ('twitter_enabled', 'false'::jsonb)
on conflict (key) do nothing;

insert into public.app_settings (key, value)
values ('twitter_poll_interval_hours', '8'::jsonb)
on conflict (key) do nothing;

-- ── X / Twitter social trend polling ─────────────────────────────────────────
-- Stores posts pulled from a curated account basket. The server only polls when
-- app_settings.twitter_enabled=true and X_BEARER_TOKEN is configured.

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

-- ── Row-level security ────────────────────────────────────────────────────────

alter table public.news_items   enable row level security;
alter table public.agent_alerts enable row level security;
alter table public.agent_run_logs enable row level security;
alter table public.app_settings enable row level security;
alter table public.x_accounts enable row level security;
alter table public.x_posts enable row level security;
alter table public.x_symbol_mentions enable row level security;

-- news_items: public read, service-role write
create policy "news_items_public_read"
  on public.news_items for select
  using (true);

-- agent_alerts: public read.
-- player_id stores players.id (an internal DB uuid), NOT the Supabase auth uid.
-- The app maps users to players via google_email, not auth.uid().
-- Row-level filtering by player is done at the application layer (API query param),
-- not in RLS, consistent with how holdings/watchlists/trades are readable by
-- any authenticated user on the leaderboard + public portfolio views.
create policy "agent_alerts_public_read"
  on public.agent_alerts for select
  using (true);

-- agent_run_logs: no public access (service-role only via server)
-- (no policy = deny all for anon/authenticated; service-role bypasses RLS)

-- app_settings: public read (feature flags are not secrets)
create policy "app_settings_public_read"
  on public.app_settings for select
  using (true);

create policy "x_accounts_public_read"
  on public.x_accounts for select
  using (true);

create policy "x_posts_public_read"
  on public.x_posts for select
  using (true);

create policy "x_symbol_mentions_public_read"
  on public.x_symbol_mentions for select
  using (true);
