## Plan: Insider Activity + Ask AI Upgrade + Watchlist Persistence

### Current Status
- Scope confirmed:
  - Dedicated `Insider $` page below `Market Signals`
  - Market-wide insider activity feed with buys and sells
  - Stronger stock-detail `Ask AI` using technicals, insider flow, and news
  - Server-backed watchlist persistence for signed-in users with local fallback
- Local implementation work has already started in this workspace
- Verification is not complete yet
- `npm run build` was attempted, but Vite/esbuild hit a sandbox `spawn EPERM` restriction before full verification could finish

---

### 1. Insider $ page
- [x] Add route for `/insiders`
- [x] Add sidebar navigation entry below `Market Signals`
- [x] Add mobile navigation entry
- [x] Create `Insider $` page UI with:
  - [x] `All / Buys / Sells` filter
  - [x] `Largest $ / Newest` sort toggle
  - [x] ticker, company, insider, title, date, shares, price, value, exchange display
  - [x] color-coded `BUY` / `SELL` badges
- [x] Add backend endpoint for normalized insider activity feed
- [x] Use SEC daily index / archives flow instead of leaning harder on EDGAR CGI
- [ ] Validate feed quality against live data
- [ ] Confirm whether Canadian market-wide coverage needs a follow-up source/integration pass

---

### 2. Ask AI on stock detail
- [x] Keep feature on `StockDetail` only
- [x] Extend client context sent to `/api/ask-stock`
  - [x] candles
  - [x] insider transactions
  - [x] recent news headlines
- [x] Add server-side technical summary generation
  - [x] support / floor levels
  - [x] threshold / resistance levels
  - [x] Bollinger Bands
  - [x] simple pattern / regime read
- [x] Upgrade AI prompt to return structured market-analysis output
- [ ] Manually test multiple stock questions
- [ ] Verify fallback behavior when news or AI config is missing

---

### 3. Watchlist persistence
- [x] Add Supabase schema for `watchlists`
- [x] Add Supabase helpers for get / upsert / remove / replace watchlist items
- [x] Rework Zustand watchlist store to support:
  - [x] signed-in profile hydration
  - [x] server sync on add/remove
  - [x] local fallback when not authenticated
- [x] Hook auth/session restore into watchlist initialization
- [ ] Verify no incorrect default-watchlist flash during hydration
- [ ] Verify persistence across reloads and multiple sessions
- [ ] Verify unauthenticated/demo mode still behaves correctly

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
