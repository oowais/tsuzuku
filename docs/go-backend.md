# Go backend (parked)

Parked 2026-11-16 (decision #27, [`docs/decisions.md`](decisions.md)); not scheduled. The why is in decision #27 and [`docs/context.md`](context.md). If picked up, it must reproduce the golden fixtures in [`api/fixtures/`](../api/fixtures/) against [`api/openapi.yaml`](../api/openapi.yaml).

The original phase 4 of #108, moved here from the issue so it lives with the code. Steps are numbered G.1-G.8 so they don't clash with #108's real phase 4. Language chosen: Go (over Rust: `oapi-codegen` from `api/openapi.yaml`, standard library crypto/HTTP, pure-Go SQLite, smaller image and RAM).

## G.1 Database and crypto
- Open the existing SQLite file (WAL). Take over the current schema as-is, including Drizzle's migrations table; new migrations follow the latest one in `backend/server/db/migrations/` and stay additive while the Nitro server (`backend/`) may still be switched back to.
- AES-256-GCM tokens in the existing format `v1.<iv>.<tag>.<ct>` (base64url), key from `TOKEN_ENC_KEY` (32 bytes base64). Test: decrypt values written by the Nitro server, and the Nitro server decrypts values written by the Go backend.
- Read the JSON stored in columns (`fetch_cache`, write log items, mappings) in the shapes the Nitro server writes.

## G.2 Source wrapper
- Status per source, 429 handling with `blocked_until`, throttle, write bucket, `fetch_cache` with stale fallback, 404-as-answer, exactly as `backend/server/lib/source-wrapper.ts`.
- Parallel calls with a per-source concurrency limit; batch AniList lookups by MAL IDs.
- Per-call timing in logs (no secrets) and `Server-Timing` headers.

## G.3 Adapters
- Trakt (incl. public), Simkl, MAL, TMDB, AniList; parsing checked against the recorded responses.

## G.4 Read endpoints
- Up Next, Movies, Calendar, Stats, Coming back, Write log, Mappings, sources status/watching, search endpoints.
- Cache first: each read can answer from cache at once (`?cached=1` or equivalent in the contract) and the client then asks for live. Client-driven, no background job.
- Same output as the Nitro server for the golden fixtures.

## G.5 Writes
- Every preview/confirm pair; confirm re-reads the lists; writes logged to the write log as today.

## G.6 Auth, backups, the rest
- OAuth start/callback on the same paths (`/api/auth/<source>/callback`, built from `APP_URL`), PKCE for Trakt, secrets for Simkl and MAL, `oauth_states` table.
- Access check (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`), off when unset for local dev.
- Backups: list, create, download, nightly backup.
- Health and version (commit) endpoint.
- Demo mode with fake sources and a separate DB, for development and app screenshots.
- Same env vars as `.env.example` so the existing `.env` works unchanged.

## G.7 Serve the web build and package
- Backend serves the Flutter web build as static files at `/`, API at `/api`.
- One image, one compose service, same volume (`/data`), same tunnel route. Image size and start time noted.
- CI builds and publishes the image (path filters on `backend/`, `app/`, `api/`).

## G.8 Golden tests
- Ported logic tests plus fixture comparisons: recorded source responses in, same API output as the Nitro server out.
