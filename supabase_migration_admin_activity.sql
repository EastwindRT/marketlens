-- Admin activity tracking
-- Run this in Supabase SQL Editor to add online/last-active + search logs.

alter table public.players
  add column if not exists last_active_at timestamptz default now();

update public.players
set last_active_at = coalesce(last_active_at, created_at, now());

create table if not exists public.search_logs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  query text not null,
  selected_symbol text,
  created_at timestamptz not null default now()
);

alter table public.search_logs enable row level security;

drop policy if exists "Public read search logs" on public.search_logs;
create policy "Public read search logs"
  on public.search_logs
  for select
  using (true);

drop policy if exists "Allow all writes search logs" on public.search_logs;
create policy "Allow all writes search logs"
  on public.search_logs
  for all
  using (true)
  with check (true);

alter publication supabase_realtime add table public.search_logs;
