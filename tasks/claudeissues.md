# Claude issues — review notes from Codex

> Codex writes here. Claude reads at the start of each phase.
> One entry per finding. Do **not** edit Claude's code from this file —
> Claude addresses entries in their own slice during the next phase.
>
> Severity legend:
> - **blocker** — must be fixed before the next phase starts
> - **improvement** — should be addressed in Claude's next slice
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

### [Phase 1] Agent alerts RLS does not match the app's player identity model
**Severity**: blocker
**File**: supabase_migration_news_alerts.sql:95
**Observation**: The `agent_alerts_read_own` policy allows reads when `auth.uid()::text = player_id::text`, but the existing app session/bootstrap flow maps users to `players.id` via `google_email` in `src/api/supabase.ts`, not via a documented invariant that `players.id` equals the Supabase auth user id. That creates a real risk that authenticated users will not be able to read their own alert rows once Phase 3 writes non-null `player_id` values.
**Suggestion**: Align the select policy with the existing player identity model used everywhere else in the app, or document and enforce that `agent_alerts.player_id` will always store the auth uid instead of the player row id. Without that, the Alerts UI can wire correctly and still fail at runtime for signed-in users.
**Owner action**: required before next phase

### [Phase 1] Foundation endpoints already moved beyond the stub-only contract
**Severity**: improvement
**File**: server.cjs:4967
**Observation**: The Phase 1 master plan says `/api/news/impact` and `/api/alerts/latest` should return empty-schema stubs so UI work is unblocked without depending on ingestion or DB state. The current implementation already queries `news_items` and `agent_alerts` whenever the DB is configured, which is fine functionally, but it is a contract drift from the agreed Phase 1 gating and can make the behavior differ from the handoff docs if rows exist locally.
**Suggestion**: Either update the shared plan/docs to explicitly say Phase 1 graduated from pure stubs to DB-backed reads, or keep the endpoint docs scoped so Codex/UI work does not assume stronger guarantees than the phase agreement intended.
**Owner action**: next phase

## Phase 2 review

_no entries yet_

## Phase 3 review

_no entries yet_

## Phase 4 review

_no entries yet_
