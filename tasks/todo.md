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
