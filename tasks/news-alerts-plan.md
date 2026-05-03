# News Impact + Agent Alerts — Master Plan (2026-04-26)

> Working agreement for the parallel build between Claude (server / data) and
> Codex (UI / routing). Detailed implementation checklist lives in `todo.md`
> under `Plan: News Impact + Agent Alerts (2026-04-26)`. This file is the
> shared map: scope, why, phasing, sync points, and the review protocol.

---

## 1. What we are building and why

TARS already shows news, insider trades, congress trades, and watchlists
separately. There is nothing today that:

- ranks news by **market impact** (so a user has to read everything),
- combines news + insider activity **against the user's own watchlist**,
- treats political / geopolitical news as market-relevant only when it
  actually moves rates, trade, sectors, or currency.

We are adding two features that close those gaps end-to-end:

### Feature 1 — News Impact
A scheduled hourly job pulls headlines from Yahoo Finance and four NewsAPI.org
queries (financial, "Trump" on Reuters/AP/Bloomberg/CNBC, Canada macro,
geopolitical/trade). Each new headline is scored by Claude Haiku 4.5 with a
strict prompt — only genuinely material news survives. Survivors are stored
with `impact_score`, `category`, `summary`, and `affected_tickers`, exposed
via `GET /api/news/impact`, and rendered in a new News Impact tab with
category filter chips and a default ≥7-score floor.

### Feature 2 — Agent Alerts
A second hourly job runs after news ingestion. It pulls unseen news, pulls
recent **material** Form 4 insider filings from EDGAR (≥$100k buys or
cluster-buys), intersects both with each player's watchlist, and asks Claude
to produce a max-5-bullet briefing tailored to that watchlist. The briefing
is stored in `agent_alerts` and shown in a new Alerts tab with a clean
digest card and a separate Insider Filings table (watchlist rows highlighted).

### Phase-2 scaffold
Twitter/X is **not** built this round. We add a `twitter_enabled=false`
config flag and a stub fetcher so the pipeline is ready to extend.

### Hard rules (apply everywhere)

| Rule | Why |
|---|---|
| Claude calls send headlines + metadata only, never article bodies | Token cost + provider TOS |
| Every scheduled run writes one `agent_run_logs` row with `tokens_used`, `items_processed`, `ms_elapsed` | Cost observability |
| Reuse `aiResponseCache` (24h) keyed by `sha1(headline + published_at)` | Avoid re-scoring the same story |
| `news_items.seen_by_agent` flag flips only after the agent run **succeeds** | Prevent dropped briefings |
| Jobs are no-ops when `serverSupabase` or `ANTHROPIC_API_KEY` is missing | Local dev safety |
| `DISABLE_BACKGROUND_SYNC=1` and `NEWS_AGENT_ENABLED=0` both halt the loop | Render kill-switch |
| New UI matches existing TARS design language (cards, skeletons, `DataStatus`) | Visual coherence |

---

## 2. File ownership (parallel build lock list)

Whoever owns a file is the only side editing it this round. Shared docs are
append-only by side.

### Claude owns
- `server.cjs` — endpoints, schedulers, fetchers, scoring, briefing pipeline
- `supabase_migration_news_alerts.sql` (new)
- `src/api/news.ts` (new) — typed client
- `docs/news-and-alerts.md` (new) — schema + prompt + cost reference
- `render.yaml` — new env vars

### Codex owns
- `src/pages/NewsImpact.tsx` (new)
- `src/pages/AgentAlerts.tsx` (new)
- `src/components/news/ImpactCard.tsx` (new)
- `src/components/news/FilterChips.tsx` (new)
- `src/components/alerts/BriefingCard.tsx` (new)
- `src/components/alerts/InsiderFilingsTable.tsx` (new)
- `src/App.tsx` — route registration
- `src/components/layout/Sidebar.tsx` + bottom-nav — nav entries
- `src/hooks/useNewsImpact.ts` + `src/hooks/useAgentAlerts.ts` (new) — React Query wrappers around `src/api/news.ts`

### Shared (append-only by side)
- `marketlens/tasks/todo.md`
- `Status.md`
- `marketlens/tasks/lessons.md`

### Review files (one writes, the other reads)
- `marketlens/tasks/codexissues.md` — written by Claude, contains issues / improvements Claude found in Codex's work
- `marketlens/tasks/claudeissues.md` — written by Codex, contains issues / improvements Codex found in Claude's work

Neither side fixes the other's code. Issues land in the review files, both
sides read them at the start of the next phase, and the responsible side
addresses them as part of their next slice.

---

## 3. Phased plan (with sync points)

Each phase has a Claude track, a Codex track, a sync gate, and a review pass.
Neither side moves to phase N+1 until both finish phase N **and** the review
pass is written.

### Phase 1 — Foundation: schema + skeleton routes (target: same-day)

**Goal**: tables exist, routes exist, both sides can develop against the
contract without one blocking the other.

**Claude track**
- [ ] Write `supabase_migration_news_alerts.sql` with `news_items`,
      `agent_alerts`, `agent_run_logs`, `app_settings` (+ RLS).
- [ ] Add `serverSupabase` helpers for these tables.
- [ ] Stub `GET /api/news/impact`, `GET /api/alerts/latest`,
      `GET /api/alerts/insider-filings` returning empty arrays + a
      `schemaVersion` field. No Claude calls yet, no fetchers yet.
- [ ] Publish the response shapes in `docs/news-and-alerts.md`.

**Codex track**
- [ ] Add `/news-impact` and `/alerts` routes in `src/App.tsx`, lazy-loaded.
- [ ] Add Sidebar + bottom-nav entries (icons: `newspaper`, `bell`).
- [ ] Build empty page shells (`NewsImpact.tsx`, `AgentAlerts.tsx`) with
      TARS skeletons + `DataStatus` line, calling the stub endpoints via
      a temporary direct fetch so wiring is provable.
- [ ] No real components yet — the page just proves "route + endpoint round
      trip works".

**Sync gate**
- Both run `npm run build` clean.
- Codex page renders a skeleton driven by the (empty) Claude endpoint.
- Both append a Phase-1 shipped block to `todo.md` and `Status.md`.

**Review pass** (both sides, before Phase 2)
- Claude reads Codex diff → writes findings to `codexissues.md`.
- Codex reads Claude diff → writes findings to `claudeissues.md`.
- If either file has any **blocker** entry, owners must address before
  Phase 2 starts.

---

### Phase 2 — Ingestion + News UI

**Goal**: real headlines get scored and stored; the News Impact page
renders them with score colour, category chips, and the ≥7 default filter.

**Claude track**
- [ ] `fetchYahooFinanceHeadlines()`.
- [ ] `fetchNewsApiHeadlines(query, sources)` for the 4 queries.
- [ ] `dedupeHeadline()` + `dedup_key` enforcement.
- [ ] `scoreHeadlineWithClaude()` with the strict prompt + cache + token log.
- [ ] `runNewsImpactJob()` — full ingest cycle, writes `news_items` and one
      `agent_run_logs` row.
- [ ] `POST /api/news/run-now` (admin-only) for manual trigger.
- [ ] Real `GET /api/news/impact?minScore=&category=&days=&all=`.
- [ ] `src/api/news.ts` client + types.

**Codex track**
- [ ] `ImpactCard.tsx` (headline, score badge, category tag, summary, ticker
      chips linking to `/stock/:symbol`).
- [ ] Score-tier colours: 9–10 red, 7–8 amber, ≤6 muted.
- [ ] `FilterChips.tsx` for: All, Macro, Sector, Company, US Politics,
      Canada, Trade Policy.
- [ ] `useNewsImpact.ts` React Query hook wrapping `src/api/news.ts`.
- [ ] Default view = `minScore=7`; toggle to drop the floor.
- [ ] Empty / loading / error states match existing TARS pages.

**Sync gate**
- Manual `POST /api/news/run-now` populates ≥1 row in `news_items` with a
  non-null score.
- News Impact page renders that row, the chips switch categories, the toggle
  lifts the score floor.
- Both verify `agent_run_logs` has a row for the run.

**Review pass** → write to `codexissues.md` / `claudeissues.md`.

---

### Phase 3 — Agent briefing + Alerts UI

**Goal**: agent runs, produces a real per-watchlist briefing, writes to
`agent_alerts`, flips `seen_by_agent`. Alerts UI renders briefing + filings.

**Claude track**
- [ ] `fetchRecentMaterialForm4Entries({ days: 7 })` with the
      ≥$100k or ≥3-insider/week material filter.
- [ ] `runAgentBriefingJob()` — pull unseen news + filings, group by player
      watchlist, call Claude per active watchlist, persist briefing, flip
      `seen_by_agent` only on success, log tokens.
- [ ] `GET /api/alerts/latest?playerId=…` (per-player + global fallback).
- [ ] `GET /api/alerts/insider-filings?days=7`.
- [ ] `POST /api/alerts/run-now` (admin-only).

**Codex track**
- [ ] `BriefingCard.tsx` — digest card with timestamp + bullet list +
      "what / which ticker / why" formatting.
- [ ] `InsiderFilingsTable.tsx` — ticker, insider, type, amount, date;
      watchlist rows highlighted via `watchlistStore`.
- [ ] `useAgentAlerts.ts` React Query hook.
- [ ] Mobile layout pass for the table (collapse to cards under 640px).

**Sync gate**
- Manual `POST /api/alerts/run-now` writes one row to `agent_alerts` and
  flips `seen_by_agent` on the news rows it consumed.
- Alerts page shows the briefing + the filings table; watchlist rows visibly
  highlighted.

**Review pass** → write to `codexissues.md` / `claudeissues.md`.

---

### Phase 4 — Scheduling, scaffold, polish

**Goal**: jobs run on their own; Twitter stub is in place; both pages feel
finished.

**Claude track**
- [ ] Wire `runNewsImpactJob` and `runAgentBriefingJob` into
      `startBackgroundSyncLoop` at 60-min cadence, briefing chained after
      news ingest, gated on `NEWS_AGENT_ENABLED`.
- [ ] Twitter stub: `app_settings.twitter_enabled` flag + `fetchTwitterHeadlines()`
      stub returning `[]`. `runNewsImpactJob` reads flag and calls stub when true.
- [ ] Optional admin endpoint surfacing recent `agent_run_logs` rows for
      cost monitoring.
- [ ] `docs/news-and-alerts.md` — finalize cost notes from real run logs.

**Codex track**
- [ ] `DataStatus` freshness line on both new pages, driven by React Query
      `dataUpdatedAt`.
- [ ] Mobile + dark-mode visual pass on both pages.
- [ ] Empty-state copy when no flagged news today and no briefing yet.

**Sync gate**
- App runs untouched for ≥1 hour; `agent_run_logs` shows two rows per cycle
  (news + briefing); no errors in Render logs.
- Twitter flag toggled in `app_settings`: stub log line appears, no crash.

**Review pass** → final entries in `codexissues.md` / `claudeissues.md`.
Outstanding non-blocker items roll into a follow-up plan in `todo.md`.

---

## 4. Review protocol

After every phase:

1. Each side reads the other's diff (file list above scopes the surface).
2. Each side writes findings into the appropriate review file:
   - `codexissues.md` — Claude's notes on Codex's work
   - `claudeissues.md` — Codex's notes on Claude's work
3. Use this entry shape per finding:

   ```
   ### [Phase N] <one-line title>
   **Severity**: blocker | improvement | nit
   **File**: path/to/file:line
   **Observation**: what you saw
   **Suggestion**: what you would change and why
   **Owner action**: required before next phase | next phase | optional
   ```

4. Do **not** edit the other side's code. Only write findings.
5. At the start of the next phase, both sides read both files, address
   blockers in their own track, and roll improvements into their next slice.

---

## 5. Verification (final, before declaring shipped)

- [ ] `node --check server.cjs` clean
- [ ] `npm run build` clean
- [ ] One full hourly cycle observed in `agent_run_logs` with non-zero
      `items_processed` and bounded `tokens_used`
- [ ] Cost smoke test: ≤ ~$0.05 per cycle in Claude tokens at Haiku pricing
- [ ] News Impact page: filter chips work, ≥7 toggle works, score colours
      correct, ticker chips link to `/stock/:symbol`
- [ ] Alerts page: briefing renders for the signed-in player, filings table
      highlights watchlist rows, mobile layout reads cleanly
- [ ] Twitter stub: flag toggle is a no-op other than a log line
- [ ] Both review files contain entries; no blockers outstanding
- [ ] `todo.md` and `Status.md` carry dated shipped blocks from both sides

---

## 6. Out of scope this round

- Real Twitter/X polling (stub only).
- Push notifications, email digests, mobile push.
- Per-user prompt customisation.
- Historical news backfill — the feed starts from go-live.
- Yahoo paid-tier auth: if free endpoint suffices, ship; if not, log as a
  follow-up rather than block the rollout.
