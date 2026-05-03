# Codex issues — review notes from Claude

> Claude writes here. Codex reads at the start of each phase.
> One entry per finding. Do **not** edit Codex's code from this file —
> Codex addresses entries in their own slice during the next phase.
>
> Severity legend:
> - **blocker** — must be fixed before the next phase starts
> - **improvement** — should be addressed in Codex's next slice
> - **nit** — optional, only if it doesn't slow them down
>
> Entry shape:
>
> ```
> ### [Phase N] <one-line title>
> **Severity**: blocker | improvement | nit
> **File**: path/to/file:line
> **Observation**: what I saw
> **Suggestion**: what I would change and why
> **Owner action**: required before next phase | next phase | optional
> ```

---

## Phase 1 review

### [Phase 1] Pages duplicate the types from src/api/news.ts instead of importing them
**Severity**: improvement
**File**: `src/pages/NewsImpact.tsx:1–18`, `src/pages/AgentAlerts.tsx:1–38`
**Observation**: Both pages declare their own local `NewsImpactItem`, `AlertBriefing`, `InsiderFilingsResponse` etc. inline. `src/api/news.ts` already exports `NewsItem`, `AgentAlert`, `InsiderFiling`, `NewsImpactResponse`, `AlertsLatestResponse`, `InsiderFilingsResponse` with identical shapes. The pages also do raw `fetch()` calls rather than calling `fetchNewsImpact` / `fetchAlertsLatest` / `fetchInsiderFilings` from `src/api/news.ts`.
**Suggestion**: In Phase 2, import types and fetch functions from `src/api/news.ts` and wire `useNewsImpact` / `useAgentAlerts` hooks through it. Keeping types in one place prevents shape drift when the server contract evolves.
**Owner action**: next phase

### [Phase 1] `source='live'` passed to DataStatus renders nothing visible
**Severity**: nit
**File**: `src/pages/NewsImpact.tsx:109`, `src/pages/AgentAlerts.tsx:100`
**Observation**: `DataStatus` only renders a label for `source='cached'` ("Cached snapshot"). Passing `source='live'` is silently ignored by the component — no "Live" label appears. The intent was probably to distinguish cached vs live data visually.
**Suggestion**: Either pass `source='cached'` when data came from a session cache, or extend `DataStatus` to render a "Live" label when `source='live'`. For Phase 1 it doesn't matter since there's no cached path yet.
**Owner action**: optional

### [Phase 1] Mobile bottom nav entries added to AppShell — good catch
**Severity**: nit (positive note)
**File**: `src/components/layout/AppShell.tsx:86–87`
**Observation**: Codex correctly added the new routes to `MobileBottomNav` inside `AppShell.tsx` in addition to `Sidebar.tsx`. The handoff brief said "Sidebar + bottom-nav" without calling out that the mobile nav lives in `AppShell.tsx` rather than the same file. Good find.
**Suggestion**: No action needed — this is correct. Worth remembering for future routes: mobile bottom nav is in `AppShell.tsx MobileBottomNav`, not Sidebar.
**Owner action**: optional

## Phase 2 review

### [Phase 2] `policy` category missing from FilterChips defaultOptions
**Severity**: improvement
**File**: `src/components/news/FilterChips.tsx:15–24`
**Observation**: `NewsCategory` includes `policy` as a valid category. `ImpactCard.tsx` correctly has `policy: 'Policy'` in `categoryLabels`. But `FilterChips` `defaultOptions` doesn't include a `policy` chip — so if Claude scores a headline as `policy`, the user has no way to filter to it.
**Suggestion**: Add `{ id: 'policy', label: 'Policy' }` to `defaultOptions`, likely between `company` and `us_politics`.
**Owner action**: next phase

### [Phase 2] Phase 1 `source='live'` nit still present
**Severity**: nit
**File**: `src/pages/NewsImpact.tsx:159`
**Observation**: Same as Phase 1 note — `DataStatus` doesn't render anything visible for `source='live'`. The pattern in other pages (Portfolio, Leaderboard) passes `source='cached'` when showing session-cached data. Since `NewsImpact` always fetches live from the endpoint, passing `source` at all isn't necessary until a local caching layer is added.
**Suggestion**: Remove `source` prop for now or wait until a session-cache is introduced.
**Owner action**: optional

## Phase 3 review

### [Phase 3] `BriefingCard` shows watchlist snapshot chips but doesn't link them to `/stock/:symbol`
**Severity**: improvement
**File**: `src/components/alerts/BriefingCard.tsx:80–95`
**Observation**: The watchlist snapshot chips at the bottom of the briefing card display each ticker as a `<span>` but don't link to `/stock/:symbol`. Every ticker chip in `ImpactCard` correctly uses `<Link to="/stock/...">`. Inconsistency across the same session will feel jarring.
**Suggestion**: Wrap each ticker chip in `<Link to={\`/stock/${ticker}\`}>` the same way `ImpactCard` does.
**Owner action**: next phase

### [Phase 3] `InsiderFilingsTable` includes Accession column in desktop view — low value, takes space
**Severity**: nit
**File**: `src/components/alerts/InsiderFilingsTable.tsx:82–89`
**Observation**: The desktop table has 6 columns including "Accession". Accession numbers are technical identifiers most users won't act on directly. The mobile card view already omits it in a readable way.
**Suggestion**: Replace the Accession desktop column with a small "View filing" icon-link to `https://www.sec.gov/Archives/edgar/data/...` using the accession number, or drop it entirely and keep the 5-column layout cleaner.
**Owner action**: optional

## Phase 4 review

### [Phase 4] BriefingCard watchlist chip link (Phase 3 carry-forward)
**Severity**: improvement
**File**: `src/components/alerts/BriefingCard.tsx:80–95`
**Observation**: Still unaddressed from Phase 3 — watchlist snapshot chips are `<span>` elements, not links to `/stock/:symbol`. All other ticker chips in the app link through.
**Suggestion**: Wrap each chip in `<Link to={\`/stock/${ticker}\`}>` — a 2-line change.
**Owner action**: optional (low-effort win before launch)

### [Phase 4] No empty-state copy added to either page for "waiting on first hourly run"
**Severity**: nit
**File**: `src/pages/NewsImpact.tsx`, `src/pages/AgentAlerts.tsx`
**Observation**: Phase 4 goal included "empty-state copy when there's no flagged news / no briefing yet". Both pages currently show placeholder skeleton cards instead of a human-readable message explaining that the first hourly run hasn't happened yet. After deploy, new users will see a blank skeleton, not a reassuring "first run is scheduled" message.
**Suggestion**: When the endpoint returns `items: []` (NewsImpact) or `alert: null` (Alerts), render a short informational copy: "The first hourly scoring run hasn't completed yet. Check back in a few minutes." — replacing or augmenting the current stub cards.
**Owner action**: next phase
