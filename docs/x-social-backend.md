# X Social Trends Backend

## Goal
Poll a curated list of X/Twitter market accounts every 8 hours, extract cashtags, store posts and symbol mentions in Supabase, and expose trend endpoints that can feed Social Trends / Reddit Trends.

## Activation
The backend is safe-by-default. It does not call X unless both are true:

- `X_BEARER_TOKEN` or `TWITTER_BEARER_TOKEN` is set in Render.
- `app_settings.twitter_enabled` is `true` in Supabase.

Optional account seed:

- `X_ACCOUNT_USERNAMES=account1,account2,account3`

Efficient list mode:

- `X_LIST_ID=1234567890`
- `X_LIST_MAX_POSTS=25`
- When `X_LIST_ID` is set, the poller reads recent posts from that X List instead of calling each user timeline.
- The poller stores `x_list_since_id_<listId>` in `app_settings`, so later runs request only posts newer than the last successful list read.

Preferred account source:

- Insert curated accounts into `public.x_accounts`.
- Use `enabled=true` and higher `priority` for the most important accounts.
- The migration seeds analyst/trader-only accounts. News feeds and headline/data accounts are intentionally excluded.
- Admins can manage the list in the app at `/admin` under "X Analyst Accounts".

## Supabase
Run `supabase_migration_x_social.sql` in the Supabase SQL editor. It includes:

- `x_accounts`
- `x_posts`
- `x_symbol_mentions`
- `app_settings.twitter_poll_interval_hours`

## Endpoints
`GET /api/x-social/trends?hours=24&limit=100`

Returns symbol mention counts, previous-window comparison, mention change %, unique accounts, engagement score, and latest post time.

`POST /api/x-social/run-now?force=1`

Admin-only endpoint to manually trigger a poll. Requires `x-admin-email` header matching `VITE_ADMIN_EMAILS`. `force=1` bypasses the `twitter_enabled` flag but still requires `X_BEARER_TOKEN`.

`GET /api/x-social/accounts`

Admin-only endpoint for the account manager.

`POST /api/x-social/accounts`

Admin-only endpoint to add or update an analyst account. Accepts `username`, optional `displayName`, `priority`, `notes`, and `enabled`.

`PATCH /api/x-social/accounts/:username`

Admin-only endpoint to toggle or update an analyst account.

`DELETE /api/x-social/accounts/:username`

Admin-only endpoint to remove an analyst account.

## Poll Cadence
The server schedules `x-social` every 8 hours through the existing background scheduler.

The poller:

- Resolves usernames to X user ids.
- Pulls recent original posts from each account.
- Extracts cashtags only, e.g. `$NVDA`, `$LULU`, `$SHOP`.
- Stores posts and symbol mentions.
- Computes trends from stored mentions, so 24h and 7d spikes become more useful after history accumulates.

## Notes
This intentionally avoids broad X search. A curated account basket keeps cost and noise under control.
