# Golden fixtures

The reference the server reproduces (#108, step 2.2): source responses in, API output out. Recorded from the server (`backend/`) in demo mode, so every source response is a demo fake (fictional shows, no tokens, no personal data). A future backend in place of it (the Go backend, parked by decision #27; plan in #108, "Later: Go backend", step G.8) would replay the source responses and have to give the same answers.

## Layout

```
api/fixtures/
  <scenario>/
    scenario.json        the clock (`now`, frozen), time zone, sources that answer 429 on every call
    seed.json            every table's rows before the first case (what the demo seed writes)
    cases/
      NNN-<operationId>[-<status>]/
        request.json     method, URL (path + query), JSON body or null
        sources.json     the source calls the server made during this request, in order:
                         { request: { method, url, body }, response: { status, headers, body } }
        response.json    status, content type, `location` for redirects, JSON body (null for other bodies)
```

Scenarios:

- `demo`: every source answers. All 42 operations the contract check reaches, writes included (`check-api.mjs --writes`).
- `demo-blocked`: Simkl and MAL answer 429 (`retry-after: 300`) on every call. Reads and previews, no writes; the answers show stale cached data and the blocked state.

Cases run in order and share state: a write changes what later reads return, and a source answer cached by one case (`fetch_cache`, `metadata_cache`) is not fetched again by the next. So `sources.json` lists only the calls a case actually made, not everything it reads.

## Replaying (phase 4)

1. Start from an empty database, insert `seed.json`, set the clock to `scenario.json`'s `now`. The clock stands still; it moves only when the server waits (the throttle), by the time waited.
2. Answer source calls from the recorded responses: match on method, URL and body, and for a repeated call take the next unused answer, in recorded order (a list read after a write answers differently).
3. Send each case's request in order and compare with `response.json`.

Values written `"<wall-clock>"` were stamped by the real clock, not the fixed one (SQLite `unixepoch()` column defaults, backup file times): accept any date there. The bodies of `getBackupsName` (a SQLite file) are not compared, only status and content type.

## Recording

From `backend/`:

```sh
vp run record:fixtures
```

For each scenario it starts its own demo server on port 3100 (fixed clock from `scripts/fixed-clock.mjs`, fresh database and backup folder in a temp directory, `DEMO_RECORD` logging every fake source answer), dumps the seeded database, and runs `scripts/check-api.mjs --record`, which also validates every answer against `api/openapi.yaml`. Two runs give identical files. Re-record when the server's behaviour or the demo fakes change on purpose, and review the diff.

Real source responses are not recorded yet: the demo fakes cover every call the adapters make. If the Go backend is picked up, its adapter parsing gets checked against real responses (step G.3); sanitized real responses (no tokens, no personal IDs beyond what's needed) can join as their own scenario then.

## Server tests (`backend/test/`)

Listed in step 2.2, when there were 29 files; four UI-only ones went with the Vue UI in step 4.3. Pure logic a future Go backend would port (step G.8), with the module it covers in `backend/server/`:

| Test              | Covers                                      | Notes                                                                   |
| ----------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| `access`          | `lib/access`                                | Cloudflare Access JWT check                                             |
| `adapters`        | `adapters/*`                                | Trakt, Trakt public, Simkl, MAL, AniList parsing and calls; uses the DB |
| `backup`          | `lib/backup`                                | copy, keep newest, serve only listed names, demo apart                  |
| `calendar`        | `lib/calendar`, `lib/calendar-service`      |                                                                         |
| `coming-back`     | `lib/coming-back`                           |                                                                         |
| `crypto`          | `lib/crypto`                                | token format `v1.<iv>.<tag>.<ct>`                                       |
| `db`              | `db`, `lib/accepted-store`, `lib/write-log` | WAL, `user_id` on every table, stores                                   |
| `diff-reasons`    | `lib/diff-reasons`                          |                                                                         |
| `entries`         | `lib/entries`, `lib/mapping`                |                                                                         |
| `mark-watched`    | `lib/mark-watched`                          |                                                                         |
| `movie-add`       | `lib/movie-add`, `adapters/tmdb`            | uses the DB                                                             |
| `movie-mark`      | `lib/movie-mark`                            |                                                                         |
| `movies`          | `lib/movies`, `lib/movie-links`             |                                                                         |
| `next-season`     | `lib/next-season`                           |                                                                         |
| `oauth`           | `lib/oauth`                                 | PKCE, refresh, states; uses the DB                                      |
| `seasons`         | `lib/seasons`, `lib/mapping-store`          | uses the DB                                                             |
| `source-wrapper`  | `lib/source-wrapper`                        | status, 429 `blocked_until`, throttle, cache                            |
| `stats` (readers) | `lib/stats`                                 | the "history figures" part is app logic, below                          |
| `upcoming`        | `adapters/anilist`, `adapters/trakt-public` | next airing                                                             |
| `up-next`         | `lib/up-next`                               |                                                                         |
| `version`         | `lib/version`                               | commit from `.git`; a Go backend may take it at build time instead      |
| `write-log-links` | `lib/write-log`                             |                                                                         |

Pure logic of the Vue UI, ported to the Flutter app in phase 3. `formats` and `source-links` still run in `backend/test/` (the server uses those modules); the others were removed with the Vue UI in step 4.3:

| Test                      | Covers                          |
| ------------------------- | ------------------------------- |
| `coming-back-match`       | `app/composables/useComingBack` |
| `formats`                 | `shared/utils/formats`          |
| `log-groups`              | `shared/utils/log-groups`       |
| `source-links`            | `shared/utils/source-links`     |
| `stats` (history figures) | `app/utils/history`             |
| `time`                    | `app/utils/time`                |
| `up-next-filter`          | `shared/utils/up-next-filter`   |

Server only, not ported:

| Test   | Why                                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------------------- |
| `demo` | keeps the demo fakes in step with the server's code; the golden fixtures would take that role for a Go backend |
