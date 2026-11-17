# Tsuzuku

Self-hosted app that shows what to watch next across Trakt, Simkl and MyAnimeList, and makes disagreements between them visible. Single user.

## Layout

A Flutter app (the only UI) and a plain Nitro server, behind one API contract (#108; decision #27). The Vue UI was removed in #108; its last commit is `7789437`. A Go backend is parked (decision #27).

- `api/`: `openapi.yaml`, the contract (`apiVersion` = `info.version`, bumped only on breaking changes), and `fixtures/`, the golden fixtures the server reproduces (and a future Go backend would have to).
- `app/`: the Flutter app (Android, Windows, Linux, web), app id `com.owaisahmed.tsuzuku`. Its own `CLAUDE.md` and tooling (`flutter` only); its API client is generated from `api/openapi.yaml`.
- `backend/`: the server, plain Nitro: the API and the Flutter web build at `/`, one image. Its own `CLAUDE.md` and tooling (`vp` only).
- `docs/`: decisions, plan, context, the parked Go backend plan (`go-backend.md`) (shared).
- `compose.yaml`: the deployment (pulls `ghcr.io/oowais/tsuzuku`, built from `backend/Dockerfile` with the repository root as context).
- `.github/workflows/`: `ci.yml`, `app.yml`, `app-release.yml` (app releases on `app-vX.Y.Z` tags).

Work inside the subproject's folder and follow its `CLAUDE.md`. CI jobs use path filters (`ci.yml` for the backend, the contract and the image, which includes the web build; `app.yml` for the app). A change to `api/openapi.yaml` also means regenerating the app's client (`app/CLAUDE.md`).

## Read first

- `docs/decisions.md`: the locked decisions. Change one only on purpose, and update the file when you do.
- `docs/plan.md`: architecture, data model, adapters, mapping, UI, the apps, the server.
- `docs/context.md`: rejected and parked options and why, what is known about the APIs. Read before proposing alternatives.
- Work is tracked in the GitHub project "Tsuzuku". `verify` issues are API questions to answer from real responses; `later` is out of scope.

## Rules that matter (all code)

- Never write to Trakt, Simkl or MAL without a per-source preview and an explicit user confirm. No automatic conflict resolution, no bulk catch-up, no background sync or job queue.
- Show disagreements, never resolve them. No cross-source "next episode".
- Every table has `user_id`.
- All source calls go through the source wrapper (status, 429 handling with `blocked_until`, throttle). One failing source never blanks the page.
- Tokens are encrypted in SQLite with a key from the environment. Never log or commit secrets; `.env` is never committed.
- Mapping: AI or ranking only ever picks among real candidates; never generate IDs. Uncertain links need user confirmation.
- Verify API shapes against real responses before relying on them. Do not guess endpoint fields.

## Working conventions

- Shell depends on the machine: PowerShell on Windows, fish on CachyOS (`set -x VAR value`, `and` / `or`). Never bash syntax.
- When editing files from a terminal, use `fresh`. Never suggest vim, vi or visudo.
- Keep answers terse and practical.
- #108 (the Flutter rewrite) is done through phase 6 (one 3.3 item still open); the parked Go backend plan is in `docs/go-backend.md`.
