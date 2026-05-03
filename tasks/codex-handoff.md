# Codex hand-off — News Impact + Agent Alerts (2026-04-26)

> Paste this whole file (or the section labelled **"For the Codex prompt"**)
> into your Codex session. It contains the full picture, your slice, and the
> review protocol. Do not change Claude-owned files. Do not fix Claude's
> code if you find issues — write them to `claudeissues.md` instead.

---

## 1. The whole picture (so you know why)

TARS / MoneyTalks is a stock-research + league-portfolio app. We are adding
two features end-to-end:

### Feature 1 — News Impact
Hourly job pulls headlines from Yahoo Finance and four NewsAPI queries
(financial, "Trump" filtered to Reuters/AP/Bloomberg/CNBC, Canada macro,
geopolitical/trade). Claude Haiku 4.5 scores each headline with a strict
prompt — only genuinely market-moving news survives. Survivors land in a
`news_items` table with `impact_score`, `category`, `summary`,
`affected_tickers`. They surface via `GET /api/news/impact` and a new
News Impact tab.

### Feature 2 — Agent Alerts
Hourly job runs after news ingestion. It pulls unseen news + recent
**material** Form 4 insider filings (≥$100k buys or ≥3-insider cluster
buys/week), intersects them with each player's watchlist, and asks Claude
for a max-5-bullet briefing tailored to that watchlist. Briefing lands in
`agent_alerts`. Alerts UI shows the briefing card on top and an Insider
Filings table below — watchlist rows highlighted.

### Phase-2 scaffold
Twitter/X is **not** built. There is a `twitter_enabled=false` flag and a
stub fetcher. Do not add Twitter UI this round.

### Why this matters
Today users have to read every news source and every insider feed and then
mentally cross-reference against their watchlist. These features collapse
that workflow into one ranked feed and one personalised briefing per hour.

---

## 2. Your slice (Codex owns)

You are the UI / routing / hooks layer. You are **not** allowed to edit
`server.cjs`, the SQL migration, `src/api/news.ts`, `docs/news-and-alerts.md`,
or `render.yaml` — those are Claude's.

### Files you own (all new unless marked)
- `src/pages/NewsImpact.tsx` — News Impact tab page
- `src/pages/AgentAlerts.tsx` — Alerts tab page
- `src/components/news/ImpactCard.tsx`
- `src/components/news/FilterChips.tsx`
- `src/components/alerts/BriefingCard.tsx`
- `src/components/alerts/InsiderFilingsTable.tsx`
- `src/hooks/useNewsImpact.ts`
- `src/hooks/useAgentAlerts.ts`
- `src/App.tsx` — *only* to register the two new routes (lazy)
- `src/components/layout/Sidebar.tsx` + bottom-nav — *only* to add nav entries

### Append-only doc edits
- `marketlens/tasks/todo.md` — your dated shipped blocks only
- `Status.md` — your dated shipped blocks only
- `marketlens/tasks/lessons.md` — append your lessons only
- `marketlens/tasks/claudeissues.md` — your review of Claude's diff (issues
  / improvements you found)

### Do **not** touch
- `server.cjs`
- `supabase_migration_news_alerts.sql`
- `src/api/news.ts` (consume it via your hooks; if the shape is wrong, write
  it to `claudeissues.md`, do **not** edit the file)
- `docs/news-and-alerts.md`
- `render.yaml`

---

## 3. Contract Claude is publishing for you

Read the live shapes in `docs/news-and-alerts.md` and the typed client in
`src/api/news.ts`. The contract you can rely on (Phase 1 returns empty
arrays with the same shape so you can build skeletons immediately):

### `GET /api/news/impact?minScore=7&category=…&days=1&all=0`
```ts
{
  schemaVersion: number,
  items: Array<{
    id: string,
    headline: string,
    source: string,
    publishedAt: string,            // ISO
    url: string | null,
    impactScore: number,            // 1-10
    category: 'macro' | 'sector' | 'company' | 'policy'
            | 'us_politics' | 'canada_macro' | 'trade_policy'
            | 'geopolitical',
    summary: string,                // one sentence
    affectedTickers: string[],
  }>,
  generatedAt: string,
}
```

### `GET /api/alerts/latest?playerId=…`
```ts
{
  schemaVersion: number,
  alert: {
    id: string,
    createdAt: string,
    bullets: string[],              // max 5
    sourceNewsIds: string[],
    sourceFilings: Array<{ ticker, insiderName, type, amount, filedDate, accessionNo }>,
    watchlistSnapshot: string[],
  } | null,
}
```

### `GET /api/alerts/insider-filings?days=7`
```ts
{
  schemaVersion: number,
  filings: Array<{
    ticker: string,
    insiderName: string,
    type: 'BUY' | 'SELL',
    amount: number,                 // USD
    filedDate: string,
    accessionNo: string,
  }>,
}
```

If any field comes back differently from what's documented, **don't fix the
server** — write the discrepancy into `claudeissues.md`.

---

## 4. Phased plan and your tasks per phase

### Phase 1 — Foundation
- Add `/news-impact` and `/alerts` routes (lazy) in `src/App.tsx`.
- Add Sidebar + bottom-nav entries (icons: `newspaper`, `bell`).
- Build empty page shells that:
  - call the stub endpoints via a temporary direct fetch,
  - render the existing TARS skeleton + a `DataStatus` line,
  - prove the route + endpoint round-trip works.
- No real components yet. This phase is wiring only.

### Phase 2 — News UI
- `ImpactCard.tsx`: headline, score badge (9–10 red, 7–8 amber, ≤6 muted),
  category tag, one-line summary, ticker chips that link to `/stock/:symbol`.
- `FilterChips.tsx`: All, Macro, Sector, Company, US Politics, Canada,
  Trade Policy. Maps to the `category` query param.
- `useNewsImpact.ts` React Query hook around `src/api/news.ts`.
- Default view = `minScore=7`; toggle to drop the floor.
- Match existing TARS empty / loading / error patterns.

### Phase 3 — Alerts UI
- `BriefingCard.tsx`: digest card with timestamp + bullet list.
- `InsiderFilingsTable.tsx`: ticker / insider / type / amount / date.
  Highlight rows where `ticker` is in `watchlistStore`. Mobile: collapse to
  cards under 640px.
- `useAgentAlerts.ts` React Query hook.
- Page composition: briefing on top, filings below.

### Phase 4 — Polish
- `DataStatus` freshness line on both pages, driven by React Query
  `dataUpdatedAt`.
- Mobile + dark-mode visual pass.
- Empty-state copy when there's no flagged news / no briefing yet.

---

## 5. Review protocol (after every phase)

You read Claude's diff. You write findings into
`marketlens/tasks/claudeissues.md`. You do **not** edit Claude's code.

Entry shape:

```
### [Phase N] <one-line title>
**Severity**: blocker | improvement | nit
**File**: path/to/file:line
**Observation**: what you saw
**Suggestion**: what you would change and why
**Owner action**: required before next phase | next phase | optional
```

At the start of the next phase, read both `claudeissues.md` and
`codexissues.md`. Address any **blocker** Claude raised about your work
before moving forward; roll **improvements** into your next slice.

---

## 6. Hard rules

- New UI must match existing TARS design language (cards, skeleton pattern,
  `DataStatus` freshness line).
- Bundle hygiene: lazy-load both new pages; do not pull heavy deps.
- No new Claude API calls from the client. All AI work stays server-side.
- Do not invent new endpoints; only consume what `src/api/news.ts` exposes.
- Mobile: 44px touch targets, readable card density.

---

## For the Codex prompt (copy this if you only paste one block)

> You are working on TARS / MoneyTalks. Read
> `marketlens/tasks/news-alerts-plan.md` and
> `marketlens/tasks/codex-handoff.md` first.
>
> You own the UI / routing / hooks layer for two new features: News Impact
> (hourly Claude-scored headlines) and Agent Alerts (hourly per-watchlist
> briefing + insider filings table). Claude is building the server, schema,
> ingestion, scoring, and briefing pipeline in parallel.
>
> Do not edit `server.cjs`, the SQL migration, `src/api/news.ts`,
> `docs/news-and-alerts.md`, or `render.yaml`. Consume the contract
> documented in `docs/news-and-alerts.md` and the typed client in
> `src/api/news.ts`. If anything looks wrong on Claude's side, write it to
> `marketlens/tasks/claudeissues.md` — do not fix it.
>
> Build in four phases (Foundation → News UI → Alerts UI → Polish). After
> each phase, review Claude's diff and write findings to `claudeissues.md`.
> At the start of each phase, read both `claudeissues.md` and
> `codexissues.md`, address blockers in your own slice, and roll
> improvements into your next pass.
>
> Append your own dated shipped blocks to `tasks/todo.md` and `Status.md` —
> do not edit Claude's blocks. Match existing TARS design language,
> lazy-load both new pages, run `npm run build` clean before declaring a
> phase done.
