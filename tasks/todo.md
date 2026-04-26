## Plan: Sprint D item 3 — 13F ownership aggregation in stock intelligence (2026-04-25)

### Goal
Enrich `/api/stock-intelligence` with a useful per-stock 13F ownership summary so agents and advanced users can see whether tracked institutional funds hold the name without stitching together the separate Funds workflows.

### Root cause
- The stock-intelligence schema explicitly advertised `fundOwnershipByStock` as unimplemented even though the app already had 13F parsing and fund-level holdings endpoints elsewhere.
- That meant agent consumers still had to reverse into the 13F subsystem manually for a common question: "which tracked funds hold this stock?"
- The missing piece was not raw 13F access but a normalized stock-level aggregation path.

### Shipped
- [x] `server.cjs` — stock intelligence now includes a `funds` section for US stocks with tracked-holder count, tracked universe size, total tracked value, total tracked shares, most recent filing date, and top matched holders.
- [x] `server.cjs` — added cached latest-holdings loaders for the curated `KNOWN_FUNDS` universe so repeated stock-intelligence calls do not refetch every 13F filer from scratch.
- [x] `server.cjs` — added explicit issuer-name matching and surfaced that method in both `funds.matchingMethod` and `dataAvailability.fundOwnershipByStock`.
- [x] `server.cjs` — `sources.funds` now documents that the ownership slice comes from SEC 13F-HR plus curated tracked-fund issuer-name matching.
- [x] `docs/stock-intelligence-schema.md` — updated the schema doc to include the new `funds` section and matching-method caveat.
- [x] `node --check server.cjs` passed.
- [x] `npm run build` passed.

### Expected user-facing outcome
- Agents can answer "which tracked funds hold this stock?" from one stock-intelligence payload instead of calling a separate fund search flow.
- Stock intelligence is materially richer for institutional-ownership context while staying honest about the current matching method and tracked-fund coverage.
- The new 13F path stays cache-friendly, so it improves the agent payload without turning the endpoint into a slow rebuild on every request.

---

## Plan: Sprint D item 2 — Server-backed leaderboard snapshots (2026-04-25)

### Goal
Reduce leaderboard load latency by serving `players + holdings + recent trades` as one server snapshot instead of rebuilding the page from three client-side Supabase reads on every load.

### Root cause
- `Leaderboard.tsx` still fetched `getAllPlayers()`, `getAllHoldings()`, and `getRecentTrades()` separately, then stitched the ranking view together in the browser.
- That meant more round trips, more partial-state churn, and more client work on one of the most frequently visited aggregate pages.
- We had already proven the same shape worked well for portfolio pages, so leaderboard was the next natural aggregation target.

### Shipped
- [x] `server.cjs` — added `GET /api/leaderboard-snapshot?limit=...` backed by server-side Supabase reads returning `{ players, holdings, recentTrades }` in one payload.
- [x] `server.cjs` — snapshot endpoint fails safely with explicit `503 / 502` responses so the client can degrade cleanly if the server-side read path is unavailable.
- [x] `src/api/supabase.ts` — added `getLeaderboardSnapshot(limit)` helper.
- [x] `src/pages/Leaderboard.tsx` — leaderboard now prefers the server snapshot path and falls back to the older `getAllPlayers + getAllHoldings + getRecentTrades` flow if the endpoint fails.
- [x] `node --check server.cjs` passed.
- [x] `npm run build` passed.

### Expected user-facing outcome
- Leaderboard should settle faster because its core data snapshot now comes back in one hop.
- Repeat refreshes should feel steadier because the page no longer depends on three separate client reads succeeding at the same time.
- The fallback path keeps the feature resilient if the server-side snapshot endpoint is temporarily unavailable.

---

## Plan: Sprint C item 1 — Deep Analyze cost tuning (2026-04-25)

### Goal
Cut routine Deep Analyze cost by routing the stock-page preset prompts through a cheaper Claude tier while keeping the full long-form deep dive on the premium model.

### Root cause
- Every Deep Analyze request was going through the same Sonnet model and large token budget, even when the user only clicked a narrow preset like `Bull Case` or `2-Week Setup`.
- The UX already distinguished presets from the full dive, but the backend pricing path did not.

### Shipped
- [x] `server.cjs` — split Deep Analyze model selection into:
  - `CLAUDE_MODEL_FULL` (default: Sonnet 4.5)
  - `CLAUDE_MODEL_PRESET` (default: Haiku 4.5)
- [x] `server.cjs` — preset stock analyses now use the cheaper model with a tighter token budget and slightly lower temperature.
- [x] `server.cjs` — full deep dives keep the premium model and large token budget.
- [x] `server.cjs` — cache keys now include the model/profile so preset and full responses do not collide.
- [x] `src/components/ai/DeepAnalyzeDrawer.tsx` — drawer now reflects whether the run is a cheaper preset path or a full premium deep dive.
- [x] `render.yaml` — added optional `CLAUDE_MODEL_FULL` and `CLAUDE_MODEL_PRESET` env vars for explicit Render control.

### Expected user-facing outcome
- Preset buttons should stay useful but become materially cheaper to run.
- `Full Deep Dive with Claude` remains the premium higher-depth path.
- The UI now makes that split clearer instead of implying every run is the same Sonnet-grade analysis.

---

## Plan: Sprint C item 2 — Signal evidence and sector-copy polish (2026-04-25)

### Goal
Make stock-level signal evidence faster to read and make unresolved Canadian sector metadata feel intentional instead of broken.

### Shipped
- [x] `src/pages/StockDetail.tsx` — added color-coded value treatment for positive/negative evidence rows so price-vs-average and relative-volume reads scan faster.
- [x] `src/pages/News.tsx` — Canadian filings that do not resolve a sector now use explicit `Unknown sector (CA)` copy in filters and row metadata.
- [x] `src/pages/InsiderActivity.tsx` — Canadian insider rows and sector filters now use the same `Unknown sector (CA)` fallback instead of a generic ambiguous `Unknown`.

### Expected user-facing outcome
- Signal Evidence reads become faster because the most important deltas are now visually encoded, not just written out.
- Users looking at Canadian names no longer have to guess whether a missing sector is a bug or simply unresolved metadata coverage.

---

## Plan: Sprint C item 3 — Shared data freshness/status pattern (2026-04-25)

### Goal
Make data-heavy pages communicate the same way about `cached`, `last updated`, and `refreshing` state instead of sprinkling one-off labels across the UI.

### Shipped
- [x] `src/components/ui/DataStatus.tsx` — added a shared compact status line for `Last updated`, `Cached snapshot`, and `Refreshing…`
- [x] `src/pages/Portfolio.tsx` — My Portfolio now shows the shared status line and distinguishes cached session seed data from fresh reloads
- [x] `src/pages/PlayerPortfolio.tsx` — public portfolios now use the same shared status line for cached/public snapshot loads and in-place refreshes
- [x] `src/pages/Leaderboard.tsx` — leaderboard header now shows a consistent last-updated / refreshing status instead of only embedding the refresh hint in subtitle text
- [x] `src/pages/News.tsx` — Market Signals now shows shared freshness state for the filings feed and a refresh-state hint for confluence updates
- [x] `src/pages/InsiderActivity.tsx` — insider page now shows the same shared status pattern driven by React Query update timestamps

### Expected user-facing outcome
- Users can tell the difference between stale-but-usable data and an active refresh more easily.
- Portfolio, insider, leaderboard, and filings pages now feel more coherent because they use one consistent status language.

---

## Plan: Sprint D item 1 — Stock intelligence schema docs (2026-04-25)

### Goal
Make the agent-ready stock intelligence object explicit and queryable so agents and developers do not have to infer the payload shape from application code.

### Shipped
- [x] `server.cjs` — added `GET /api/stock-intelligence/schema` returning a machine-readable schema, interpretation notes, and example payload
- [x] `docs/stock-intelligence-schema.md` — added a human-readable repo doc describing the endpoint purpose, core sections, interpretation notes, and recommended agent workflow

### Expected user-facing outcome
- Agent integrations can discover the stock-intelligence contract directly.
- Future developers have an explicit reference instead of reverse-engineering `buildStockIntelligence()`.

---

## Plan: Sprint B item 3 — Scheduled background sync for Congress + CA (2026-04-25)

### Goal
Keep the slowest market-data views warm proactively so Congress and Canadian insider pages do not wait for the next user hit after a restart or TTL expiry.

### Root cause
- We had one-time boot prewarm for options scan and a partial CA cache warmup, but not a recurring sync loop.
- That meant the app got faster right after startup, then drifted back into user-triggered refreshes once caches expired.
- Congress persistence and CA persistence were in place, but freshness still depended too much on interactive traffic.

### Shipped
- [x] `server.cjs` — added a shared repeating background-sync scheduler with explicit labels and error logging.
- [x] `server.cjs` — Congress now refreshes on a recurring 25-minute cadence via `refreshCongressTradesFromSource()`, keeping both memory cache and persisted DB rows fresh.
- [x] `server.cjs` — Canadian insider background sync now refreshes the most important caches on a recurring 25-minute cadence:
  - `7-insiders`
  - `7-filings`
  - `30-filings`
- [x] `server.cjs` — startup now begins the background sync loop from `app.listen(...)` instead of relying only on ad hoc boot prewarm calls.
- [x] `server.cjs` — added `DISABLE_BACKGROUND_SYNC=1` escape hatch for environments where proactive refreshes should be turned off.

### Expected user-facing outcome
- Congress and Canadian insider pages should stay consistently fast more often, especially after the app has been running for a while.
- Restarts should recover to a warm state automatically instead of waiting for the next user to trigger the first rebuild.
- Persisted market-data tables should stay fresher without relying solely on interactive traffic.

### Verification
- [ ] `node --check server.cjs`
- [ ] `npm run build`
- [ ] After deploy, confirm Render logs show background sync activity instead of only request-triggered refreshes.
- [ ] Recheck Supabase `market_data_sync_state` timestamps for `congress_trades` and `ca_insider_*` after the app has been idle.

---

## Plan: Sprint B item 2 — Portfolio snapshot aggregation (2026-04-25)

### Goal
Reduce portfolio route latency by collapsing `player + holdings + watchlist` into one server payload instead of assembling the snapshot from multiple client-side Supabase reads every time.

### Root cause
- `Portfolio.tsx` still fetched holdings separately on every load/reload, even after the earlier session-cache pass.
- `PlayerPortfolio.tsx` still assembled public portfolios from three independent queries (`player`, `holdings`, `watchlist`) and used `allSettled` mainly as a resilience patch, not a speed improvement.
- That meant more network round trips, more partial-state churn, and more waiting before the page could settle on a fresh snapshot.

### Shipped
- [x] `server.cjs` — added `GET /api/portfolio-snapshot?playerId=...` backed by server-side Supabase reads, returning `{ player, holdings, watchlist }` in one payload.
- [x] `server.cjs` — endpoint fails safely with explicit `400 / 404 / 503 / 502` responses instead of leaving the client to infer partial failures.
- [x] `src/api/supabase.ts` — added `getPortfolioSnapshot(playerId)` client helper.
- [x] `src/pages/Portfolio.tsx` — private portfolio now prefers the snapshot endpoint for fresh loads and falls back to direct `getHoldings()` if the endpoint is unavailable.
- [x] `src/pages/PlayerPortfolio.tsx` — public portfolio now prefers the snapshot endpoint, cutting the normal refresh path down to one request while preserving the older `allSettled` fallback if the endpoint fails.

### Expected user-facing outcome
- My Portfolio should settle faster on fresh loads because the main data payload comes back in one hop.
- Public portfolios should feel steadier and quicker, especially on repeat visits and realtime refreshes.
- The fallback path remains intact, so a temporary server-side issue degrades to the older slower path instead of breaking the page.

---

## Plan: Fix Congress DB persistence — duplicate-id upsert failure (2026-04-25)

### Goal
Make `congress_trades` actually fill in production. After the broader market-data persistence rollout, US insider (153 rows) and CA insider (12 rows) wrote successfully but `congress_trades` stayed at 0 with no entry in `market_data_sync_state`.

### Root cause
- `writeCongressTradesToDb` upserted the full Quiver payload in a single batch keyed on a composite `id` derived from `member + ticker + date + type + amount + disclosure + chamber`.
- The Quiver feed routinely contains rows that collapse to the same composite id (same member files multiple identical-shape entries).
- Postgres upsert with `ON CONFLICT` aborts the entire statement when the input batch contains duplicate conflict keys (`ON CONFLICT DO UPDATE command cannot affect row a second time`).
- One bad chunk killed the whole sync, so `setMarketDataSyncState` was never reached.
- US/CA pipelines were unaffected because their ids include filing-level uniqueness.

### Shipped
- [x] `server.cjs` — `writeCongressTradesToDb` now dedupes rows by `id` via a `Map` before upserting; in-batch duplicates can no longer poison the statement.
- [x] `server.cjs` — chunk size dropped from 500 → 200 to stay well under Supabase request limits.
- [x] `server.cjs` — per-chunk fault isolation: a failing chunk logs and continues so partial writes still land.
- [x] `server.cjs` — `writeCongressTradesToDb` now returns `{written, skipped, failedChunks}` instead of throwing, with a `[congress-db-write]` summary log per refresh.
- [x] `server.cjs` — `refreshCongressTradesFromSource` only updates `market_data_sync_state` when `written > 0`, and catches unexpected throws so the live fallback path keeps working.
- [x] `node --check server.cjs` clean.
- [x] `npm run build` clean.

### Required verification after deploy
- [ ] Hit `https://marketlens-jn9s.onrender.com/api/latest-congress?limit=20` to trigger a refresh.
- [ ] After ~30s, run `select count(*) from public.congress_trades;` — expect a non-zero row count.
- [ ] Run `select * from public.market_data_sync_state where dataset = 'congress_trades' order by synced_at desc;` — expect a fresh `synced_at` and `row_count`.
- [ ] Check Render logs for the `[congress-db-write] written=… skipped=… failedChunks=…` line to confirm dedup behaviour matches reality.

### Expected user-facing outcome
- Congress page becomes resilient to Render restarts and cache TTL expiry, matching US insider and CA insider behaviour.
- No visible UI change — purely a backend persistence and consistency fix.

---

## Plan: Persist Congress + Canadian market data for faster reads (2026-04-25)

### Goal
1. Make the slowest external research datasets load more predictably by moving them behind Supabase-backed storage instead of depending only on warm Render memory.
2. Keep the current live fallback behavior intact so the app still works before the migration/env rollout is finished.

### Root causes / context found
- Congress and Canadian insider/filing pages were fast only when the Render instance was warm and the in-memory caches were already populated.
- After restarts or cache expiry, users could end up paying the full upstream rebuild cost again, especially on Canadian filings.
- The earlier Phase 2 UI improvements were already done, but the data path still depended heavily on request-time external fetches.

### Shipped
- [x] `server.cjs` - added optional server-side Supabase client wiring via `SUPABASE_SERVICE_ROLE_KEY`, falling back cleanly when the service key or tables are not available.
- [x] `server.cjs` - added shared market-data sync-state helpers so server routes can tell whether persisted Congress / Canadian snapshots are fresh or stale.
- [x] `server.cjs` - Congress routes (`/api/latest-congress`, `/api/congress-trades`, `/api/congress-members`, stock-intelligence congress slice) now prefer Supabase-backed normalized trade rows when present, while still falling back to Quiver + memory cache safely.
- [x] `server.cjs` - Canadian insider route (`/api/ca-insider-activity`) now prefers Supabase-backed persisted rows when present and serves stale DB data first while refreshing in the background.
- [x] `server.cjs` - both persistence paths are guarded with DB-fallback logging so missing migrations do not break the live site.
- [x] `supabase_migration_market_data_cache.sql` - added schema for:
  - `market_data_sync_state`
  - `congress_trades`
  - `ca_insider_filings`
- [x] `render.yaml` - added `SUPABASE_SERVICE_ROLE_KEY` so Render can use the DB-backed fast path once configured.
- [x] `npm run build` clean after the persistence pass.
- [x] `node --check server.cjs` clean after the persistence pass.

### Required rollout steps
- [x] Run `supabase_migration_market_data_cache.sql` in the live Supabase project. (Verified 2026-04-25: tables exist; `us_insider_trades` populated with 153 rows, `ca_insider_filings` with 12 rows.)
- [x] Add `SUPABASE_SERVICE_ROLE_KEY` in Render and redeploy. (Live endpoint hits confirm DB-backed path is active.)

### Expected user-facing outcome
- Congress views should become more predictable across Render restarts because reads can come from persisted normalized rows instead of rebuilding from Quiver on demand.
- Canadian insider / filing tabs should become much steadier because the server can serve persisted DB rows first instead of relying purely on warm process memory.
- The app should remain safe during rollout because the old external-fetch fallback path is still intact if the migration or env var is missing.

### Open / next improvements
- [ ] Once the live migration is applied, consider adding a scheduled background sync so Congress / Canadian data refreshes proactively instead of waiting for the next user request.
- [ ] If DB-backed reads materially improve perceived speed, consider moving additional slow research datasets there next, especially market-wide filing feeds.

## Plan: Congress return ranking default (2026-04-25)

### Goal
1. Make the Congress page rank members by estimated trade performance by default instead of only raw disclosed activity size.

### Shipped
- [x] `server.cjs` - added estimated congress trade-return enrichment using post-disclosure stock performance, direction-adjusted so well-timed sells score positively when the stock later falls.
- [x] `src/api/congress.ts` - added `averageReturnPct` fields for member and ticker activity payloads.
- [x] `src/pages/Congress.tsx` - added `Best Returns` ranking and made it the default member ranking mode.
- [x] `npm run build` clean after the congress return-ranking change.

### Important interpretation note
- [x] Congress returns are estimated, not exact realized portfolio returns.
- [x] They are derived from stock performance since each disclosed trade date and weighted by disclosed trade-size ranges, because STOCK Act data does not include exact position sizes or a continuously reconciled holdings ledger.

## Plan: US insider speed + summary layer (2026-04-25)

### Goal
1. Remove the main remaining insider performance weak spot by giving US insiders the same DB-backed fast path as Congress and Canada.
2. Make insider data easier to scan for both humans and future agents by adding a compact net buy / sell / tax-heavy summary layer.

### Root causes / context found
- US insider activity was still only memory-cached, not persisted to Supabase.
- On cold rebuilds, the server still had to scan recent SEC daily indexes and then fetch multiple Form 4 XML files from EDGAR.
- The UI showed rows well, but it did not summarize whether the overall picture was net buy, net sell, tax-heavy, or mixed.

### Shipped
- [x] `server.cjs` - added optional Supabase persistence for US insider trades via `us_insider_trades`.
- [x] `server.cjs` - `/api/insider-activity` now prefers DB-backed reads when available and still falls back safely to the current SEC rebuild path.
- [x] `server.cjs` - widened US insider parsing to retain normalized event categories like `tax_withholding`, `grant`, `gift`, and `conversion_or_exercise` instead of only open-market buys/sells.
- [x] `server.cjs` - `/api/insider-activity` and `/api/ca-insider-activity` now return an `overview` object with:
  - market-level signal
  - buy / sell / tax / other value buckets
  - per-symbol quick-read summaries
- [x] `src/api/types.ts` - added `transactionCode`, `eventCategory`, and `InsiderOverview` typing.
- [x] `src/pages/InsiderActivity.tsx` - added a quick-read overview strip plus top-symbol summary chips so users can see `Net Buy`, `Net Sell`, `Tax Heavy`, or `Mixed` without reading every row.
- [x] `supabase_migration_market_data_cache.sql` - extended to include `us_insider_trades`.
- [x] `npm run build` clean after the insider speed + summary pass.

### Required rollout step
- [x] Re-run `supabase_migration_market_data_cache.sql` in the live Supabase project so the new `us_insider_trades` table exists in production. (Verified 2026-04-25: 153 rows persisted, `market_data_sync_state` shows `us_insider_7` synced.)

## Plan: Congress rankings + sector filters + RSI signal pass (2026-04-25)

### Requested improvements
1. Under Congress, show ranked member portfolios / broader activity context instead of only a flat latest-trades feed.
2. Add sector filters to `Market Signals` filings and `Insider Activity`.
3. Show whether a stock is overbought or oversold.
4. Keep the architecture clean so the new features do not make loading worse.

### Root causes / context found
- Congress only exposed latest trade rows, even though the Quiver feed was rich enough to group members and infer activity portfolios.
- `Insider Activity` and `Market Signals` had no sector metadata layer, so filtering by sector was impossible.
- Stock pages had trend and volume context, but no momentum oscillator to classify overbought / oversold conditions.
- A naive implementation would have created per-row symbol/profile fetch fanout and made the pages feel slower.

### Shipped
- [x] `server.cjs` - added cached `/api/congress-members?days=...` aggregation for ranked member activity portfolios over disclosed trading activity.
- [x] `src/api/congress.ts` + `src/hooks/useCongressTrades.ts` - added typed client support for the new congress-member aggregation endpoint.
- [x] `src/pages/Congress.tsx` - upgraded Congress to show:
  - ranked member activity cards
  - sort modes for most active / biggest buyers / biggest sellers
  - an inferred activity portfolio detail view with top tickers and recent disclosures
  - the original latest-trades tape still intact below
- [x] `server.cjs` - added shared cached `/api/symbol-metadata` support for symbol → sector/industry enrichment.
- [x] `server.cjs` - added `/api/company-metadata` so filing subject companies can be resolved to ticker + sector metadata without forcing server-side SEC browse-edgar fetches from cloud IPs.
- [x] `src/pages/InsiderActivity.tsx` - added a sector filter driven by cached symbol metadata and surfaced sector tags on insider cards where available.
- [x] `src/pages/News.tsx` - kept the browser-side EDGAR filings fetch path, then enriched filings with cached company metadata and added a sector filter plus symbol/sector labels in the filing rows.
- [x] `src/utils/indicators.ts` - added RSI(14) calculation.
- [x] `src/pages/StockDetail.tsx` - added a Momentum pill and RSI evidence row so the stock page now shows `Overbought / Neutral / Oversold` status.
- [x] `npm run build` clean.
- [x] `node --check server.cjs` clean.

### Expected user-facing outcome
- Congress is now useful as both a live tape and a ranked “who is trading what?” surface.
- Insider and filing pages can be narrowed by sector without adding per-row network stalls.
- Stock pages now provide a clearer momentum read instead of only trend and participation.

### Open / next improvements
- [ ] Add explicit “Unknown sector” UI language for Canadian names that do not resolve cleanly through current metadata providers.
- [ ] Consider a dedicated Congress member detail route if users start wanting persistent sharable member pages.
- [ ] If users want stronger overbought/oversold confirmation, add Stochastic or distance-from-20DMA next to RSI instead of relying on RSI alone.

## Plan: Agent-ready stock intelligence foundation (2026-04-25)

### Goal
1. Start turning the app into something agents can consume directly instead of forcing them to scrape UI cards.
2. Expose one structured stock payload that aggregates the existing quote, trend, insider, filing, congress, and event context into a normalized JSON response.

### Root causes / context found
- The site already has meaningful signal data, but it is spread across many independent UI surfaces and endpoints.
- That makes the product useful for humans, but weaker for agents that need one stable object describing what is happening around a stock.
- The biggest missing primitive was a single machine-friendly endpoint that can answer "what matters about this symbol right now?" without extra scraping or orchestration.

### Shipped
- [x] `server.cjs` - added `GET /api/stock-intelligence?symbol=...`.
- [x] The endpoint returns a normalized stock intelligence payload with:
  - company identity and market
  - price and participation metrics
  - trend metrics (20/50/200 day averages and deltas)
  - event counts and earnings timing
  - insider summary and recent insider trades
  - recent 13D / 13G ownership filings
  - congress trading summary
  - available fundamentals
  - derived signal labels and plain-English explanations
  - source / data-availability metadata for agent consumers
- [x] `server.cjs` - added 10-minute in-memory caching plus in-flight dedupe for the new stock-intelligence builder.
- [x] `server.cjs` - reused existing data sources where possible: Yahoo candles, Finnhub quote/fundamentals/news/earnings, SEC insider cache, SEC ownership filings, Quiver congress data, and TMX quote context for Canadian tickers.
- [x] `npm run build` clean after the endpoint work.
- [x] `node --check server.cjs` clean after the endpoint work.

### Expected outcome
- Agents now have a single structured entry point for stock-level reasoning instead of scraping multiple pages.
- This creates the foundation for future agent workflows like watchlist scanning, daily briefs, ranked signals, and alert generation.

### Open / next improvements
- [ ] Add a client-side helper or admin/dev docs page showing the exact schema and example response for `/api/stock-intelligence`.
- [ ] Expand the payload with stock-level 13F ownership aggregation once there is a clean "which tracked funds own this symbol" path.
- [ ] Add short-interest and options-positioning fields when a reliable provider is introduced.

## Plan: Portfolio + filings speed cleanup (2026-04-25)

### Reported issue
1. Portfolio pages still feel delayed when opened, especially public portfolios.
2. Filings surfaces still feel slow when their caches expire or when users revisit them after navigation.

### Root causes found
- Private portfolio already had a holdings session cache, but public portfolios always started cold and waited on fresh `player + holdings + watchlist` Supabase queries.
- Market Signals 13D/13G results relied on React Query memory only, so revisits after route changes or reloads had no immediate fast path.
- `/api/13f/recent-filers` and `/api/13f/recent-filings` blocked on rebuild whenever their caches were stale, instead of serving stale data first and refreshing in the background.

### Shipped
- [x] `src/pages/PlayerPortfolio.tsx` - added session-backed snapshot caching for public portfolios so repeat visits can render immediately from the last good `player + holdings + watchlist` state.
- [x] `src/pages/PlayerPortfolio.tsx` - public portfolio refresh still reconciles against live Supabase data, but the cached snapshot stays visible while the fresh load resolves.
- [x] `src/pages/News.tsx` - added a session cache for market filings keyed by selected day window and wired it into React Query `initialData` / `initialDataUpdatedAt`.
- [x] `server.cjs` - added stale-while-revalidate plus in-flight dedupe for `/api/13f/recent-filers`.
- [x] `server.cjs` - added stale-while-revalidate plus in-flight dedupe for `/api/13f/recent-filings`.
- [x] `npm run build` clean after the performance pass.

### Expected user-facing outcome
- Public portfolios should open much faster on repeat visits instead of flashing a cold load every time.
- The Market Signals filings list should feel immediate on revisits within the same session.
- 13F recent-filers and recent-filings should stop feeling hung when their server caches expire.

### Open / next improvements
- [ ] If portfolio lag is still noticeable on first signed-in load, move holdings aggregation to a server/RPC path so the app can fetch one compact payload instead of piecing it together client-side.
- [x] Market Signals 13D/13G aggregation moved behind cached `/api/market-filings` (2026-04-25): client `edgar.getRecentFilings` now hits the server endpoint first (server fans out 4 EDGAR feeds once/hour, dedupes, enriches with symbol+sector). Endpoint upgraded to stale-while-revalidate so a stale cache is served instantly while the rebuild runs in the background; client-side 4-feed fanout retained as fallback only.

## Plan: Deep Analyze activation + admin activity tracking (2026-04-24)

### Reported goals
1. Finish setting up Deep Analyze so the Anthropic-backed stock briefing flow is actually usable live.
2. Add admin visibility into who is active and what people are searching inside the app.

### Root causes / context found
- Deep Analyze already existed in code, but the stock page only exposed a single generic button and the Render env did not explicitly advertise `ANTHROPIC_API_KEY`.
- The app had no presence or search telemetry layer at all, so `/admin` could not show online state, last active times, or recent stock searches.

### Shipped
- [x] `src/pages/StockDetail.tsx` - added Deep Analyze presets for `Bull Case`, `Bear Case`, `2-Week Setup`, and `What Changes The Thesis`, while keeping the full deep-dive button.
- [x] `src/components/ai/DeepAnalyzeDrawer.tsx` - added stock-analysis `focus` support and clearer Anthropic-key setup errors.
- [x] `server.cjs` - `/api/deep-analyze` now accepts stock `focus` and adjusts the prompt framing accordingly.
- [x] `render.yaml` - added `ANTHROPIC_API_KEY` so the deployment config reflects the live Deep Analyze feature.
- [x] Live verification: `POST https://marketlens-jn9s.onrender.com/api/deep-analyze` returned `200` on 2026-04-24 with a real Claude response after the key was added.
- [x] `src/App.tsx` - added throttled player activity heartbeats tied to the signed-in player.
- [x] `src/pages/Search.tsx` - logs search terms and selected result symbols for signed-in users.
- [x] `src/api/supabase.ts` - added `touchPlayerActivity`, `recordSearchLog`, and `getRecentSearchLogs`, plus support for `players.last_active_at`.
- [x] `src/pages/Admin.tsx` - rebuilt the admin surface to include online count, last-active state per player, and a recent-search log section.
- [x] `supabase_migration_admin_activity.sql` - added migration for `players.last_active_at` and `search_logs`.
- [x] `npm run build` clean after both the Deep Analyze and admin activity work.
- [x] Shipped in commits `94577c8` and `594c4d8`.

### Expected user-facing outcome
- Deep Analyze is now genuinely live and more useful on stock pages.
- Admin can see who has been active recently and what search activity is happening in-app.

### Open / next improvements
- [ ] Run `supabase_migration_admin_activity.sql` in the live Supabase project so the new admin activity data persists in production.
- [ ] Cost-tune Deep Analyze by moving preset analyses to a cheaper Claude tier and reserving Sonnet for the full deep-dive path.

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
- [x] `StockDetail` chunk audited 2026-04-25 — chart lib (`lightweight-charts`) is the dominant cost and must stay eager since the chart is the page's primary visual. Modals (DeepAnalyzeDrawer, FilingSheet, TradeModal) split into separate chunks; FilingSheet shrunk 51kB→12.7kB once it stopped statically importing DeepAnalyzeDrawer.
- [x] `index` main chunk 484kB→475kB after lazy-loading AddPositionModal, AddWatchlistModal, and TradeModal across Sidebar, Portfolio, and StockDetail. Edgar API code split into a 27kB chunk pulled on demand.
- [x] `SpMoverChain` recursive 1-component-per-symbol pattern in Sidebar replaced with a single batched `useStockQuotes` call covering both S&P movers and watchlist rows. Portfolio / Leaderboard / PlayerPortfolio / Dashboard already used the batched path; the Sidebar was the remaining hotspot.
- [x] Section-level error boundaries added around Portfolio summary/holdings/watchlist, Leaderboard podium/rows, and PlayerPortfolio holdings/watchlist via a new `compact` mode on `ErrorBoundary` so a single bad row can no longer blank an entire page.

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
