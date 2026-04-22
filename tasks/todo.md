## Plan: User-reported bug fixes + performance pass (2026-04-20)

### Reported by users
1. Site feels slow to load.
2. Kyle — "cannot buy stocks, stuck on Processing" on trade submit.
3. Rokan — can't see anyone's portfolio ("Player not found").
4. Renjith — portfolio loads on laptop but not on phone.

### Root causes found
- **Stuck-on-Processing (bug 2):** `TradeModal.handleTrade` had no `try/catch/finally`. Any thrown error (network blip, RLS failure, OAuth expiry) left `loading=true` forever. Confirmed via DB query — 4/6 users (Kyle, Prag, Prateek, suketu) had 0 trades total, all hitting the same swallowed exception.
- **"Player not found" (bug 3):** `PlayerPortfolio` used `Promise.all([getPlayerById, getHoldings, getWatchlist])` + `.single()`. `Promise.all` fails together, and `.single()` throws PGRST116 on zero rows — so any player with an empty watchlist (or any one failing query) killed the whole page.
- **Mobile blank screen (bug 4):** `App.tsx` returned `null` while `supabase.auth.getSession()` was pending. On slow mobile / flaky networks the promise could hang → permanent blank screen.
- **Slow feel (bug 1):** aggressive 60s quote refetch (even in background tab), Leaderboard realtime firing 3 reloads per trade (players + holdings + trades events), and zero memoization on list rows so every quote tick re-rendered the entire list.

### Shipped
- [x] `src/components/trade/TradeModal.tsx` — wrapped trade execution in `try/catch/finally`; `setLoading(false)` always runs and a clear "Connection error" message is surfaced.
- [x] `src/pages/PlayerPortfolio.tsx` — switched to `Promise.allSettled`; holdings/watchlist now tolerate partial failure; player-not-found error carries the real reason string.
- [x] `src/api/supabase.ts` — `getPlayerById` and `getPlayerByGoogleEmail` switched from `.single()` → `.maybeSingle()` so empty results return `null` instead of throwing.
- [x] `src/App.tsx` — session gate now renders a spinner (not `null`) and has a 10s timeout fallback so a hung `getSession()` can't leave the app on a blank screen; Suspense fallback also shows a spinner.
- [x] `src/hooks/useStockData.ts` — `useStockQuote` staleTime + refetchInterval: 1m → 2m; `refetchIntervalInBackground: false`; `refetchOnMount: false` (cuts API load ~50% and pauses when tab is hidden).
- [x] `src/pages/Leaderboard.tsx` — debounced the Supabase realtime listener (500ms) so the 3 near-simultaneous events per trade collapse into a single reload.
- [x] `React.memo` on `HoldingRow` / `WatchRow` (Portfolio + PlayerPortfolio) and `LeaderRow` / `PodiumCard` / `ActivityItem` (Leaderboard) — unrelated quote ticks no longer re-render every list row.
- [x] `npm run build` clean (18.6s).
- [x] Shipped in commits on `main` (latest: `fc5a8a4` — "perf: reduce quote refetch cadence, debounce leaderboard realtime, memoize list rows").

### Verification notes
- Supabase RLS verified via MCP: all 4 tables (`players`, `holdings`, `trades`, `watchlists`) have public `select` with `using (true)` — so public portfolio visibility is correct at the DB layer; the bug was purely client-side.
- Confirmed no duplicate holdings, no null/bad values in data that would have caused silent breakage.
- Canadian insider tab showing "Apr 15" as last transaction is correct — SEDI has a 5-day filing window and we're in a pre-earnings quiet period; not a bug.

### Open / deferred (next perf pass)
- [ ] `StockDetail` chunk is 233kB (68kB gzip) — audit what's bundled (charting lib + indicators likely dominate). Candidate for dynamic-import on the candle/indicator stack.
- [ ] `index` main chunk is 474kB (136kB gzip) — room to lazy-load more modals.
- [ ] `SymbolPriceFetcher` / `SymbolPrice` pattern mounts one component per symbol to pull prices. Consolidate into a single batched query (one `useQueries` call against a deduped symbol list) to cut request fan-out on Portfolio / Leaderboard.
- [ ] Add a global error boundary around the Portfolio / Leaderboard pages so a single bad row can't blank the screen.

## Plan: Endpoint recheck + Canadian insider API perf hardening (2026-04-21)

### Live endpoint snapshot
- `GET /api/latest-congress?limit=10` — 200 in ~993ms
- `GET /api/latest-insiders` — 200 in ~1420ms
- `GET /api/insider-activity?days=7&limit=20` — 200 in ~112ms
- `GET /api/ca-insider-activity?days=7&mode=insiders&limit=20` — 200 in ~13089ms
- `GET /api/ca-insider-activity?days=7&mode=filings&limit=20` — 200 in ~11206ms
- `GET /api/13f/recent-filings` — 200 in ~1919ms
- `GET /api/13f/recent-filers` — 200 in ~1877ms
- `GET /api/13f/options-scan` — 200 in ~499ms

### Root cause
- The clear outlier was the Canadian insider route.
- Once its 30-minute cache expired, the next request blocked on a full TMX rebuild across the curated TSX list.
- That meant users paid the full 11–13s rebuild cost even when slightly stale cached data already existed.

### Shipped
- [x] `server.cjs` — extracted the Canadian insider cache rebuild into `buildCaInsiderCache(days, mode)`.
- [x] `server.cjs` — added in-flight build dedupe so overlapping requests for the same cache key share one rebuild instead of stampeding TMX.
- [x] `server.cjs` — switched Canadian insider cache expiry from blocking refresh to stale-while-revalidate: stale cache is served immediately with background refresh.
- [x] `server.cjs` — increased TMX batch concurrency from 5 symbols to 10 symbols per batch.
- [x] `server.cjs` — prewarms `7-insiders` and `7-filings` shortly after boot because those are the default Insider page paths.
- [x] `npm run build` clean after the change.

### Verification
- Local cold `GET /api/ca-insider-activity?days=7&mode=insiders` — ~11510ms
- Immediate second hit on the same route — ~72ms
- `GET /api/ca-insider-activity?days=7&mode=filings` after warm-up — ~186ms

### Open
- [ ] Recheck the live Render instance after deploy to confirm repeat-hit CA insider latency drops sharply there too.
- [ ] If cold-start latency is still too visible on Render, consider persisting the CA insider caches externally or narrowing the first-load symbol universe for the 7-day tabs.

## Plan: Portfolio loading cleanup (2026-04-21)

### Reported issue
1. `/portfolio` and public portfolio pages sometimes hang, flicker back into loading states, or briefly fail to show data.

### Root causes found
- `App.tsx` waited on watchlist initialization in the same auth boot path as player lookup, so portfolio readiness was blocked by a secondary fetch.
- `Portfolio.tsx` and `PlayerPortfolio.tsx` treated every refresh like an initial page load, which made Supabase realtime updates and slow queries feel like the page was hanging.
- Public portfolio reloads fetched player, holdings, and watchlist together on every holdings/watchlist event with no debounce, so bursts of realtime changes could trigger visible repeated reloads.

### Shipped
- [x] `src/App.tsx` — player readiness no longer waits on watchlist hydration; watchlist now initializes in the background after the session/player match is established.
- [x] `src/pages/Portfolio.tsx` — added in-place refresh behavior so existing holdings stay visible during reloads instead of dropping back to a blocking loading state.
- [x] `src/pages/Portfolio.tsx` — debounced holdings realtime reloads and surfaced a lightweight `Refreshing…` indicator instead of a full skeleton reset.
- [x] `src/pages/Portfolio.tsx` — gated watchlist empty-state rendering on watchlist hydration so the page no longer flashes a misleading empty watchlist while the store is still syncing.
- [x] `src/pages/PlayerPortfolio.tsx` — changed public portfolio reloads to preserve the last good snapshot, debounce realtime-triggered reloads, and refresh in place.
- [x] `npm run build` clean after the change.

### Expected user-facing outcome
- My Portfolio becomes usable sooner after login because player boot is no longer blocked on watchlist sync.
- Realtime or slow refreshes should keep current positions visible instead of making the whole portfolio feel blank.
- Public portfolio pages should feel steadier and less prone to “hung up” reload loops.

### Review
- The "stuck on Processing" pattern (missing `finally`) is the kind of bug that only shows up under real-world network failure modes — worth codifying as a lesson for every async submit handler.
- `Promise.all` + `.single()` is a very easy combo to regress into; the `maybeSingle` + `allSettled` pair is the right default for any "load this page with N independent queries" flow.
- The session-gate fix (spinner + 10s timeout) turned a whole class of "app is broken" reports into at worst a slow load — worth applying the same pattern to any future auth-gated shell.
- Perf wins were cheap (no new deps, ~60 lines changed) and compound: fewer API calls + fewer reloads + fewer re-renders.

## Plan: Broad site responsiveness pass (2026-04-21)

### Reported issue
1. The site still felt stall-prone in normal navigation, especially around Dashboard, Portfolios, and My Portfolio.

### Root causes found
- Dashboard and Leaderboard still had repeated quote fanout patterns that made the UI feel progressively chatty even after the main data was loaded.
- Portfolio-style pages treated refreshes too much like first loads, so users saw skeletons or blank-feeling resets during ordinary realtime updates.
- Route readiness and secondary hydration were too tightly coupled in places, which made slow watchlist or profile sync look like a broken page.

### Shipped
- [x] `src/pages/Dashboard.tsx` - switched watchlist cards to shared `useStockQuotes()` loading so quote hydration is centralized instead of one hook per tile.
- [x] `src/pages/Leaderboard.tsx` - switched holdings valuation to shared quote loading and removed the hidden per-symbol fetcher pattern.
- [x] `src/App.tsx` - player/session readiness is now decoupled from watchlist hydration, so route navigation settles sooner.
- [x] `src/pages/Portfolio.tsx` - holdings stay visible during refresh; realtime-driven reloads are debounced; watchlist empty-state waits for hydration instead of flashing early.
- [x] `src/pages/PlayerPortfolio.tsx` - public portfolios now preserve the last good snapshot during refreshes and debounce holdings/watchlist realtime bursts.
- [x] `npm run build` clean after the pass.

### Expected user-facing outcome
- Dashboard should feel snappier because quotes hydrate in one shared path instead of card-by-card fanout.
- Leaderboard and both portfolio pages should stop flickering back into loading states during normal refreshes.
- Slow auth/watchlist sync should degrade into localized loading states instead of making whole pages feel hung.

### Open / next improvements
- [ ] Add a small shared "Last updated / Refreshing" pattern across all data-heavy pages so users can tell the difference between stale data and an in-flight refresh.
- [ ] Consider server-backed aggregation for leaderboard/public portfolio snapshots if league size grows, because client-side `getAllPlayers + getAllHoldings + quotes` will eventually become the next bottleneck.
- [ ] Recheck News / Signals pages for similar repeated client fanout if those surfaces start to feel heavy under larger watchlists.
