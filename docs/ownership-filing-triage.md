# Ownership Filing Triage (13D / 13G)

Dedicated pipeline and page for SEC Schedule 13D / 13G / 13D-A / 13G-A filings.
Route: `/ownership-filings`. Sidebar label: "13D/13G Triage". Also surfaced as
a highlight card at the top of the homepage (`/dashboard`, which is also `/`).

## Why this exists

The market-filings feed (`fetchMarketFilings` in `server.cjs`) already pulls
every 13D/13G/amendment from SEC EDGAR and resolves the subject company to a
ticker. What it didn't have was a way to separate "BlackRock crossed 5% again"
from "an activist is about to push for a board seat" without either reading
every filing by hand or running a full LLM analysis on all of them.

## Pipeline

1. **Ingest** — `fetchMarketFilings(days)` (existing) pulls the four EDGAR
   atom feeds, dedupes by accession number, and resolves tickers.
2. **Skip already-scored filings** — `getScoredAccessionNumbers()` checks
   `ownership_filing_signals.accession_no` so nothing is re-scored across runs.
3. **Fetch + classify with Jev** — `fetchEdgarFilingText()` (existing, shared
   with `/api/analyze-filing`) pulls the filing text, then `scoreFilingWithJev()`
   sends it to [Jev](https://docs.typesafe.ai) (TypeSafe's System One model) as
   one parallel "fan-out" request with five typed questions:
   - `investor_type` (choice): activist / passive_index / strategic_acquirer / other
   - `board_or_strategic_intent` (noul 0-1): does Item 4 disclose activist intent
   - `new_position` (noul 0-1): brand-new stake vs. routine update
   - `mechanical_crossing` (noul 0-1): looks like an index-fund threshold crossing
   - `materiality` (score 0-3): how much this is worth a human's attention now

   Jev is not a text-generation model — it returns typed values with
   calibrated confidence scores, not prose. Per TypeSafe's published pricing
   this costs roughly $0.042 per 1M input tokens (output is free) with
   70-500ms latency, so scoring every filing costs a fraction of a cent and
   adds no meaningful latency to the background job even during a 13G
   amendment deadline spike.
4. **Escalate the material few to the LLM** — `shouldEscalateToLlm()` sends a
   filing to the existing `QUANT_PROMPT` / Groq path (same one used by
   `POST /api/analyze-filing`) only when Jev's `materiality` score is >= 2
   with >= 0.6 confidence, or `board_or_strategic_intent` >= 0.7. This keeps
   LLM call volume to the filings that actually warrant a written thesis.
5. **Persist** — every scored filing (escalated or not) is upserted into
   `ownership_filing_signals` (see `supabase_migration_ownership_filing_triage.sql`),
   keyed by `accession_no`. `agent_run_logs` gets one row per job run with
   `items_processed`, `tokens_used`, and `ms_elapsed` for cost observability
   (same table used by the News Impact / Agent Alerts jobs).
6. **Serve** — `GET /api/ownership-filings/triage` reads from the DB, ranked
   by materiality then filed date, with `minMateriality` / `investorType` /
   `days` / `escalatedOnly` filters. The page defaults to hiding "Routine"
   filings (materiality < 0.75) so the feed leads with what matters.

## Escalation thresholds

| Condition | Escalates to LLM thesis? |
|---|---|
| `materiality >= 2` AND `materiality_confidence >= 0.6` | Yes |
| `board_or_strategic_intent >= 0.7` | Yes (regardless of materiality score) |
| Everything else | No — Jev fields alone drive the badge/ranking on the page |

Thresholds live in `shouldEscalateToLlm()` in `server.cjs`. Tune them there;
there is no separate config file.

## Endpoints

- `GET /api/ownership-filings/triage?minMateriality=&investorType=&days=&escalatedOnly=&limit=`
  — public read, returns `{ schemaVersion, signals, generatedAt }`.
- `POST /api/ownership-filings/run-now` — admin-only (same `x-admin-email` /
  `VITE_ADMIN_EMAILS` gate as `/api/news/run-now`), triggers one triage pass
  on demand without waiting for the schedule. Useful for verifying the
  TypeSafe key and Supabase wiring after first deploy.

## Environment variables

| Var | Purpose | Default |
|---|---|---|
| `TYPESAFE_API_KEY` | Jev API key from [typesafe.ai](https://typesafe.ai) | none — job no-ops without it |
| `OWNERSHIP_TRIAGE_ENABLED` | `1` to enable the scheduled job | `0` (off) |
| `JEV_MODEL` | Jev model alias | `jev-latest` |

The job is a safe no-op (`{ skipped: true, reason: ... }`) if the key,
Supabase, or the enabled flag are missing — same pattern as the Deep Analyze
and News Impact jobs. `POST /api/ownership-filings/run-now` and the scheduled
loop both short-circuit the same way, so it is safe to deploy this before the
TypeSafe account exists; the page will just show its empty state until the
key and flag are set.

## Database

Run `supabase_migration_ownership_filing_triage.sql` against the live
Supabase project (it depends on `app_settings` from
`supabase_migration_news_alerts.sql` — run that first if it hasn't been run).
Table: `ownership_filing_signals`, public read / service-role write, same RLS
shape as `news_items`.

## Known gaps / follow-ups

- `fetchMarketFilings` uses EDGAR's `action=getcurrent` atom feed, which only
  covers a recent rolling window, not a guaranteed N-day lookback — a busy
  filing day can mean the `days` cutoff passed to `fetchMarketFilings` is
  aspirational rather than actually covered. If filings start appearing to
  "skip" the feed, switch to EDGAR's daily-index files (same pattern already
  used for Form 4 insider filings) instead of `getcurrent`.
- The curated-activist-filer list idea (skip fetching + scoring known mega
  passive filers like BlackRock/Vanguard by name before hitting SEC at all)
  was considered but not implemented — Jev is cheap enough that the
  `mechanical_crossing` question handles this case post-fetch instead. Revisit
  if SEC rate-limiting becomes a problem, since that would save the fetch
  itself, not just the Jev/LLM cost.
- No detail drawer yet — the page links out to the raw SEC filing URL and to
  `/stock/:symbol`. A dedicated detail view (mirroring `FilingSheet`) would be
  the natural next step if the AI thesis needs more room than the card shows.
