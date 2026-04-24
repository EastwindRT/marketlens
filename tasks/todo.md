## Plan: Stock signal evidence upgrade + chart reliability (2026-04-23)

### Reported issue
1. Stock pages were showing useful signal labels, but not enough supporting data to explain what `Mixed Trend`, `20DMA / 50DMA`, or `Participation` actually meant.
2. Stock charts could crash with `Value is null` after the new filing markers shipped.

### Root causes found
- The first pass of the signal panel emphasized summaries over evidence, so users saw a conclusion before they saw the numbers that produced it.
- The chart mixed marker time formats: ownership filings were being passed as `YYYY-MM-DD` strings while some chart ranges were using numeric timestamps, which caused `lightweight-charts` to fail.

### Shipped
- [x] `src/utils/indicators.ts` - added reusable average-volume and relative-volume helpers so the signal layer can compare current volume to a 20-day baseline.
- [x] `src/components/chart/StockChart.tsx` - added `13D / 13G` filing markers on the stock chart.
- [x] `src/components/chart/StockChart.tsx` - normalized insider / filing markers against the actual chart bar timestamps and skipped markers that do not map to a visible bar, fixing the `Value is null` crash.
- [x] `src/pages/StockDetail.tsx` - added a `Signal Summary` panel with trend, participation, catalyst, and event-risk reads.
- [x] `src/pages/StockDetail.tsx` - rewrote signal wording in plain English so `20DMA`, `50DMA`, and `participation` explain themselves on the page.
- [x] `src/pages/StockDetail.tsx` - added a `Signal Evidence` table with current price, 20-day average, 50-day average, trend deltas, relative volume, volume-vs-average, and ownership activity context.
- [x] `npm run build` clean after the stock signal and chart reliability changes.
- [x] Shipped in commits `2969002`, `8cefd4e`, `7a18ccc`, and `cde7e72`.

### Expected user-facing outcome
- Stock pages now show both the signal conclusion and the evidence behind it.
- Users can see why a stock is labeled as `Mixed Trend` instead of having to infer it from shorthand.
- Ownership-event markers remain visible on the chart without crashing stock pages.

### Open / next improvements
- [ ] Add color-coded positive / negative deltas in the evidence table so price-vs-average reads even faster.
- [ ] Add more evidence rows if we later introduce short interest, options positioning, or earnings-reaction data providers.

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

## Plan: Ask AI depth upgrade (2026-04-22)

### Reported issue
1. Stock-detail Ask AI answers felt too shallow and too generic compared with the data available on the page.

### Root causes found
- `/api/ask-stock` was still optimized like a quick single-turn chat despite having much richer stock context available.
- Follow-up questions were stateless: the client sent only the newest question, so the model lost the prior conversation and kept restarting from scratch.
- The Groq prompt emphasized brevity, which made the model compress conclusions instead of walking through the evidence.

### Shipped
- [x] `src/pages/StockDetail.tsx` - Ask AI now sends the last few chat turns as history so follow-up questions keep context.
- [x] `src/pages/StockDetail.tsx` - Ask AI context now includes the company name alongside the symbol.
- [x] `server.cjs` - `/api/ask-stock` now accepts conversation history and passes a trimmed multi-turn window to Groq.
- [x] `server.cjs` - upgraded the stock-analysis system prompt to force a clearer thesis, evidence, bull/bear framing, and "what would change my mind" reasoning.
- [x] `server.cjs` - increased Ask AI response budget (`max_tokens` 1500 -> 2200) and lowered temperature (`0.4 -> 0.25`) for more detailed and more consistent answers.
- [x] `npm run build` clean after the change.

### Expected user-facing outcome
- Follow-up questions should feel like a real conversation instead of a reset.
- Broad questions should return a more PM-style note with clearer reasoning and more supporting detail.
- Answers should be less generic because the model is being pushed to synthesize chart, fundamentals, insider flow, and news into one thesis.

## Plan: Chunk-load recovery after deploys (2026-04-22)

### Reported issue
1. After deploy, users could hit `Failed to fetch dynamically imported module` and the app would stop loading route pages.

### Root causes found
- The browser still had an older app shell / lazy-route reference in memory while Render was already serving a newer build with different hashed chunk filenames.
- The Express SPA fallback returned `index.html` for missing `/assets/...` requests, so stale chunk requests got HTML instead of a real 404, which made the module failure harder to recover from cleanly.

### Shipped
- [x] `src/App.tsx` - lazy route imports now auto-reload the app once when they detect a stale chunk / dynamic import failure.
- [x] `server.cjs` - `index.html` is now served with `Cache-Control: no-store` so the app shell refreshes more aggressively after deploys.
- [x] `server.cjs` - hashed `/assets/...` files are now marked immutable for proper long-term caching.
- [x] `server.cjs` - missing asset requests now return a real 404 instead of falling through to the SPA HTML shell.
- [x] `npm run build` clean after the change.

## Plan: Insider coverage expansion (2026-04-22)

### Reported issue
1. Insider pages still felt too sparse even when the feeds were technically current.

### Root causes found
- US insider activity was being aggressively thinned by per-day sampling before XML parsing, which kept the feed current but too small.
- Canadian coverage still depended on a relatively narrow curated symbol list, so live SEDI activity outside that universe never appeared.
- The page still defaulted to thinner views, which hid the denser information even when it was already available.

### Shipped
- [x] `server.cjs` - widened US Form 4 sampling substantially and switched SEC XML fetches to bounded batches instead of a tiny sampled set.
- [x] `server.cjs` - expanded the Canadian insider universe with a larger TMX/SEDI symbol set and deduped it into a broader scan list.
- [x] `src/pages/InsiderActivity.tsx` - page now defaults to `CA Filings` and `30D` so users land on the fuller dataset first.
- [x] `src/pages/InsiderActivity.tsx` - insider requests now ask for larger result windows and the footer shows visible-vs-total transaction counts.
- [x] `npm run build` clean after the change.

## Plan: Market Signals + Insider hardening (2026-04-22)

### Reported issue
1. Market Signals felt unreliable and thin.
2. Insider pages still stalled or felt fragile when tabs and periods changed.

### Root causes found
- Market Signals was calling insider hooks inside a dynamic `map`, which is a brittle hook pattern and scales poorly with watchlist size.
- Market Signals confluence used client-side congress ticker fetches that did not have the same complete House/Senate backing as the server cache.
- US insider refreshes still rebuilt synchronously after cache expiry, which made SEC `429` limits more visible on cold or stale hits.

### Shipped
- [x] `server.cjs` - added `/api/congress-trades` so watchlist confluence queries reuse the server-side Quiver cache instead of faning out brittle client fetches.
- [x] `src/api/congress.ts` - ticker and watchlist congress lookups now prefer the new server endpoint and only fall back locally if needed.
- [x] `src/hooks/useInsiderData.ts` - extracted a reusable `fetchInsiderData()` path so watchlist insider queries can stay consistent without hook misuse.
- [x] `src/pages/News.tsx` - rebuilt Market Signals with stable `useQueries`, explicit loading/error/empty states, and watchlist-first confluence behavior.
- [x] `server.cjs` - US insider activity now uses an in-flight cache build map plus stale-while-revalidate semantics instead of blocking every stale request.
- [x] `server.cjs` - reduced SEC XML batch concurrency to be gentler on `sec.gov` rate limits during cold cache rebuilds.
- [x] `src/pages/InsiderActivity.tsx` - rebuilt insider page copy and loading behavior so tab/period switches keep prior data visible and show a lightweight refreshing state.
- [x] `npm run build` clean after the change.
