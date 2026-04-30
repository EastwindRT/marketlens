## Lesson: 2026-04-25 - Derived signals are only trustworthy when missing providers are called out explicitly

**Observation:** We could add useful ownership-conviction and event-pressure reads immediately from the signals already in the app, but float and short-float coverage was much thinner.
**Root cause:** It is tempting to present all market-structure fields as if they are equally supported once a summary card exists. In reality, some inputs are first-class in the current stack and others still need a dedicated provider.
**Rule:** When you add a new derived signal, pair it with explicit availability language for weaker underlying fields. A good derived layer should reduce cognitive load without creating fake certainty about data the app does not actually have.

---

## Lesson: 2026-04-25 - When exact ticker-level ownership data is missing, expose the matching method instead of faking precision

**Observation:** We could meaningfully enrich stock intelligence with 13F ownership context using the existing curated fund universe, but the holdings parser does not carry a clean ticker field for every issuer.
**Root cause:** The real limitation was not lack of data, but lack of exact join keys. Issuer-name matching is useful, but only if the payload makes that approximation explicit.
**Rule:** If an aggregation depends on heuristic matching, include the matching method in both the payload and the docs. A slightly approximate but well-labeled signal is more useful than a blank section, and much safer than implied false precision.

---

## Lesson: 2026-04-25 - Aggregate pages usually deserve a snapshot endpoint before they need more frontend tuning

**Observation:** The leaderboard had already received quote batching and refresh-state polish, but it still paid three separate client reads (`players`, `holdings`, `recent trades`) before the page could fully settle.
**Root cause:** We optimized the rendering path before fully collapsing the data path. On aggregate pages, multiple independent reads create unnecessary latency and increase the chance of partial-state churn even when each individual query is fine.
**Rule:** Once an aggregate page becomes important and stable, give it a server-backed snapshot endpoint that returns the full page payload in one response. Keep the old client-read path as a fallback, but make the snapshot path the default for performance and operational clarity.

---

## Lesson: 2026-04-25 - Agent-ready APIs need explicit schema docs, not just stable code

**Observation:** A normalized stock-intelligence payload is valuable, but agents and future developers still pay unnecessary friction if the shape only exists implicitly inside one server function.
**Root cause:** Stable code is not the same as discoverable contract. Without a published schema, every consumer has to infer field meanings, nullability, and interpretation notes independently.
**Rule:** When building an API for agent consumption, ship a machine-readable schema endpoint and a lightweight human doc alongside the implementation. This reduces integration ambiguity and keeps the endpoint useful beyond the current UI.

---

## Lesson: 2026-04-25 - Freshness UX should be a shared pattern, not page-by-page improvisation

**Observation:** Several heavy pages already had some notion of refresh state, but each one surfaced it differently: subtitle text in one place, a tiny inline label in another, and no cached/fresh distinction in others.
**Root cause:** We treated freshness as a local page concern instead of a cross-cutting UX pattern.
**Rule:** If multiple pages rely on cached or progressively refreshed data, give them a shared status component. Users should learn one consistent language for `cached`, `last updated`, and `refreshing`, and developers should not have to reinvent the same microcopy on every screen.

---

## Lesson: 2026-04-25 - Generic "Unknown" copy hides whether missing metadata is expected or suspicious

**Observation:** When Canadian sector enrichment missed, the UI showed a plain `Unknown`, which looked like a broken app instead of a known metadata gap.
**Root cause:** The copy did not tell the user whether the field was unresolved by design or simply absent due to a bug.
**Rule:** When a metadata fallback is a known coverage limitation, say so explicitly in the UI. `Unknown sector (CA)` is clearer than a generic `Unknown` because it tells both users and future maintainers what class of gap they are looking at.

---

## Lesson: 2026-04-25 - AI preset UX should map to a cheaper model path, not just a different prompt

**Observation:** The product already distinguished quick preset analyses from a full deep dive, but the backend still ran every request through the same premium Claude model and generous token budget.
**Root cause:** We treated "preset vs full" as a prompt-shaping concern only, not a cost-profile concern.
**Rule:** If an AI surface has both quick presets and a premium long-form mode, wire them to different model profiles. Keep cache keys model-aware, lower token budgets on presets, and make the UI honest about which path the user is invoking.

---

## Lesson: 2026-04-25 - A one-time boot prewarm is not the same as a durable warm-data strategy

**Observation:** The app could feel fast right after boot, then gradually fall back into user-triggered cold refreshes once Congress or Canadian insider caches expired.
**Root cause:** We had prewarm logic, but not a recurring sync cadence. That warms the first page load after deploy, not the ongoing product experience.
**Rule:** For slow market-data feeds that power core pages, use a recurring background sync loop, not just a startup prewarm. Refresh the most common cache shapes on a cadence slightly shorter than TTL, and keep an environment flag to disable it when needed.

---

## Lesson: 2026-04-25 - Read-heavy portfolio pages should load from one snapshot, not three loosely coupled queries

**Observation:** Even after caching and debounce work, portfolio pages still felt slower than they should because the server had to answer separate `player`, `holdings`, and `watchlist` reads before the UI could fully settle.
**Root cause:** We treated the portfolio page as a composition problem on the client instead of a snapshot problem on the server. That left extra round trips, more partial-state churn, and more opportunities for one subquery to lag or fail independently.
**Rule:** For high-traffic read-heavy pages with a stable domain object, prefer one server-aggregated snapshot endpoint and keep the older direct-query path only as a fallback. It improves perceived speed, simplifies refresh behavior, and gives future agents a cleaner unit to consume.

---

## Lesson: 2026-04-25 - Warm in-memory cache is not enough for slow third-party research feeds

**Observation:** Congress and Canadian insider pages could feel fast in one moment and slow in the next, depending mostly on whether the Render instance had already rebuilt its in-memory cache.
**Root cause:** The app was treating expensive third-party data as request-time fetches with memory caching, which works only while the process stays warm. Restarts and expiry pushed the rebuild cost back onto the next user.
**Rule:** When an external market-data feed is expensive to rebuild but only changes on a minute/hour cadence, persist normalized rows into your own database and let the UI read from that snapshot first. Keep in-memory cache as an accelerator on top, not as the only durable fast path.

---

## Lesson: 2026-04-25 - New persistence layers need graceful fallback until rollout is complete

**Observation:** Adding a Supabase-backed acceleration path is only half the job; there is a rollout window where the code may deploy before the migration or service-role key exists in production.
**Root cause:** Feature code and infrastructure changes do not become live simultaneously. If the code assumes the new tables exist immediately, it can turn a speed improvement into a production outage.
**Rule:** Any new server-side DB fast path should be optional at runtime. Detect missing keys or table-read failures, log them, and fall back to the old upstream-fetch behavior until the migration and environment changes are fully rolled out.

---

## Lesson: 2026-04-25 - Congress "returns" should be framed as estimated trade timing, not portfolio P&L

**Observation:** Users naturally want Congress members ranked by returns, but STOCK Act disclosures do not provide exact share counts, current position sizes, or a reconciled holdings ledger.
**Root cause:** The source data gives trade dates and value ranges, not exact entries/exits for a fully modeled portfolio. That means any return metric is necessarily an estimate based on stock movement after the disclosed trade.
**Rule:** If ranking Congress members by returns, label it as estimated trade performance or return timing. Compute it from post-trade stock movement, direction-adjust buys vs sells, weight by disclosed trade-size ranges, and avoid implying exact realized portfolio returns.

---

## Lesson: 2026-04-25 - A good insider feed needs both row data and a summary taxonomy

**Observation:** Users do not always want to read dozens of insider rows to answer the basic question: is this net buying, net selling, tax-related noise, or mixed behavior?
**Root cause:** Raw trade rows are useful for detail, but they do not surface the aggregate pattern quickly enough for scanning or agent workflows.
**Rule:** Insider endpoints should return both the normalized trade list and a compact overview layer. At minimum, expose market-level and per-symbol buckets for buy value, sell value, tax-withholding value, other activity, net value, and a simple signal label like `net_buy`, `net_sell`, `tax_heavy`, or `mixed`.

---

## Lesson: 2026-04-25 - Congress disclosures support strong activity rankings, not perfect live portfolios

**Observation:** Users wanted “the full stock portfolio for all members and rank them,” but the underlying Quiver / STOCK Act feed is a disclosure stream of trades, not a continuously reconciled holdings ledger.
**Root cause:** Trade disclosures tell us what members bought or sold and the rough value range, but they do not prove what is still held today or whether a position was later exited outside the current view.
**Rule:** When building portfolio-like views on top of congress disclosures, label them as inferred activity portfolios or disclosed trading activity. Rank members by disclosed activity, show top traded names and net buy/sell behavior, but do not present the result as a guaranteed live brokerage portfolio.

---

## Lesson: 2026-04-25 - Sector filtering needs an enrichment layer, not ad hoc per-row lookups

**Observation:** Insider and filing pages needed sector filters, but their base datasets did not consistently carry sector fields.
**Root cause:** Sector lives in a different provider path than the event feed itself. If each row fetches its own profile on demand, list pages become slow and fragile.
**Rule:** For list-level filtering on metadata that is not present in the event feed, add a shared cached enrichment layer first. Resolve symbol/company → sector once, cache it, then filter locally against the enriched payload. This keeps the page responsive and avoids per-row network fanout.

---

## Lesson: 2026-04-25 - RSI works best as a plain-language momentum label plus evidence

**Observation:** Users asking “is this stock overbought or oversold?” rarely want a raw oscillator number alone.
**Root cause:** RSI is useful, but the number `74.2` or `28.7` is less actionable without a simple interpretation.
**Rule:** When exposing RSI on a stock page, show both the label and the evidence: `Overbought / Neutral / Oversold` plus the RSI value in the evidence table. Keep thresholds explicit (`>70`, `<30`) and avoid presenting RSI as a standalone trading verdict.

---

## Lesson: 2026-04-25 - Agent value comes from normalized context, not just more pages

**Observation:** The app already had real signal data — insiders, congress, 13D/13G, trend evidence, AI summaries — but an agent would still have to hop across multiple endpoints and UI surfaces to form one opinion about a stock.
**Root cause:** We optimized for human navigation first. That is good product work, but it leaves agent workflows weak because the system has no single machine-friendly stock object to reason over.
**Rule:** When you want AI agents to extract value from a product, expose one normalized domain object first. In this app, that means a stock-intelligence payload with raw facts, derived metrics, signal labels, explanations, source metadata, and explicit gaps. Agents benefit more from one stable schema than from five extra UI widgets.

---

## Lesson: 2026-04-25 - Public portfolio pages need the same fast-path cache treatment as private portfolio pages

**Observation:** Private portfolio navigation had become reasonably snappy because it could seed from a holdings session cache, but public portfolios still felt slow on repeat visits because they always waited for fresh `player + holdings + watchlist` queries.
**Root cause:** We optimized only the owner path and left the public-view path to start cold every time, even though the same user often opens the same public portfolio repeatedly in one session.
**Rule:** Any high-traffic read-heavy page with stable last-known data should seed from a lightweight session snapshot first, then refresh in place. Do not limit this pattern to the signed-in owner view if the public view has the same perceived-latency problem.

---

## Lesson: 2026-04-25 - Expired cache should not automatically mean blocked UI

**Observation:** Both `13F recent filers` and `13F recent filings` felt slow when their caches expired, even though slightly stale data would have been perfectly acceptable to show first.
**Root cause:** The endpoints treated cache expiry as "rebuild before responding" instead of "serve stale and refresh in background." That turns a maintenance refresh into a user-facing stall.
**Rule:** For market-data endpoints where minute-level precision is not critical, prefer stale-while-revalidate plus in-flight dedupe. Users get a fast response, overlapping requests do not stampede the provider, and freshness still recovers in the background.

---

## Lesson: 2026-04-24 - Presence tracking should be heartbeat-based and throttled

**Observation:** Admin wanted a useful `online now / last active` view, but blindly writing on every click, scroll, or keypress would create noisy and unnecessary Supabase churn.
**Root cause:** Presence is a UI concept, not an audit-log concept. Treating every interaction as a distinct database event is wasteful when the real question is simply whether the user has been active recently.
**Rule:** Track presence with a lightweight heartbeat (`last_active_at`) and throttle it aggressively. A one-minute minimum interval is enough for "online now" style admin views and avoids turning normal navigation into write amplification.

---

## Lesson: 2026-04-24 - Admin analytics should start with narrow, explicit capture points

**Observation:** It is tempting to add broad session analytics once an admin asks "what are people doing?", but the most actionable first layer was much narrower: stock search terms and whether a selected symbol was opened.
**Root cause:** Broad event capture creates privacy creep and maintenance burden fast, while still often failing to answer the concrete product questions the admin actually has.
**Rule:** Start admin analytics with intentional, product-specific events. For this app, in-app stock search terms plus selected symbols are useful and understandable; full clickstream logging is not. Expand only when there is a clear decision the extra data would improve.

---

## Lesson: 2026-04-23 - Chart event markers must use the same time domain as the chart bars

**Observation:** Stock pages started crashing with `Value is null` after adding 13D / 13G filing markers to the chart.
**Root cause:** The marker layer mixed time formats. Some chart ranges were backed by numeric timestamps while filing markers were passed in as `YYYY-MM-DD` strings. `lightweight-charts` expects markers to live in the same time domain as the series they are attached to.
**Rule:** Never attach event markers directly from raw provider dates. First map each event date onto the actual chart bar timestamps already present in the current series, and skip markers that do not line up with a visible bar. If a chart can render both numeric and string times depending on range/provider, normalize before calling `setMarkers`.

---

## Lesson: 2026-04-23 - Signal labels need an evidence layer or they read like vague jargon

**Observation:** Users understood that `Mixed Trend` and `Participation` sounded important, but the labels alone were not actionable. They needed to know the actual 20-day average, 50-day average, price distance, and relative-volume context to trust the conclusion.
**Root cause:** The first pass of the signal UI optimized for compact summaries instead of showing the data that created the summary. That made useful quantitative reads feel opaque.
**Rule:** Any synthesized trading signal should ship with a compact evidence layer. If the UI shows a label like `Mixed Trend`, it should also expose the supporting numbers nearby: current price, 20/50-day averages, price-vs-average deltas, relative volume, and a plain-English interpretation. Summary first, evidence immediately underneath.

---

## Lesson: 2026-04-19 — Auth-as-identity removes the PIN / display-name collision class

**Observation:** The old league flow stored a plaintext PIN per player and treated the name string as the stable key. That meant two players could pick the same name, the PIN was an obvious leak surface, and any "whose portfolio is this?" UI had to carry both name and PIN around.
**Root cause:** We conflated *identity* (who are you?) with *display* (what should we show?). PINs were standing in for identity because we hadn't wired Supabase Auth as the source of truth.
**Rule:** When a feature needs public profiles, make the OAuth session the identity and lookup key (`auth.email()` → `players.google_email`). Keep `name`/`display_name` as purely presentational. Row-Level Security policies become trivial one-liners (`google_email = auth.email()`), writes are gated automatically, and the old PIN column can stay nullable for a non-destructive migration.

---

## Lesson: 2026-04-19 — "Unlimited cash" paper trading removes phantom cash bugs

**Observation:** The original league gave each player $1,000 and computed portfolio return as `(cash + holdings − 1000) / 1000`. This silently broke on two axes: (1) admin-resets that didn't touch cash drifted over time, (2) users wanted to backfill "I actually bought this at $X in March" but that implied negative cash.
**Root cause:** We were simulating a broker (cash ledger) when users actually wanted a *tracker* (here's what I own, show me how it's doing). A cash ledger only makes sense if the game constrains buying power — which we didn't want.
**Rule:** For a tracking-style portfolio app, compute return as `(holdings value − cost basis) / cost basis` and drop the cash concept entirely. Allow trades to take an optional historical price + date so users can record positions they entered before they started using the app. This also collapses buy/sell code paths (no balance check, no reconciliation).

---

## Lesson: 2026-04-19 — Null-guard atom feed entries before calling string methods

**Observation:** Canadian Filings tab crashed with "Cannot read properties of undefined (reading 'startsWith')". The crash fired inside `formColor(formType)` when SEDAR+ occasionally returned an entry without a `<form_type>` element.
**Root cause:** Atom-feed entry shapes are provider-defined; assuming every field is populated breaks the first time an edge record ships through. The symptom (tab is blank with a red banner) looked like a server/data outage rather than a client-side TypeError.
**Rule:** When rendering provider-supplied lists, guard at two layers: (1) filter malformed entries out at the list boundary (`safeFilings = filings.filter(f => f && f.formType)`), and (2) make render-time helpers accept `string | undefined | null` with a visible fallback (`formType ?? '—'`). Either layer alone leaves a gap — the filter can miss, or a render helper can forget the fallback.

---

## Lesson: 2026-04-19 — Two-model AI strategy: fast chat vs deep briefing

**Observation:** Upgrading the existing `/api/ask-stock` endpoint to Claude Sonnet 4.5 would have made quick back-and-forth chat slow (20-40s instead of 3-5s) and expensive for casual questions.
**Root cause:** "Ask AI" and "Deep Analyze" are different user intents. Ask AI is a conversational probe; Deep Analyze is a one-shot long-form briefing. Forcing both through one endpoint forces a bad trade-off on latency vs depth.
**Rule:** When AI surfaces serve fundamentally different intents, split endpoints and pick the model per intent. Groq Llama 3.3 70B stays for Ask AI (low latency, conversational). Claude Sonnet 4.5 powers the separate Deep Analyze surface where users have explicit intent to wait 30s for a PM-grade note. This also means you can cache them with different keys and TTLs without cross-contamination.

---

## Lesson: 2026-04-19 — Avoid adding react-markdown for a single render surface

**Observation:** Deep Analyze returns markdown. First instinct was `npm install react-markdown` (+ `remark-gfm` for lists). That adds ~35KB gzip and pulls 20+ transitive deps into the bundle.
**Root cause:** react-markdown is a fully generic parser built for arbitrary markdown. Our use case is narrow and controlled: we write the prompt, so we know the subset of markdown the model will output (## headers, bullets, **bold**, *italic*, paragraphs, maybe `code`).
**Rule:** For narrow, controlled markdown (internal or LLM-generated with a defined prompt contract), write an 80-line inline renderer that escapes HTML first, then applies a small allowlist via regex. Ship zero new deps, keep the bundle lean, and avoid a deep transitive tree. Only reach for react-markdown when you need full CommonMark + user-supplied content.

---

## Lesson: 2026-04-19 — Nested interactive elements break news-row layouts

**Observation:** Adding a "Deep Analyze" button to each news item seemed like a 1-line change. But the news card was already an `<a>` wrapping the whole thing, and putting a `<button>` inside an `<a>` is invalid HTML — browsers render it but clicks can fire both handlers, accessibility tools get confused, and some browsers refuse to dispatch click on the inner button.
**Root cause:** The "everything is a link" pattern only works until you want a second action per row.
**Rule:** The moment a list-item needs a second interactive target, restructure from `<a>...</a>` to `<div><a>main content</a><button>secondary</button></div>`. The anchor and the button are siblings, each takes its own click, and there's no nested-interactive-element violation. Also works better with keyboard tab order.

---

## Lesson: 2026-04-16 — AI answer quality is a context problem more than a model problem

**Observation:** Ask AI chat was producing generic, shallow answers. First instinct was "upgrade the model." Audit revealed the real cause: the AI was only seeing ~20 days of technical data, 5 news headlines with no dates, 5 raw insider trades, no fundamentals, no analyst data, no earnings calendar — and a 512 max_tokens cap that forced compressed answers.
**Root cause:** The `summarizeTechnicals` server helper only used the last 20 candles even though the client was sending 90. No fundamentals pipeline existed. Insider context was a raw dump of 5 trades, not a windowed statistical read.
**Rule:** Before blaming the model, print the actual prompt being sent. If the context is thin, enriching it gives a larger quality lift than any model swap — and it's free (no extra cost, no latency). Enrich first, swap models only if still below bar.
**Enrichment pattern:** Multi-timeframe summaries (not just "last 20"). Windowed counts for insider flow (30d / 90d / 1y / 2y with net $ direction). News with recency labels. Fundamentals as a separate context section. Raise max_tokens to at least 1500 for analytical answers.

---

## Lesson: 2026-04-16 — TMX GraphQL `getInsiderTransactions` is a scalar JSON type

**Mistake:** Wrote a GraphQL query with subfield selection: `{ getInsiderTransactions(symbol: "RY") { date datefrom filingdate ... } }`.
**Root cause:** TMX defines `getInsiderTransactions` as a plain `JSON` scalar, not a typed object. Any subfield selection causes a schema error: `"Field \"getInsiderTransactions\" must not have a selection since type \"JSON\" has no subfields."` The error response has no `data.getInsiderTransactions` field, so `json.data?.getInsiderTransactions ?? []` silently returned empty for every symbol. Endpoint shipped returning zero trades and looked like a coverage problem.
**Rule:** Query TMX GraphQL JSON-scalar resolvers without any subfield selection: `{ getInsiderTransactions(symbol: "RY") }` returns the full JSON blob as `data.getInsiderTransactions`. The same rule applies to any TMX resolver whose GraphQL schema type is `JSON` rather than a typed object — always test with a simple no-selection query first.

---

## Lesson: 2026-04-16 — SEDI code 1 is both buys and sells; sign of amount matters

**Mistake:** Mapped `transactionTypeCode === 1` to BUY and `transactionTypeCode === 2` to SELL.
**Root cause:** SEDI code 1 means "Acquisition or disposition in the public market" — it's a single code for both directions. The sign of the `amount` field determines whether it's a buy (positive) or a sell (negative). Code 2 exists but is rare. Treating all code 1 as BUY mislabeled every executive open-market sell as a buy in our CA Insiders tab.
**Rule:** For SEDI data, the transaction type is determined by `transactionTypeCode === 1 && amount > 0 → BUY` vs `transactionTypeCode === 1 && amount < 0 → SELL`. Don't filter on `amount > 0` alone either — it drops legitimate sells. Filter on `amount !== 0` and use the sign for direction.

---

## Lesson: 2026-04-11 — EDGAR index.json does not exist for all filings

**Mistake:** Used `{accession}-index.json` URL pattern to discover XML files within an EDGAR 13F filing.
**Root cause:** This file does not exist on EDGAR S3 for many/most filers. The error is silently caught, docs stays empty, returns [].
**Rule:** Always use the HTML directory listing at `https://www.sec.gov/Archives/edgar/data/{cik}/{accClean}/` to discover filing documents. Parse `href="...\.xml"` links from the HTML. Exclude `primary_doc.xml` (cover page) — the info table is the other XML file.

---

## Lesson: 2026-04-11 — Senate Stock Watcher data is frozen at 2021

**Mistake:** Used `raw.githubusercontent.com/timothycarambat/senate-stock-watcher-data/...` as congress trade source.
**Root cause:** That repo was last updated ~2021. The Senate Stock Watcher site is now offline (domain expired 2026-04-08).
**Rule:** For congress trade data, use Quiver Quant `Bearer public` token at `https://api.quiverquant.com/beta/live/congresstrading`. Confirmed live with 2026-04-08 records. Set `Authorization: Bearer public` header. No signup required.

---

## Lesson: 2026-04-11 — 13f.info has no API

**Mistake:** Considered integrating 13f.info as a data enrichment source.
**Root cause:** 13f.info is a Rails web app (open source: github.com/toddwschneider/sec-13f-filings) with no public REST API. All endpoints return 404 or 406 for JSON requests.
**Rule:** For 13F holdings data, use EDGAR directly (`data.sec.gov` + `www.sec.gov/Archives/`). It's free, no rate limits with proper User-Agent, and 13f.info itself uses the same source.

---

## Lesson: 2026-04-13 — EDGAR daily company index is fixed-width, not pipe-delimited

**Mistake:** Filtered EDGAR daily index lines with `.includes('|')` and split by `|` to parse them.
**Root cause:** `www.sec.gov/Archives/edgar/daily-index/{year}/QTR{n}/company.{YYYYMMDD}.idx` uses a fixed-width format (company name = 62 chars, then form type, CIK, date, file path). It contains zero pipe characters. The full quarterly index (`full-index/`) uses the same format. Result: 0 entries parsed, endpoint silently returned `{trades:[]}`.
**Rule:** Parse EDGAR daily company index with a fixed-width regex: `/^(.{62})(.*?)\s+(\d{6,10})\s+(\d{8})\s+(edgar\/\S+)/`. Skip lines under 100 chars (header/blank). The URL format with a dot IS correct: `company.20260410.idx`.

---

## Lesson: 2026-04-13 — xmlMatch requires capture groups; use .test() for boolean XML flag checks

**Mistake:** Called `xmlMatch(xml, /<isDirector>\s*1\s*<\/isDirector>/i)` — a regex with no capture group — inside `inferOwnerTitle`.
**Root cause:** `xmlMatch` calls `match[1].trim()` on any truthy match. When the regex has no capture group, `match[1]` is `undefined` and `.trim()` throws. The bug was latent because `inferOwnerTitle` was only reached after fixing the index parser; 0 entries meant it was never called before.
**Rule:** For boolean XML presence checks (does tag contain value "1"?), use `.test()` directly: `/<isDirector>\s*1\s*<\/isDirector>/i.test(xml)`. Reserve `xmlMatch` for extracting capture group values.

---

## Lesson: 2026-04-14 — EDGAR 429s during bulk scans are transient and non-blocking

**Observation:** When the cross-fund options scan fires 35 sequential EDGAR fetches in batches of 3, some `www.sec.gov/Archives/` directory requests return 429 (rate limit). Those funds produce empty results for that scan cycle.
**Root cause:** EDGAR's rate limiter kicks in when too many requests arrive too quickly. The batch size of 3 concurrent requests is acceptable for normal use but still clips the limit during a full 35-fund scan.
**Rule:** 429s from EDGAR during bulk scans are expected and non-fatal — `Promise.allSettled` absorbs them. The 24h cache means the scan only runs once per deploy. If coverage is poor on first load, a simple `setTimeout` retry on 429'd funds after 5s would improve completeness without hammering the rate limit.

---

## Lesson: 2026-04-14 — Don't bulk-fetch all funds on landing; show a filing tape and load details on demand

**Mistake:** The Funds landing page pre-fetched 35 EDGAR submissions endpoints to build a "curated funds" grid, and also ran a cross-fund options scan across all 35 funds in parallel batches on server start.
**Root cause:** Both approaches make a large number of EDGAR requests upfront. The submissions batch (35 × `data.sec.gov`) is slow and serialized; the options scan fires 35 directory + XML fetches and regularly hits 429s, leaving many funds with no data. Users saw a 60s spinner or an incomplete list.
**Rule:** For landing pages backed by slow external APIs, prefer a filing-tape approach: scan the EDGAR daily-index for the relevant form type (13F-HR, 4, etc.), return a flat list of who filed recently, and load individual detail only when the user explicitly selects a fund. This is fast, cloud-safe, and requires zero per-fund prefetching.

---

## Lesson: 2026-04-14 — React Router reuses component instances between same-route navigations; use key to force remount

**Mistake:** When navigating from `/stock/AAPL` to `/stock/MSFT`, the StockChart's DOM refs (including the chart canvas) were preserved across the symbol change because React Router reuses the same component instance for matching route patterns.
**Root cause:** React Router does not unmount/remount `<StockDetail>` when only the `:symbol` param changes. Imperative refs (`useRef`) survive the param change. While React Query correctly switches to the new query key and `initChart` re-runs when `data` changes, edge cases (brief undefined data, stale cache, rapid navigation) can cause the old chart to persist visually.
**Rule:** When a component owns imperative resources (chart canvases, WebGL contexts, third-party library instances) that must reset when a URL param changes, add `key={param}` to that component in the parent. `key={symbol}` on `ChartWithResponsiveHeight` guarantees a fresh mount for every ticker.

---

## Lesson: 2026-04-11 — EDGAR CGI (www.sec.gov/cgi-bin) is IP-blocked from cloud providers

**Mistake:** Used `www.sec.gov/cgi-bin/browse-edgar` EDGAR company search endpoint from server-side.
**Root cause:** EDGAR CGI endpoints block AWS/Render IP ranges. Returns connection refused or a "Undeclared Automated Tool" HTML page.
**Rule:** Never use `www.sec.gov/cgi-bin/` endpoints from cloud-hosted servers. Use `data.sec.gov/submissions/CIK{padded}.json` for filing history (works fine) and `www.sec.gov/files/company_tickers.json` for ticker-to-name lookup (static file, works). HTML directory listings at `www.sec.gov/Archives/` also work.

---

## Lesson: 2026-04-20 — Every async submit handler needs try/catch/finally or the button dies

**Mistake:** `TradeModal.handleTrade` awaited `executeBuy` / `executeSell` with no error boundary. When the call threw (network blip, RLS rejection, OAuth expiry), `setLoading(false)` never ran and the button stayed "Processing…" forever. User-visible symptom: trades silently impossible. DB confirmed 4/6 users had zero trades, all hitting this path.
**Root cause:** Optimistic "happy path only" async handler. `result.success === false` was handled, but a *thrown* exception wasn't. On mobile / flaky networks this is the common case, not the edge case.
**Rule:** Every submit-style async handler must be shaped as `try { ... } catch { setError(friendly) } finally { setLoading(false) }`. Never rely on the called function to "always resolve." Always surface a user-visible error string in the catch so the user knows something failed and can retry.

---

## Lesson: 2026-04-20 — `Promise.all` + `.single()` is a fragile combo for multi-query page loads

**Mistake:** `PlayerPortfolio` loaded player + holdings + watchlist via `Promise.all`, and `getPlayerById` used Supabase `.single()`. Any one failing query killed the page; any player with zero watchlist rows hit `PGRST116: 0 rows` and the whole page rendered "Player not found."
**Root cause:** `Promise.all` fails together — one rejection rejects the whole array. `.single()` throws PGRST116 when there are zero rows instead of returning `null`. Combined, an empty but valid table kills the whole view.
**Rule:** For any page that loads N independent queries, use `Promise.allSettled` and inspect each result's status. For "fetch one row by id" where the row may legitimately not exist, use `.maybeSingle()` (returns `null`) not `.single()` (throws). Reserve `.single()` for queries that must return exactly one row as a data-integrity invariant.

---

## Lesson: 2026-04-20 — Never `return null` from an auth-gate while a promise is pending

**Mistake:** `App.tsx` returned `null` while `supabase.auth.getSession()` was pending. On slow mobile the promise could hang indefinitely — user saw a permanent blank white screen with no way to recover.
**Root cause:** Treating "session unknown" as "render nothing" gives zero feedback and zero fallback. A hung network call becomes a fully broken app.
**Rule:** Auth gates must render something visible (a spinner, skeleton, or logo) during session restoration, AND must have a timeout fallback (e.g. 10s) that forces the gate to resolve to a logged-out state so login UI at least renders. `return null` is never the right answer for an async-resolved top-level gate.

---

## Lesson: 2026-04-20 — React Query quote refetch defaults can drain API quota on mobile

**Observation:** `useStockQuote` ran with `staleTime: 60_000` + `refetchInterval: 60_000` and default `refetchIntervalInBackground: true`. On a Portfolio page with 10 positions, that's 10 requests/minute even when the tab is hidden — plus another 10 on every remount when navigating back to the page.
**Root cause:** React Query's polling defaults are aggressive and they keep polling in background tabs. For finance data that changes slowly between trading decisions, sub-minute precision isn't worth the API cost or the mobile battery drain.
**Rule:** For any `useQuery` that polls a rate-limited external API, set `staleTime` to match the real data cadence (2m for quotes is fine), set `refetchInterval` equal to or greater than `staleTime`, add `refetchIntervalInBackground: false` to pause on hidden tabs, and add `refetchOnMount: false` so route changes reuse cached data. These four settings together typically halve API load with no user-visible regression.

---

## Lesson: 2026-04-20 — Supabase realtime fires ≥1 event per affected table; debounce the reload

**Observation:** A single trade in MoneyTalks triggers inserts/updates across `trades`, `holdings`, and `players` (cash/balances in legacy rows). The Leaderboard listened to all three and fired three full reloads per trade within ~100ms of each other.
**Root cause:** Supabase `postgres_changes` fires one event per table per row change — subscribing to multiple tables for a logically single operation fans out into N events. Each one kicked off a fresh `getAllPlayers + getAllHoldings + getRecentTrades` round trip.
**Rule:** When subscribing to multiple `postgres_changes` topics that are commonly triggered together, debounce the reload handler (200–500ms is plenty). Same pattern applies anywhere you re-fetch in response to realtime events — never hook the refetch directly to the event without a coalescing timer.

---

## Lesson: 2026-04-21 — Expiring a hot cache should not force the next user to pay the rebuild cost

**Observation:** The Canadian insider endpoints were healthy but felt broken in production because each cache expiry forced the next request to wait ~11–13 seconds for a full TMX rebuild across the curated TSX list. Users experienced that as "the tab is slow" even though cached data from minutes earlier was still perfectly usable.
**Root cause:** The route treated cache expiry as a synchronous miss instead of a stale-but-serviceable hit. We already had valid cached data in memory, but the handler blocked on refresh before returning anything.
**Rule:** For expensive upstream aggregations with acceptable staleness windows, use stale-while-revalidate. If a cache exists, return it immediately and refresh in the background; only block when there is no cache at all. Pair that with in-flight build dedupe so concurrent requests share one refresh instead of stampeding the provider.

---

## Lesson: 2026-04-21 — Don’t block route readiness on secondary hydration

**Observation:** The portfolio experience felt randomly slow because `App.tsx` treated player lookup and watchlist initialization as one serial boot path. Even when the player row was ready, the page still waited for watchlist sync before the route really settled.
**Root cause:** We bundled “critical identity state” and “nice-to-have secondary data” into the same readiness gate. That makes every downstream route pay for the slowest dependency.
**Rule:** Separate critical route boot from secondary hydration. As soon as the app knows who the user is and can resolve the primary record (`player`), mark the route ready and hydrate watchlists or other side data in the background. Then make the page render those secondary sections behind their own local hydration guards instead of blocking the whole screen.

---

## Lesson: 2026-04-21 - Keep refreshes in place; don't make ordinary reloads feel like first load

**Observation:** Portfolio-style pages felt hung even when the underlying queries eventually succeeded, because every realtime update or manual refresh pushed the screen back into a blocking skeleton or temporary blank-feeling state.
**Root cause:** We treated "refresh" and "initial load" as the same UI state. That means perfectly normal background reloads looked like failures, especially on mobile or slower networks.
**Rule:** Preserve the last good snapshot during refreshes. Reserve full-page skeletons for true first load only, use a lightweight `Refreshing...` indicator for later reloads, and debounce realtime-triggered refetches so bursty database events do not cause visible page thrash.

---

## Lesson: 2026-04-21 - Shared quote hydration beats per-card fanout on dashboard-style screens

**Observation:** Dashboard and leaderboard views felt progressively slow because each tile or row mounted its own quote hook, so the page hydrated one card at a time and did more work than necessary.
**Root cause:** The data model was fine, but the fetch topology was fragmented. Many small quote hooks create extra React work, noisier loading states, and more visible fanout on navigation.
**Rule:** On list/grid surfaces, dedupe the symbol set once and hydrate quotes through a shared `useStockQuotes()` path. Let the page render its structural data first, then fill prices into existing rows instead of turning every card into its own mini loading pipeline.

---

## Lesson: 2026-04-22 - A good stock chat needs conversation memory, not just a better model

**Observation:** Ask AI responses felt shallow even though the stock page already had candles, fundamentals, insider flow, and news. Follow-up questions were especially weak because the assistant kept answering as if each turn were the first.
**Root cause:** The backend had rich snapshot context, but the chat was stateless. Sending only the newest question forces the model to reconstruct intent every turn, which makes answers repetitive and generic.
**Rule:** For any multi-turn AI surface, always send a trimmed conversation window along with the latest structured context. Better prompt design helps, but preserving the last few user/assistant turns is what makes follow-up questions feel coherent and analytically cumulative.

---

## Lesson: 2026-04-22 - Missing hashed assets must never fall through to the SPA shell

**Observation:** After a fresh deploy, some browsers asked for an older lazy chunk filename and got `index.html` back, which showed up as `Failed to fetch dynamically imported module` and made pages look broken.
**Root cause:** The server treated unknown `/assets/...` paths like normal app routes and served the SPA fallback instead of a 404. That means the browser received HTML where it expected JavaScript.
**Rule:** For SPAs with hashed build assets, serve `index.html` with `no-store`, serve `/assets/...` with immutable cache headers, and make missing asset paths return a real 404. Pair that with a one-time client reload on chunk-load failure so deploy transitions recover automatically for users with a stale shell in memory.

---

## Lesson: 2026-04-22 - A feed can be current and still feel broken if sampling is too aggressive

**Observation:** The insider endpoints were up to date, but users still perceived them as stale because the result set was too small and too selective. "Fresh but thin" reads like "missing data" to users.
**Root cause:** We optimized sampling for speed and provider safety before optimizing for informational density. That kept the feeds technically current while hiding too much of the available activity.
**Rule:** For research surfaces, optimize first for a convincing information surface, then trim with batching and caching. If you must sample, do it generously enough that the page still feels comprehensive; otherwise users will correctly conclude the feed is incomplete even when the timestamps are current.

---

## Lesson: 2026-04-22 - Do not build data-heavy watchlist screens out of hooks-in-a-loop

**Observation:** Market Signals was fragile and expensive because it mounted one insider hook per watchlist symbol inside a mapped render path, then tried to reconstruct a unified signal surface from many small query objects.
**Root cause:** Hook-per-item fanout looks convenient, but it couples render shape to query shape, makes loading/error handling messy, and gets risky as the watchlist changes over time.
**Rule:** For watchlist or portfolio surfaces, centralize the fetch topology. Either use `useQueries` with stable symbol lists or move the aggregation server-side, but do not rely on ad hoc hook loops for a core page.

---

## Lesson: 2026-04-22 - Reuse server caches for market-wide crossover pages

**Observation:** The congress-backed side of Market Signals was weaker than the standalone congress views because ticker-specific lookups were not reusing the same server-side cached dataset.
**Root cause:** We treated "latest market feed" and "watchlist subset" as separate problems, even though both should come from the same authoritative source.
**Rule:** When a market-wide provider feed is already cached server-side, expose filtered server endpoints for downstream pages instead of rebuilding partial client-side fetch stacks. Shared source, filtered views.

---

## Lesson: 2026-04-22 - Stale-while-revalidate matters most on rate-limited upstreams

**Observation:** The US insider route could still feel bad after cache expiry because `sec.gov` throttling made synchronous cache rebuilds slow and noisy.
**Root cause:** We had caching, but not the right serving strategy. A cached route that blocks on refresh is still user-visible when the upstream is rate-limited.
**Rule:** For rate-limited data providers, pair caching with in-flight dedupe and stale-while-revalidate. Users should get the last good snapshot immediately while refreshes happen in the background.

---

## Lesson: 2026-04-26 - Parallel UI work needs honest contract-fallback copy, not fake success states

**Observation:** In a phased parallel build, the UI routes can exist before the backend stub endpoints are actually published in the local workspace.
**Root cause:** Route wiring and contract wiring move at different speeds when file ownership is strict. If the UI assumes the backend is already live, Phase 1 feels broken even when the real issue is just sequencing.
**Rule:** For wiring-only phases, build shell pages that do three things clearly: render the route, attempt the real endpoint, and explain when the contract is not live yet. That keeps progress visible without masking backend readiness.

---

## Lesson: 2026-04-26 - Build the first real query surface around the typed client, not around ad hoc fetches

**Observation:** The Phase 1 News Impact shell used a direct `fetch()` on purpose, but keeping that pattern into the real UI would have spread endpoint knowledge, filter logic, and fallback handling across the page itself.
**Root cause:** Wiring phases optimize for speed of proof, while feature phases need a stable query surface. If the page owns the endpoint contract directly, every filter or state change becomes harder to reuse and harder to keep consistent with future pages.
**Rule:** Once the backend contract is live, move immediately to a dedicated hook that wraps the typed client and owns the React Query key, stale behavior, and placeholder strategy. Keep pages focused on controls and presentation, not endpoint plumbing.

---

## Lesson: 2026-04-26 - Responsive data tables should degrade into cards before the content starts competing with itself

**Observation:** The Alerts filings surface needs ticker, insider, type, amount, filed date, and accession data at once. That fits comfortably on desktop, but on mobile the same columns collapse into a cramped table that hides the watchlist signal.
**Root cause:** Data-heavy research pages often start from a desktop table mental model. If the mobile fallback is left as horizontal overflow only, the most important context becomes harder to scan exactly where users need compression the most.
**Rule:** For filings-style tables, switch to stacked cards under the mobile breakpoint and preserve the same semantic highlights there. The priority is fast scanning, not preserving the table shape at all costs.

---

## Lesson: 2026-04-26 - Demo mode must be explicit, never an accidental production fallback

**Observation:** The main stock-data hooks were returning mock candles, quotes, and profiles whenever a provider key was missing or an upstream request failed.
**Root cause:** Demo data started as a convenience for development, but because it lived inside production hooks, provider outages could silently degrade into believable fake market data.
**Rule:** If a product has demo data at all, gate it behind an explicit flag like `VITE_DEMO_MODE=1`. In production, missing providers should surface as `null`, `stale`, or `unavailable` states — never fabricated market values.

---

## Lesson: 2026-04-27 - High-volume news scanning wants a tape, not a card deck

**Observation:** The News Impact page was informative, but once the feed had enough stories users wanted to scan many headlines quickly, the card layout forced too much vertical reading and hid the relative ordering of items.
**Root cause:** Research cards are good for explanation, but news scanning is a density problem first. A feed with source, score, sector, and time works better as a compact tape once the ingestion layer is mature enough to populate it.
**Rule:** For headline-heavy surfaces, default to a dense row/tape layout and keep cards for detail surfaces. Optimize the first screen for comparison, not decoration.

---

## Lesson: 2026-04-27 - Derived metadata is a valid bridge when the API contract lags the filter UX

**Observation:** Users wanted sector filters on the news feed even though the news API did not yet provide a dedicated `sector` field on each story.
**Root cause:** The backend contract and the ideal UI filters were out of phase. Waiting for a contract change would have blocked a useful filter, but relabeling an unrelated field would have been misleading.
**Rule:** When a filterable attribute is missing from the contract, derive it from the closest trustworthy metadata source and label it honestly until the backend grows a first-class field.

---

## Lesson: 2026-04-27 - A balanced news feed starts at ingestion, not at the UI filter

**Observation:** The feed looked politically and energy-biased even after adding better frontend filtering.
**Root cause:** The backend query mix was not balanced. If tech, M&A, and IPO headlines are underfetched upstream, no amount of UI filtering can make them appear later.
**Rule:** For multi-sector market news products, keep separate ingestion lanes for macro/policy, company-specific, sector-specific, and deal/IPO flow so one domain does not dominate the feed by accident.

---

## Lesson: 2026-04-27 - Client-side timeouts on multi-step writes can create fake failures

**Observation:** The trade modal no longer had a global timeout, but users were still seeing timeout-style failures during slow Supabase windows.
**Root cause:** The write path still had per-step client-side timeouts inside the DB helper, so a slow but valid request could be treated as failed before the backend had actually given up.
**Rule:** For critical multi-step writes, prefer user-facing slow-state messaging plus targeted retries for real transport failures. Hard client-side timeouts are more likely to create false negatives than protect the flow.

---

## Lesson: 2026-04-27 - For instant-feeling trade UX, optimistic state needs a durable retry loop

**Observation:** Users wanted trade submissions to feel instant even when Supabase was slow.
**Root cause:** Waiting for the full write path before showing anything makes the UI feel blocked, but pretending the write succeeded without a retry mechanism is unsafe.
**Rule:** If a critical write needs to feel instant, pair an optimistic local state with a persisted retry queue, a visible pending status, and a reconciliation step against the durable store.

---

## Lesson: 2026-04-29 - Ask AI should consume the same normalized intelligence object agents use

**Observation:** Stock-page Ask AI answers can feel generic when the model only sees whatever the browser happened to send.
**Root cause:** The richer stock-intelligence object existed server-side, but the Ask AI prompt was not using it as the primary context source.
**Rule:** Any analyst-style AI surface should be grounded in the canonical server-normalized intelligence payload first, then supplemented with client context and conversation history.

---

## Lesson: 2026-04-30 - Critical writes should leave the browser as fast as possible

**Observation:** Trade submits could still feel stuck when Supabase was slow from the browser.
**Root cause:** Even with a local pending queue, the first durable attempt still depended on multiple browser-side Supabase round trips.
**Rule:** For user-critical writes, prefer a single server endpoint with idempotency markers, then let the browser queue only when that server request is unreachable or slow.

---

## Lesson: 2026-04-30 - Convergence beats isolated signal cards

**Observation:** A filing, congress trade, watchlist name, or portfolio holding is useful alone, but much more useful when several collide.
**Root cause:** Alerts showed separate feeds without highlighting overlap across ownership, congress, watchlist, and portfolio context.
**Rule:** Build alert surfaces around intersections first. A smaller list of converged signals is often more actionable than a larger list of isolated events.

---

## Lesson: 2026-04-30 - Social trend data needs confirmation columns to become useful

**Observation:** Raw Reddit mention counts are interesting, but they can be noisy without knowing whether price, news, or insider activity agrees with the attention spike.
**Root cause:** Social feeds are often ranked by conversation volume alone, which makes them good at detecting chatter but weak at separating catalyst-driven attention from memes or stale crowding.
**Rule:** Show social velocity beside price reaction and independent catalysts. Treat Reddit as an input layer, not a standalone buy/sell signal.

---

## Lesson: 2026-04-30 - Personal context makes public trend feeds more actionable

**Observation:** A Reddit-trending ticker matters more when it also overlaps with a user's portfolio, watchlist, ownership filings, congress disclosures, or insider tape.
**Root cause:** Public trend feeds rank what the crowd is discussing, but they do not know what the user owns or what other institutional/political data is confirming the move.
**Rule:** Add a convergence layer to social surfaces. The best rows are not just popular; they collide with data the platform already knows.

---

## Lesson: 2026-04-30 - Trend surfaces should lead with acceleration, not ordinal rank

**Observation:** Reddit rank is less useful than whether mentions are accelerating versus the prior period.
**Root cause:** Rank tells where a ticker sits in a crowd leaderboard, but acceleration shows what changed and is more likely to identify a developing setup.
**Rule:** In social trend tables, prioritize mention spike, velocity, and change from baseline over static rank.
