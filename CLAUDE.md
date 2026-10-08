# Tsuzuku

Self-hosted web app that shows what to watch next across Trakt, Simkl and MyAnimeList, and makes disagreements between them visible. Single user.

## Read first

- `docs/decisions.md`: the locked decisions. Change one only on purpose, and update the file when you do.
- `docs/plan.md`: architecture, data model, adapters, mapping, UI, auth, scaffold, build order.
- `docs/context.md`: rejected options and why, what is known about the APIs, environment. Read before proposing alternatives.
- Work is tracked in the GitHub project "Tsuzuku". Issues `step-1` to `step-7` are the build order; `verify` issues are API questions to answer from real responses; `later` is out of scope.

## Rules that matter

- Never write to Trakt, Simkl or MAL without a per-source preview and an explicit user confirm. No automatic conflict resolution, no bulk catch-up, no background sync or job queue.
- Show disagreements, never resolve them. No cross-source "next episode".
- Every table has `user_id`.
- All source calls go through the source wrapper (status, 429 handling with `blocked_until`, throttle). One failing source never blanks the page.
- Tokens are encrypted in SQLite with a key from the environment. Never log or commit secrets; `.env` is never committed.
- Mapping: AI or ranking only ever picks among real candidates; never generate IDs. Uncertain links need user confirmation.
- Verify API shapes against real responses before relying on them. Do not guess endpoint fields.

## Stack

Nuxt 4, Nuxt UI (`@nuxt/ui`, wrapped in `UApp`), SQLite (WAL) with Drizzle, TMDB for shows, AniList for anime, Docker Compose, Cloudflare tunnel with Access. Use bun as package manager and script runner (`bun add`, `bun run dev`, `bunx`), but Node as the runtime: never `bun --bun` or `bunx --bun`, never `Bun.*` APIs (`better-sqlite3` is a native Node addon). Commit `bun.lock`.

## Working conventions

- Shell depends on the machine: PowerShell on Windows, fish on CachyOS (`set -x VAR value`, `and` / `or`). Never bash syntax.
- When editing files from a terminal, use `fresh`. Never suggest vim, vi or visudo.
- Keep answers terse and practical.
- Start from the open `step-N` issue and tick its checklist as you go.
