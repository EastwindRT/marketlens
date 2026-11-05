# Filing Triage (13D/13G, Form 4, 8-K) and MCP

TARS is a filings-intelligence app. Every new SEC filing of a supported type is scored by Jev (a fast
typed classifier), given a unified 0-100 priority, and only the material few are escalated to an LLM for a
written read. Supersedes `ownership-filing-triage.md`.

Routes: `/filings` (unified feed, landing page), `/ownership-filings` (13D/13G detail view).

## Pipeline

1. **Discover** (`FILING_DISCOVERERS` in `server.cjs`), per type, newest first, skipping accession numbers already in
   `filing_triage_seen`. A real day is ~400 8-Ks and ~1,600 Form 4s, so discovery combines two sources: the live
   "current filings" atom feed, paged with `start=` (`TRIAGE_ATOM_MAX_PAGES`, default 8 pages of 100), and the EDGAR daily
   index for the previous `TRIAGE_INDEX_DAYS` days (default 3). Today's index is not published until the day closes, so the
   atom pages cover today and the index covers everything earlier (this also back-fills after downtime).
   - `ownership` - `fetchMarketFilings()`: 13D/13G/13D-A/13G-A atom feeds, ticker-resolved (low volume, one page each).
   - `insider` - paged Form 4 atom + daily index, then `fetchSecInsiderActivityItem()`. Filings with no discretionary
     open-market buy/sell (grants, tax withholding, exercises only) are recorded as skipped. Cluster buying (3+ distinct
     insiders buying the same ticker in the batch) is detected here, because a single filing cannot reveal it.
   - `event` - paged 8-K atom + daily index. Atom entries whose items are all routine (9.01, 7.01, 5.07) are recorded as
     skipped; index-only entries have no item codes, so Jev classifies those (`event_category: routine`).
2. **Score** - one Jev call per filing with the type's question set (`filingTriage.cjs`). Jev returns typed values
   with confidence, not prose (~$0.042 per 1M input tokens, output free, 70-500ms).
3. **Priority** - `computePriority`: `materiality(0-3)/3*100 * (0.6 + 0.4*confidence)`, raised to a type-specific floor
   for red flags. Tiers: critical >= 75, high >= 50, medium >= 25, low.
4. **Escalate** - each type has a `shouldEscalate` rule. Escalated filings get a JSON thesis:
   ownership via Groq `QUANT_PROMPT` (falls back to Claude preset), Form 4 and 8-K via the Claude preset model
   (`CLAUDE_MODEL_PRESET`) with the type's `thesisPrompt`.
5. **Persist** - `filing_signals` (one row per scored accession number); `filing_triage_seen` records every accession
   handled, scored or skipped, so skipped filings are never re-downloaded (also memoized in-process);
   `agent_run_logs` row per run (job `filing-triage`).

The job drains the backlog with a worker pool (`FILING_TRIAGE_CONCURRENCY`, default 4) up to `FILING_TRIAGE_MAX_PER_TYPE`
(default 250) per type and `FILING_TRIAGE_BUDGET_MS` (default 8 min) per run. Anything over the cap stays unseen and is
picked up first next run; the run summary reports `listed`, `unseen`, `skipped`, `scored`, `escalated` and `deferred`.
A failed `filing_triage_seen` lookup aborts that type's run rather than risk re-scoring everything.

## Modes: rules, hybrid, jev

`FILING_TRIAGE_MODE` picks how filings are scored. If unset it is `hybrid` when `TYPESAFE_API_KEY` exists, otherwise `rules`.

| Mode | Needs | What happens |
|---|---|---|
| `rules` | nothing but Supabase | `filingRules.cjs` ranks each filing from form type, filer, 8-K item codes and trade size, and drops obvious noise. No Jev, no LLM. |
| `hybrid` | Jev key | Rules drop the noise first (free); Jev scores only what is left; if a Jev call fails the filing keeps its rule-based score. |
| `jev` | Jev key | Jev scores everything (no pre-filter, no fallback). |

Noise is any filing whose rule priority is below `FILING_TRIAGE_NOISE_FLOOR` (default 15). It is recorded in
`filing_triage_seen` as skipped and not stored in the feed. Rule priorities (see `filingRules.cjs`):

| Type | Rule examples |
|---|---|
| 13D/13G | new 13D 70, 13D/A 55, new 13G 25, 13G/A 12, 13G from a large passive manager (BlackRock, Vanguard, ...) 5 |
| Form 4 | cluster buy 75-80; open-market buy 20-65 by size (+10 for an executive); sales 5-40 by size (a $10M+ sale 40) |
| 8-K | highest item present: 1.03/4.02 85; 2.04/3.01 80; 1.05/5.01 75; 1.01/2.01 55; 5.02 40; 2.02 35; 8.01 25; 7.01/9.01/5.07 3 |

Limits of rules: they cannot read the text, so most 8-Ks survive (nearly all carry a substantive item), Form 4 sales cannot
be told apart from 10b5-1 plan sales, and a 13D's intent is not read. That is the gap Jev closes. Rule-scored rows carry
`signals.scored_by = 'rules'` and a `rule_reason`; Jev-scored rows keep `rule_priority` for comparison.

`POST /api/filings/discover?preview=1` shows, for real discovered filings, what the rules would keep and drop (no writes).

## Per-type rules

| Type | Jev questions | Priority floor | Escalates when |
|---|---|---|---|
| ownership (13D/13G) | investor_type, board_or_strategic_intent, new_position, mechanical_crossing, materiality | 85 if intent >= 0.7 | materiality >= 2 with conf >= 0.6, or intent >= 0.7 |
| insider (Form 4) | insider_role, discretionary_open_market, pre_arranged_plan, conviction_buy, materiality | 70 cluster buy; 60 if conviction >= 0.8 and >= $100K | cluster buy, or materiality >= 2 with conf >= 0.6 |
| event (8-K) | event_category, adverse_surprise, positive_catalyst, materiality | 80 distress; 65 if adverse >= 0.8 | distress, or non-routine with materiality >= 2 and conf >= 0.6 |

Tune thresholds in `filingTriage.cjs`; there is no separate config file.

## Endpoints

- `GET /api/filings/feed?types=&minPriority=&tier=&days=&escalatedOnly=&symbol=&symbols=&limit=` - public read, schemaVersion 2.
  `symbols` is a comma list (your watchlist, up to 50); the response includes `triageMode`.
- `GET /api/ownership-filings/triage` - legacy 13D/13G view, reads `filing_signals` and flattens ownership fields.
- `POST /api/filings/run-now[?types=ownership,insider,event]` - admin-only (`x-admin-email` / `VITE_ADMIN_EMAILS`).
- `POST /api/ownership-filings/run-now` - admin-only, ownership only.
- `POST /api/filings/discover[?types=&limit=]` - admin-only **dry run**: lists what the next pass would pick up
  (`listed`, `unseen`, `skipped`, sample rows) without calling Jev or the LLM and without writing. Use it to check coverage.

Unknown `/api/*` routes return a JSON 404 (they no longer fall through to the SPA shell).

## MCP server

`POST /mcp` - stateless MCP over Streamable HTTP (JSON responses, tools only), implemented in `mcp.cjs` with no SDK
dependency. Optional `MCP_API_KEY`: when set, clients must send `Authorization: Bearer <key>`.

| Tool | Purpose |
|---|---|
| `get_priority_feed` | Ranked filings; filter by types, symbols (your tickers), min_priority (default 50), tier, days (default 3), escalated_only, limit |
| `get_filing` | One filing by accession number, with typed signals and AI thesis |
| `get_ticker_filings` | Everything triaged for one ticker |
| `get_stock_intelligence` | Per-ticker context (price/trend, insiders, 13D/G, congress, funds, fundamentals) |

Connect from Claude Code:

```bash
claude mcp add --transport http tars https://marketlens-jn9s.onrender.com/mcp
# with a key: add --header "Authorization: Bearer <MCP_API_KEY>"
```

## Environment

| Var | Purpose | Default |
|---|---|---|
| `TYPESAFE_API_KEY` | Jev API key (typesafe.ai); optional, rules mode works without it | none |
| `OPENROUTER_API_KEY` | Alternative: reach Jev through OpenRouter (`https://openrouter.ai/api/v1/systemone`, model `~typesafe/jev-latest`); no TypeSafe account or waitlist. Ignored if `TYPESAFE_API_KEY` is set | none |
| `JEV_ENDPOINT` | Override the Jev URL | TypeSafe direct, or the OpenRouter URL when only `OPENROUTER_API_KEY` is set |
| `FILING_TRIAGE_ENABLED` | `1` enables the 20-minute scheduled job (`OWNERSHIP_TRIAGE_ENABLED=1` is still honoured) | `0` |
| `FILING_TRIAGE_MODE` | `rules`, `hybrid` or `jev` (see Modes) | `hybrid` with a Jev key, else `rules` |
| `FILING_TRIAGE_NOISE_FLOOR` | Rule priority below this is dropped as noise | `15` |
| `JEV_MODEL` | Jev model id | `jev-latest` (direct) or `~typesafe/jev-latest` (OpenRouter) |
| `ANTHROPIC_API_KEY` | Required for Form 4 and 8-K theses | none |
| `GROQ_API_KEY` | Ownership thesis (optional; Claude is the fallback) | none |
| `MCP_API_KEY` | Optional bearer key for `/mcp` | none (open, matches the public feed) |

Optional tuning: `TRIAGE_ATOM_MAX_PAGES`, `TRIAGE_INDEX_DAYS`, `FILING_TRIAGE_MAX_PER_TYPE`, `FILING_TRIAGE_CONCURRENCY`,
`FILING_TRIAGE_BUDGET_MS`.

The job is a safe no-op if the flag, key, or Supabase is missing. Run
`supabase_migration_news_alerts.sql` (for `app_settings`), `supabase_migration_filing_signals.sql`, then
`supabase_migration_filing_triage_seen.sql` before enabling (the last two are already applied to the live project).

## Known gaps

- The request/response contract for Jev comes from `docs.typesafe.ai`; it has not been exercised against a live key.
- 13D/13G discovery still reads one page of each atom feed (~100 entries per form type); fine for normal volume, but a
  13G amendment deadline spike could exceed it. Paging and the daily index would fix that the same way as Form 4 and 8-K.
- Coverage of "today" depends on the atom pages reaching back to the previous poll; after an outage of more than a few
  hours, the gap is filled from the daily index the next day.
- A Form 4 whose first parse is empty (derivative-only filing or a transient SEC error) is retried once before it is
  recorded as skipped; that counter is in-memory, so a restart re-tries it once more.
- Form 4 cluster detection only sees the current batch, not a rolling DB window.
- Form 4 captures the first reporting owner per filing; multi-owner filings are not split.
- 8-K sector/industry is not resolved; Form 4 sector is not resolved either.
- No dedicated filing detail page yet; rows link to the SEC filing and `/stock/:symbol`.
