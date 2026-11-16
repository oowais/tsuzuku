# Tsuzuku legacy (Nuxt)

The current Nuxt app: the one in production until cutover (#108, phase 5), then deleted. Shared rules, layout and docs are in the root `CLAUDE.md` and `../docs/`. Run every command below from this folder.

## Stack

Nuxt 4 (server only: `server/` and `shared/`; no Vue UI since #108 step 4.3), SQLite (WAL) with Drizzle, TMDB for shows, AniList for anime, Docker Compose, Cloudflare tunnel with Access. Tool chain is Vite+ (`vp`) only; never bun, npm/npx, ESLint or Prettier. Node is the runtime.

- Packages: `vp install`, `vp add`, `vp remove` (pnpm underneath). Commit `pnpm-lock.yaml`. Build-script approvals and overrides live in `pnpm-workspace.yaml`.
- Scripts: `vp run dev`, `vp run dev:demo`, `vp run db:generate`, `vp run check:api` (answers vs `../api/openapi.yaml`), `vp run record:fixtures` (`../api/fixtures/`). `vp dev` / `vp build` are plain Vite, not Nuxt.
- Before committing: `vp check --fix`, `vp run typecheck` (`nuxt typecheck`), `vp test run`.
- Config for fmt, lint, test and the pre-commit hook is in `vite.config.ts`. Import test helpers from `vite-plus/test`, not `vitest`.
- One-off binaries: `vp exec` (local) or `vpx` / `vp dlx`.
- Image: `docker build -f legacy/Dockerfile .` from the repository root (the build reads the commit from `.git`). It builds `../app` for web in a Flutter stage and serves it at `/` (`FLUTTER_WEB_DIR` in `nuxt.config.ts`), the API at `/api`; any other path is a 404 (`server/middleware/not-found.ts`). In dev only the API is served; run the Flutter app against it (`../app/CLAUDE.md`).
