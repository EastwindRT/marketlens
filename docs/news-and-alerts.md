# News Impact + Agent Alerts — Schema & API Reference

> Phase 1 (Foundation). Updated after each phase as new fields go live.
> Last updated: 2026-04-26

---

## Overview

Two hourly scheduled jobs power these features:

1. **`news-impact` job** — pulls headlines from Yahoo Finance + four NewsAPI
   queries, scores each with Claude Haiku 4.5, persists flagged items to
   `news_items`.
2. **`agent-briefing` job** — pulls unseen news + material Form 4 filings,
   cross-references against each player's watchlist, produces a max-5-bullet
   Claude briefing per active watchlist, persists to `agent_alerts`.

Every run writes one row to `agent_run_logs` for cost observability.

---

## Database tables

### `news_items`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto-generated |
| `headline` | text | original headline text |
| `source` | text | publisher name |
| `published_at` | timestamptz | from news provider |
| `fetched_at` | timestamptz | when TARS pulled it |
| `url` | text | article link (may be null) |
| `impact_score` | integer 1–10 | Claude score |
| `category` | text | see categories below |
| `summary` | text | one-sentence Claude summary |
| `affected_tickers` | text[] | e.g. `{AAPL, MSFT}` |
| `seen_by_agent` | boolean | flipped after successful briefing run |
| `raw_query` | text | which NewsAPI query produced this |
| `dedup_key` | text UNIQUE | `sha1(headline + published_at)` |

**Categories**: `macro`, `sector`, `company`, `policy`, `us_politics`,
`canada_macro`, `trade_policy`, `geopolitical`

### `agent_alerts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto-generated |
| `created_at` | timestamptz | run timestamp |
| `player_id` | uuid | null = global fallback |
| `briefing_text` | text | full Claude markdown |
| `bullets` | text[] | parsed bullet list (max 5) |
| `source_news_ids` | uuid[] | `news_items.id` values consumed |
| `source_filings` | jsonb | Form 4 entries that contributed |
| `watchlist_snapshot` | text[] | tickers at time of run |
| `delivered` | boolean | for future push/email use |

### `agent_run_logs`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | auto-generated |
| `run_at` | timestamptz | job start time |
| `job` | text | `news-impact` \| `agent-briefing` |
| `items_processed` | integer | headlines or news items consumed |
| `tokens_used` | integer | Claude token count for this run |
| `ms_elapsed` | integer | wall-clock duration |
| `error` | text | null = success |

### `app_settings`

Key/value feature flags checked at runtime.

| Key | Default | Purpose |
|---|---|---|
| `twitter_enabled` | `false` | Phase-2 Twitter/X scaffold flag |

---

## API endpoints

### `GET /api/news/impact`

Returns today's Claude-scored news sorted by `impact_score` descending.

**Query params**

| Param | Default | Description |
|---|---|---|
| `minScore` | `7` | Minimum `impact_score` to include (1–10) |
| `category` | (all) | Filter to one category slug |
| `days` | `1` | How many calendar days back to look (1–30) |
| `all` | `0` | Set to `1` to drop the `minScore` floor entirely |

**Response shape (`schemaVersion: 1`)**
```json
{
  "schemaVersion": 1,
  "items": [
    {
      "id": "uuid",
      "headline": "Fed signals rate pause...",
      "source": "Reuters",
      "publishedAt": "2026-04-26T14:00:00Z",
      "url": "https://...",
      "impactScore": 9,
      "category": "macro",
      "summary": "A Fed pause would ease pressure on rate-sensitive sectors.",
      "affectedTickers": ["SPY", "TLT"]
    }
  ],
  "generatedAt": "2026-04-26T15:00:00Z"
}
```

---

### `GET /api/alerts/latest`

Returns the most recent agent briefing for a player (or the global fallback).

**Query params**

| Param | Default | Description |
|---|---|---|
| `playerId` | (none) | UUID of signed-in player; omit for global |

**Response shape**
```json
{
  "schemaVersion": 1,
  "alert": {
    "id": "uuid",
    "createdAt": "2026-04-26T15:01:00Z",
    "bullets": [
      "AAPL — iPhone tariff exemption lifted; supply chain cost may rise 8–12%.",
      "NVDA — cluster insider buying ($2.1M total) across 4 executives this week."
    ],
    "sourceNewsIds": ["uuid1", "uuid2"],
    "sourceFilings": [
      { "ticker": "NVDA", "insiderName": "Jensen Huang", "type": "BUY", "amount": 450000, "filedDate": "2026-04-25", "accessionNo": "0001234..." }
    ],
    "watchlistSnapshot": ["AAPL", "NVDA", "TSM"]
  },
  "generatedAt": "2026-04-26T15:01:30Z"
}
```

`alert` is `null` if no briefing has been generated yet.

---

### `GET /api/alerts/insider-filings`

Returns recent material Form 4 filings (≥$100k buy or ≥3-insider cluster buy
within 7 days). Phase 1 returns an empty array; real data wired in Phase 3.

**Query params**

| Param | Default | Description |
|---|---|---|
| `days` | `7` | Lookback window (1–30) |

**Response shape**
```json
{
  "schemaVersion": 1,
  "filings": [
    { "ticker": "NVDA", "insiderName": "Jensen Huang", "type": "BUY", "amount": 450000, "filedDate": "2026-04-25", "accessionNo": "0001234..." }
  ],
  "generatedAt": "2026-04-26T15:00:00Z"
}
```

---

### `POST /api/news/run-now` _(admin-only, Phase 2+)_

Triggers a single `news-impact` job run on demand. Protected by admin email
allow-list. Returns `{ ok: true, written, skipped, tokensUsed }`.

### `POST /api/alerts/run-now` _(admin-only, Phase 3+)_

Triggers a single `agent-briefing` job run. Returns `{ ok: true, alertsCreated, newsMarked }`.

---

## Claude scoring prompt (Phase 2+)

**Model**: `CLAUDE_MODEL_PRESET` (default: Haiku 4.5 — headlines + metadata only)

**System**:
> You are a financial analyst. Does this headline have market impact in the
> next 30 days? Categories: macro, sector, company, policy, us_politics,
> canada_macro, trade_policy, geopolitical. For political news, only flag
> if it plausibly affects interest rates, trade, specific sectors, or
> currency — otherwise return null. If yes, return JSON:
> `{"impact_score":1-10,"category":"…","why":"one sentence","affected_tickers":["…"]}`.
> If no market impact, return null. Be strict — only flag genuinely material
> news.

**Cache key**: `sha1(headline + publishedAt)` in `aiResponseCache`, 24h TTL.
This means the same headline is scored at most once per 24 hours even if it
appears in multiple fetch cycles.

---

## Claude briefing prompt (Phase 3+)

**Model**: `CLAUDE_MODEL_PRESET` (Haiku 4.5)

**User message** (assembled per player):
> You are a portfolio analyst. Given these news items and insider filings,
> generate a briefing for a user holding these watchlist tickers: [list].
> Return max 5 bullets, only what is directly relevant to their positions
> or watchlist. Each bullet states: what happened, which ticker, why it
> matters. Be concise.

Max 50 news items + 25 filings fed per run. Never includes article body text.

---

## Cost model

| Item | Rough cost |
|---|---|
| Score one headline (Haiku 4.5, ~150 input tokens) | ~$0.00004 |
| 50 headlines per run | ~$0.002 |
| One briefing per player per hour (Haiku 4.5, ~2k tokens) | ~$0.001 |
| 10 active players | ~$0.01/hour |
| **Estimated monthly ceiling (10 players, 24h/day)** | **~$7/month** |

All runs logged to `agent_run_logs`. Admin can query actual token usage at
any time.

---

## Env vars

| Var | Default | Description |
|---|---|---|
| `NEWSAPI_KEY` | — | NewsAPI.org API key (required for Phase 2) |
| `NEWS_AGENT_ENABLED` | `1` | Set to `0` to disable news + alerts jobs |
| `DISABLE_BACKGROUND_SYNC` | `0` | Set to `1` to halt all background jobs |
| `CLAUDE_MODEL_PRESET` | `claude-haiku-4-5-20251001` | Model for scoring + briefing |
| `TWITTER_ENABLED` | — | Phase-2 scaffold; controlled via `app_settings` table |

---

## Twitter/X — Phase 2 scaffold

`app_settings.twitter_enabled = false` (seeded in migration).

When `true`, `fetchTwitterHeadlines()` will pull from a curated list of
financial accounts, filter for watchlist ticker mentions, and feed those
headlines into the same scoring pipeline. The function stub exists in
`server.cjs` but returns `[]` until Phase 2 is built.

---

## Phase changelog

| Phase | Date | What changed |
|---|---|---|
| 1 — Foundation | 2026-04-26 | Schema, DB-backed endpoints (empty until Phase 2 ingestion runs), typed client, this doc. Note: `/api/news/impact` and `/api/alerts/latest` query the DB immediately — they return empty arrays until ingestion populates `news_items`. |
| 2 — Ingestion | TBD | Yahoo + NewsAPI fetchers, Claude scoring, `run-now` endpoint |
| 3 — Agent | TBD | Form 4 filter, briefing pipeline, per-player alerts |
| 4 — Scheduling | TBD | Hourly scheduler wiring, Twitter stub, polish |
