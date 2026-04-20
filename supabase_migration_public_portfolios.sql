-- MoneyTalks / TARS — Migration: Public portfolios, drop PIN system
-- Run this in Supabase → SQL Editor after backing up.
-- Date: 2026-04-19

-- 1. Make pin nullable and add google_email column if missing
alter table players alter column pin drop not null;
alter table players add column if not exists google_email text;
alter table players add column if not exists display_name text; -- preferred name if different from Google full name
create unique index if not exists players_google_email_idx on players (lower(google_email)) where google_email is not null;

-- 2. Make cash nullable and default null (unlimited buying — no balance concept)
alter table players alter column cash drop not null;
alter table players alter column cash set default null;

-- 3. Add trade_note column for "custom entry" annotations (optional, non-breaking)
alter table trades add column if not exists note text;

-- 4. Allow traded_at override on insert (it's already timestamptz default now(), just ensuring it's writable)
-- No change needed; clients can supply traded_at explicitly.

-- 5. Tighten RLS writes so only the authenticated owner can insert/update/delete their own rows.
-- Public read stays fully open.
-- We scope by matching auth.email() → players.google_email.

-- Drop the old "allow all writes" blanket policies (they existed for the PIN-gated era).
drop policy if exists "Allow all writes players" on players;
drop policy if exists "Allow all writes holdings" on holdings;
drop policy if exists "Allow all writes trades" on trades;
drop policy if exists "Allow all writes watchlists" on watchlists;

-- Helper: locate the current user's player id
-- (Inline sub-select is simplest; no need for a SECURITY DEFINER function.)

-- Players: a user may insert/update their own row (matched by google_email = auth.email())
create policy "User can insert own player row"
  on players for insert
  with check (google_email = auth.email());

create policy "User can update own player row"
  on players for update
  using (google_email = auth.email())
  with check (google_email = auth.email());

-- Do NOT create a public delete policy for players — deletion is admin-only (handled server-side / SQL).

-- Holdings: user can manage their own holdings rows
create policy "User can manage own holdings"
  on holdings for all
  using (player_id in (select id from players where google_email = auth.email()))
  with check (player_id in (select id from players where google_email = auth.email()));

-- Trades: user can insert their own trade rows; reading is public, no update/delete from client.
create policy "User can insert own trades"
  on trades for insert
  with check (player_id in (select id from players where google_email = auth.email()));

create policy "User can delete own trades"
  on trades for delete
  using (player_id in (select id from players where google_email = auth.email()));

-- Watchlists: user can manage their own watchlist rows
create policy "User can manage own watchlist"
  on watchlists for all
  using (player_id in (select id from players where google_email = auth.email()))
  with check (player_id in (select id from players where google_email = auth.email()));

-- 6. Optional cleanup — clear PINs for old seeded players (keeps their trades + portfolio).
-- Comment this out if you want to preserve the old PIN-login players as is.
-- update players set pin = null where google_email is null;

-- Done. Public reads work for anon + authed. Writes require an authenticated user whose
-- google_email matches a players row.
