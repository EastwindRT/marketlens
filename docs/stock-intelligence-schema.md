# Stock Intelligence Schema

Endpoint:

`GET /api/stock-intelligence?symbol=NVDA`

Machine-readable schema:

`GET /api/stock-intelligence/schema`

Purpose:

- Give agents and internal UI code one normalized stock object instead of forcing them to combine quotes, trend data, insider activity, ownership filings, congress trades, and fundamentals across separate calls.

Core sections:

- `symbol`, `asOf`, `market`
- `company`
- `price`
- `trend`
- `events`
- `insiders`
- `ownershipFilings`
- `congress`
- `fundamentals`
- `signals`
- `explanations`
- `dataAvailability`
- `sources`

Important interpretation notes:

- `congress` is disclosed trade activity, not a guaranteed live holdings ledger.
- `ownershipFilings` is currently US-only.
- `company.sharesOutstanding` is available when the quote/profile provider exposes it.
- `fundamentals.shareFloat` and `fundamentals.shortFloatPercent` remain nullable because the current provider stack does not reliably expose them for all names.
- `dataAvailability.shortInterest` and `optionsPositioning` are still placeholders for future provider-backed expansions.
- Null fields are expected when a source is unavailable for that market or symbol.

Recommended agent workflow:

1. Call `/api/stock-intelligence?symbol=...`
2. Read `signals`, `events`, and `explanations` first for fast triage.
3. Inspect `insiders`, `ownershipFilings`, and `congress` for supporting evidence.
4. Use `sources` and `asOf` to judge freshness and coverage.

Example use cases:

- daily stock brief generation
- watchlist anomaly detection
- insider / ownership / congress confluence scanning
- fast bull / bear thesis updates
