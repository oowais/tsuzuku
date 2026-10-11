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

Nuxt 4, Nuxt UI (`@nuxt/ui`, wrapped in `UApp`), SQLite (WAL) with Drizzle, TMDB for shows, AniList for anime, Docker Compose, Cloudflare tunnel with Access. Tool chain is Vite+ (`vp`) only; never bun, npm/npx, ESLint or Prettier. Node is the runtime.

- Packages: `vp install`, `vp add`, `vp remove` (pnpm underneath). Commit `pnpm-lock.yaml`. Build-script approvals and overrides live in `pnpm-workspace.yaml`.
- Scripts: `vp run dev`, `vp run dev:demo`, `vp run db:generate`. `vp dev` / `vp build` are plain Vite, not Nuxt.
- Before committing: `vp check --fix`, `vp run typecheck` (Vue templates; `vp check` skips .vue types), `vp test run`.
- Config for fmt, lint, test and the pre-commit hook is in `vite.config.ts`. Import test helpers from `vite-plus/test`, not `vitest`.
- One-off binaries: `vp exec` (local) or `vpx` / `vp dlx`.

## Working conventions

- Shell depends on the machine: PowerShell on Windows, fish on CachyOS (`set -x VAR value`, `and` / `or`). Never bash syntax.
- When editing files from a terminal, use `fresh`. Never suggest vim, vi or visudo.
- Keep answers terse and practical.
- Start from the open `step-N` issue and tick its checklist as you go.
