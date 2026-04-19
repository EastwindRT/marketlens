## Plan: Sprint 1 + Sprint 2 — IN PROGRESS 2026-04-18

### Sprint 1 — Reliability & Trust
- [ ] 1. Retry + backoff helper (`fetchWithRetry`) wrapping external fetches in server.cjs
- [ ] 2. Cache `/api/ask-stock` + `/api/ask-fund` responses (symbol+question-hash key, 15min TTL)
- [ ] 3. CA Insider cache split per mode (insiders vs filings — avoid refetch on tab switch)
- [ ] 4. Error + empty states on Dashboard / Search / Congress / News
- [ ] 5. CA Insider tab loading skeleton
- [ ] 6. Structured request logging (reqId, route, ms, status)
- [ ] 7. `optionsScanBuilding` error guard (always reset in finally)

### Sprint 2 — Core Research UX
- [ ] 1. Earnings Calendar page (`/calendar`) — list upcoming earnings, filter by watchlist
- [ ] 2. Peer Comparison module on StockDetail — side-by-side peers
- [ ] 3. Technical Indicators toggle on chart (RSI, MACD)
- [ ] 4. News pagination / load more beyond 6
- [ ] 5. Funds landing enrichment (sector / filing count badges)

### Verification
- [ ] `npm run build` clean
- [ ] Manual spot-check of touched endpoints
- [ ] Update Status.md, lessons.md when done
