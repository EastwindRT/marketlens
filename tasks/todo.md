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
