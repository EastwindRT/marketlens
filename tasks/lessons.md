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
