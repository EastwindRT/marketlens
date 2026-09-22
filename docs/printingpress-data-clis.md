# Printing Press Data CLI Collectors

## Goal
Use selected `printingpress.dev` CLIs as optional enrichment jobs for MarketLens without making the dashboard slower or dependent on external binaries at request time.

The collectors are agent-facing first: they normalize external CLI output, write small cached artifacts, and let convergence jobs consume the data later.

## Collectors

### Yahoo Finance
Best use: trending symbols, quote/watchlist enrichment, options-chain spikes, and fallback price metadata.

Backend collector:

- `collector=yahoo-trending`
- CLI env: `PP_YAHOO_FINANCE_CLI`
- Writes ticker-ranked snapshots to `social_trend_snapshots` with `source='yahoo_trending'`.

### Hacker News
Best use: AI/software/infrastructure topic velocity that can confirm public-market themes before they become traditional financial news.

Backend collector:

- `collector=hackernews-pulse`
- CLI env: `PP_HACKERNEWS_CLI`
- Writes latest normalized topic pulse to `app_settings.external_collector_last_hackernews_pulse`.
- Default topics come from `HACKERNEWS_TREND_TOPICS`.

### Scrape Creators
Best use: cross-platform creator/social checks for a specific theme or cashtag when X/Reddit alone are not enough.

Backend collector:

- `collector=creator-trends`
- CLI env: `PP_SCRAPE_CREATORS_CLI`
- Requires `SCRAPE_CREATORS_API_KEY`.
- If the query includes a cashtag such as `$NVDA`, writes a ticker snapshot to `social_trend_snapshots` with `source='creator_trends'`.

## Endpoints

`GET /api/external-collectors/status`

Checks whether the CLI binaries are available. Add `?live=1` to run deeper doctor checks for CLIs that support it.

`POST /api/external-collectors/run-now`

Admin-only. Requires `x-admin-email` when `VITE_ADMIN_EMAILS` is configured.

Example bodies:

```json
{ "collector": "yahoo-trending", "region": "US", "limit": 50 }
```

```json
{ "collector": "hackernews-pulse", "topics": ["AI agents", "semiconductors", "datacenter"], "days": 7 }
```

```json
{ "collector": "creator-trends", "query": "$NVDA", "platform": "youtube", "days": 7 }
```

Every run writes an `agent_run_logs` row with job name `external-...` for observability.

## Install Notes

Install the CLIs on the environment that runs `server.cjs`, then set env vars if the binary names differ from defaults:

- `PP_YAHOO_FINANCE_CLI=yahoo-finance-pp-cli`
- `PP_HACKERNEWS_CLI=hackernews-pp-cli`
- `PP_SCRAPE_CREATORS_CLI=scrape-creators-pp-cli`
- `SCRAPE_CREATORS_API_KEY=...`
- `HACKERNEWS_TREND_TOPICS=AI agents,semiconductors,Nvidia,datacenter,robotics`

The backend is safe if the CLIs are missing: status will report unavailable and run-now returns a normalized error.

## Convergence Use

Recommended order:

1. Treat Yahoo trending as a light social/attention confirmation, below insiders, 13D/G, 13F, and X/Reddit acceleration.
2. Use Hacker News topic pulse as a theme-level signal, not a ticker ranking by itself.
3. Use Scrape Creators on-demand for specific disputed themes or cashtags rather than broad always-on crawling.

