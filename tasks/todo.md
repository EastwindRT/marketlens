## Plan: Ask AI Context Enrichment — SHIPPED 2026-04-16 (commit 1fe3d03)

### Diagnosis
- User reported Ask AI chat on stock detail was producing generic, shallow answers
- Audit revealed the model (Llama 3.3 70B via Groq) was not the issue — the **context** was
- Only ~20 days of technical data, 5 news headlines (no dates), 5 raw insider trades, no fundamentals, no analyst data, no earnings calendar, max_tokens capped at 512

### Features (Option B from AI audit)
- [x] Rewrote `summarizeTechnicals` in `server.cjs` to use full 90-bar window:
  - SMA20 + SMA50 with price-vs-MA % for each
  - Bollinger (20,2) with tight/wide flags
  - 20/60/90-bar support and resistance tiers
  - 10/30/60/90-bar return percentages
  - 5d-vs-30d volume trend ratio
  - Expanded pattern detection (sustained up/down, squeeze, rebound)
  - Regime read across multiple timeframes
- [x] New `summarizeFundamentals` helper:
  - Valuation: P/E, PEG, P/S, EPS TTM
  - Growth: revenue YoY, EPS YoY
  - Margins: gross/op/net, ROE
  - 52-week range with price % from high and low
  - Analyst consensus (strong buy/buy/hold/sell/strong sell distribution)
  - Price target with mean/high/low and implied upside %
  - Next earnings date with days-until countdown
- [x] New `summarizeInsiders` helper:
  - Windowed counts (30d / 90d / 1y / 2y) each with net $ flow and unique-buyer count
  - Biggest single buy + biggest single sell
  - Top 5 most recent transactions
- [x] `summarizeNews` now adds recency label (today/Nd ago/Nw ago/Nmo ago)
- [x] `max_tokens` 512 → 1500; system prompt updated to reference new sections and tie technical to fundamental reads
- [x] Client: `finnhub.getBasicFinancials` + `getEarningsCalendar` helpers
- [x] Client: new `useStockAIContext(symbol)` hook — parallel-fetches Finnhub basics, recommendations, price target, and earnings calendar (US only; 1h stale time)
- [x] `StockDetail` passes fundamentals + `priceRaw` into the AI chat context
- [x] Build clean; pushed to Render (commit 1fe3d03)

### Open items (deferred)
- [ ] Ask AI manual QA on the new rich context (verify answers are actually more specific)
- [ ] Consider upgrading the model itself to Claude Sonnet 4.5 if quality is still below bar (Option A from audit)
- [ ] Canadian stock fundamentals (Finnhub `stock/metric` is US-only; TSX AI chat runs with just candles + insiders + news)
- [ ] Watchlist E2E (requires live Supabase auth login)

---

## Plan: Canadian Insider Endpoint Fixes — SHIPPED 2026-04-16 (commits 65935e7 + 5c5cb57)

### Bugs fixed
- [x] TMX GraphQL query was including subfields, but `getInsiderTransactions` returns a scalar `JSON` type — every request errored out server-side, `json.data?.getInsiderTransactions` was `undefined`, `?? []` silently returned empty. Removed subfield selection.
- [x] BUY/SELL classification was wrong: SEDI code 1 means "open-market transaction" for BOTH buys and sells. Sign of `amount` determines direction (positive = buy, negative = sell). Previous code mapped code 1 → BUY and code 2 → SELL; code 2 barely appears in practice, so sells were mislabeled as buys.
- [x] Filter `t.amount <= 0` was dropping legitimate sells (negative amounts). Changed to `t.amount === 0`.

### Coverage
- [x] Expanded `CA_TSX_STOCKS` from ~45 large-caps to ~110 stocks — added mid-caps, miners, energy, REITs, tech names where executive open-market activity is more common
- [x] Updated UI loading note: "Querying ~110 TSX stocks via SEDI — may take 20–40s on first load"
- [x] Build clean; pushed to Render

---

## Plan: Canadian Insider Tabs — SHIPPED 2026-04-16 (commit 01a46e6)

### Features
- [x] Added `httpsPost` helper to `server.cjs` for TMX GraphQL calls
- [x] New `/api/ca-insider-activity?days=N&mode=insiders|filings` endpoint — queries ~45 major TSX stocks via TMX GraphQL in batches of 5; `mode=insiders` returns only open-market buys/sells (transactionTypeCode 1 or 2); `mode=filings` returns all SEDI types; 30min TTL cache keyed by days+mode
- [x] `InsiderActivity.tsx` refactored with three-tab market switcher: 🇺🇸 US (SEC Form 4) | 🇨🇦 CA Insiders (SEDI open-market) | 🇨🇦 CA Filings (all SEDI types)
- [x] Shared period (7D/14D/30D), sort (value/date), buy/sell filter controls across all tabs; buy/sell filter hidden on CA Filings tab
- [x] `InsiderFeedItem.type` extended to `'BUY' | 'SELL' | 'OTHER'` for SEDI grants and options
- [x] Build clean; pushed to Render (commit 01a46e6)

### Open items (deferred)
- [ ] Watchlist E2E (requires live Supabase auth login)
- [ ] Ask AI manual QA (multi-question flow and fallback states)
- [ ] CA insider coverage beyond curated 45-stock list

---

## Plan: Funds Holdings Simplification — SHIPPED 2026-04-14 (commit 7be0224)

### Features
- [x] New server endpoint `/api/13f/recent-filings` — scans last 60 days of EDGAR daily-index `.idx` files for 13F-HR entries; deduplicates by CIK; 24h cache; cloud-safe (no cgi-bin)
- [x] Funds landing page replaced: removed slow cross-fund options scan (60s+, 429-prone) and curated 35-fund grid (35 EDGAR calls per cache miss)
- [x] New landing: clean sorted list of recent filers — name, filed date, CIK — click any row to load full holdings on demand
- [x] Fund detail view (tabs, options, AI chat, sector chart) unchanged
- [x] Funds chunk: 27.9kB → 23.3kB

### Open items (deferred)
- [ ] Watchlist E2E (requires live Supabase auth login)
- [ ] Ask AI manual QA (multi-question flow and fallback states)
- [ ] Canadian insider coverage (US-only; TMX SEDI future task)

---

## Plan: Chart Fix / EDGAR CGI / Bundle Size — SHIPPED 2026-04-14 (commit 5aeed4e)

### Features
- [x] Chart persistence: `key={symbol}` added to `ChartWithResponsiveHeight` in `StockDetail.tsx` — forces full remount on ticker change, fixes AAPL graph sticking
- [x] EDGAR CGI: `/api/latest-insiders` migrated from blocked `cgi-bin/browse-edgar` atom feed to `fetchRecentForm4Entries()` daily-index approach — cloud-safe on Render
- [x] Bundle size: lazy-loaded all pages except Dashboard; initial bundle 838kB → 483kB (42%); StockDetail splits into separate 231kB chunk
- [x] Build clean; pushed to Render (commit 5aeed4e)

### Open items (require live session, deferred)
- [ ] Watchlist E2E (requires live Supabase auth login)
- [ ] Ask AI manual QA (multi-question flow and fallback states)
- [ ] Canadian insider coverage (US-only; TMX SEDI future task)

---

## Plan: Insider $ / Congress / Funds Improvements — SHIPPED 2026-04-14

### Features
- [x] Insider $: 7D / 14D / 30D period toggle; evenly-sampled entries per period; per-period server cache
- [x] Congress: compact amount display — bold midpoint estimate (~$8K) + range ($1K–$15K) below
- [x] Funds — Options tab: CALL/PUT/All sub-filter; unified value-sorted list; clickable rows; NEW badge
- [x] Funds — New/Active tab: sorted by value desc (largest new bets first)
- [x] Funds — All long tabs: ≥$10M toggle to filter large positions
- [x] Funds — Landing: cross-fund options scan across all 35 curated funds; pre-warms on server start; grouped by security; shows fund count when multiple funds hold same option; clicking opens that fund's options tab
- [x] Build clean; pushed to Render

### Open items
- [ ] Watchlist E2E (requires live auth login — deferred)
- [ ] Canadian insider coverage (US-only currently; TMX SEDI future task)

---

## Plan: Insider Activity + Ask AI Upgrade + Watchlist Persistence — SHIPPED 2026-04-13

### Current Status
- All three features implemented, verified locally, and pushed to production (Render)
- Two bugs discovered and fixed during verification (see Review section)

---

### 1. Insider $ page — DONE
- [x] Route `/insiders`, sidebar + mobile nav link
- [x] UI: All/Buys/Sells filter, Largest$/Newest sort, BUY/SELL badges
- [x] Backend: `/api/insider-activity` using EDGAR daily index (fixed-width parser)
- [x] Feed validated: returns real open-market Form 4 trades (37 on 2026-04-10)
- [ ] Canadian coverage — US-only for now; TMX SEDI integration is a future task

---

### 2. Ask AI on stock detail — DONE
- [x] `/api/ask-stock` receives candles, insider transactions, news headlines
- [x] Server-side technical summary: support/resistance, Bollinger Bands, regime read
- [x] Structured AI prompt with market-analysis output
- [x] Fallback verified: returns "AI not configured" (503) when keys are missing

---

### 3. Watchlist persistence — DONE (auth E2E deferred)
- [x] Supabase `watchlists` schema + helpers for get/upsert/remove/replace
- [x] Zustand store: Supabase sync on sign-in, local fallback when unauthenticated
- [x] Auth session restore wired to watchlist initialization
- [ ] Full E2E test across reloads and multiple sessions — requires live auth login

---

### 4. Verification — COMPLETE (2026-04-13)
- [x] Run `npm run build` — clean, no errors
- [x] `/api/insider-activity` — returns live SEC Form 4 trades (37 open-market transactions)
- [x] `/insiders` route registered in App.tsx
- [x] Sidebar nav + mobile nav both have Insider $ link
- [x] Ask AI endpoint responds correctly; returns "AI not configured" gracefully when keys missing
- [x] Congress endpoint working (Quiver 500 is a provider-side outage, not our code)
- [ ] Watchlist E2E (requires live auth login — deferred)

---

### 5. Docs update — COMPLETE
- [x] `Status.md` updated — features moved to Shipped
- [x] `lessons.md` — two new lessons added (fixed-width index format, xmlMatch boolean check)
- [x] `todo.md` — marked complete

---

## Review
- **Two bugs fixed during verification:**
  1. `fetchRecentForm4Entries` was filtering for `|` but EDGAR daily index is fixed-width — 0 entries parsed before fix
  2. `inferOwnerTitle` used `xmlMatch` with no-capture-group regexes; `match[1].trim()` threw on any director/officer XML tag
- Both bugs were latent: with 0 entries, `fetchSecInsiderActivityItem` was never reached, so the trim crash never fired until the parser was fixed
- Canadian market-wide insider coverage: currently US-only (SEC Form 4). TMX SEDI integration for Canadian coverage is a future task.
- `latest-insiders` endpoint uses EDGAR CGI atom feed — works locally, will fail on Render (cloud IP blocked). Should be migrated to a cloud-safe path before relying on it in production.
