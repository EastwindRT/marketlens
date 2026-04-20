## Plan: Public portfolios + drop PIN system + fix CA filings crash (2026-04-19)

### Goals
1. Replace PIN-gated league with Google-auth identity: first login auto-provisions a player row, portfolio & watchlist become publicly readable.
2. Remove the "cash balance" concept: unlimited theoretical dollars, returns computed as `(holdings value − cost basis) / cost basis`.
3. Support both Market price and Custom (price + historical date) trade entry to allow backfill.
4. Fix the CA filings tab crash caused by a null `formType` on malformed atom entries.

### Shipped
- [x] `supabase_migration_public_portfolios.sql` — makes `pin`/`cash` nullable, adds `google_email`/`display_name`, adds `trades.note`, replaces blanket "Allow all writes" RLS with `auth.email()`-scoped policies.
- [x] `src/api/supabase.ts` — `Player` interface reworked; `ensurePlayerForSession()` upserts a row on first login; `executeBuy`/`executeSell` take optional `tradedAt` + `note`; cash math removed from all admin helpers; `adminSetCash` deleted.
- [x] `src/App.tsx` — session handler now calls `ensurePlayerForSession` (auto-provision); `/players` route alias added.
- [x] `src/store/leagueStore.ts` — dropped `updateCash`; store now only tracks `player`.
- [x] `src/pages/Admin.tsx` — rewritten as email allow-list moderation (`VITE_ADMIN_EMAILS`, fallback `renjith914@gmail.com`); drops PIN gate, cash editor, reset-cash wording; keeps reset/delete/undo-trade.
- [x] `src/components/trade/TradeModal.tsx` — added Market/Custom price mode (with optional historical date + note field); removed cash check and optimistic cash update.
- [x] `src/pages/Portfolio.tsx` — PortfolioSummary now shows Portfolio Value, Cost Basis, Positions (no cash row); gain is `holdingsValue − costBasis`.
- [x] `src/pages/PlayerPortfolio.tsx` — fully public (no self-redirect); adds a Watchlist section next to Positions; fetches via `getPlayerById` + `getWatchlist`; real-time subscribed on holdings + watchlists.
- [x] `src/pages/Leaderboard.tsx` — ranks by return % against cost basis (was against `STARTING_CASH`); header copy updated ("Public portfolios · N players").
- [x] `src/components/layout/Sidebar.tsx` — admin detection now email-based; sidebar player rows show `N pos` instead of stale gain %.
- [x] `src/components/news/NewsSection.tsx` (FilingsTab) — `formColor` tolerates `undefined/null`; list filters malformed entries; fallbacks for missing `formType`/`filerName`.
- [x] `npm run build` clean.

### Env setup required
- [ ] Run `supabase_migration_public_portfolios.sql` in the Supabase SQL editor after backing up.
- [ ] Set `VITE_ADMIN_EMAILS` (comma-separated) in Render (optional; defaults to `renjith914@gmail.com`).
- [ ] Retire `VITE_ADMIN_PIN` (no longer read by the app).

### Open / deferred
- [ ] Delete old PIN-seeded players or attach `google_email` to them (manual SQL).
- [ ] Display-name edit UI (currently pulls from Google `full_name`; migration added a `display_name` column).
- [ ] Add "Follow this player" lightweight subscribe for public portfolios.
- [ ] Earnings Calendar page, chart technicals, funds sector badges, streaming Deep Analyze, CA fundamentals (carried over from prior plan).

### Review
- Auth-as-identity removes a whole class of collision bugs (two players picking the same PIN, PIN leaks).
- Keeping `pin`/`cash` columns nullable (instead of dropping them) preserves the old rows — no destructive migration.
- Market/Custom toggle in `TradeModal` is the same shape on buy and sell, which matches the "tracking, not simulating" intent (you already bought IRL, just backfill it).
- Sidebar rank-by-gain needed live prices; without them the old formula was basically zero anyway. Showing position count is honest and cheap; real performance lives on the portfolio page.
- Build passes; the RLS migration is the only required ops step.
