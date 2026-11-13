# Tsuzuku

Self-hosted app that shows what to watch next across Trakt, Simkl and MyAnimeList, and makes disagreements between them visible. Single user.

## Layout

Being rewritten (#108): a Flutter app and a new backend behind one API contract replace the Nuxt app.

- `legacy/`: the current Nuxt app, deployed until cutover, then deleted. Its own `CLAUDE.md` and tooling (`vp` only).
- `docs/`: decisions, plan, context (shared).
- `compose.yaml`: the deployment (pulls `ghcr.io/oowais/tsuzuku`, built from `legacy/Dockerfile` with the repository root as context).
- Coming in later steps of #108: `api/` (`openapi.yaml`, the contract), `app/` (Flutter), `backend/` (new server), each with its own `CLAUDE.md` and tooling.

Work inside the subproject's folder and follow its `CLAUDE.md`. CI jobs use path filters.

## Read first

- `docs/decisions.md`: the locked decisions. Change one only on purpose, and update the file when you do.
- `docs/plan.md`: architecture, data model, adapters, mapping, UI, auth, scaffold, build order.
- `docs/context.md`: rejected options and why, what is known about the APIs, environment. Read before proposing alternatives.
- Work is tracked in the GitHub project "Tsuzuku". `verify` issues are API questions to answer from real responses; `later` is out of scope.

## Rules that matter (all code, old and new)

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
- Current work: #108, phases and steps in order; one step per session or PR. Tick its checklist as you go.
