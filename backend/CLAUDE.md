# Tsuzuku backend (Nitro server)

The server: the API and the Flutter web build, plain Nitro (Nuxt until #108 step 4.4; decision #27). Shared rules, layout and docs are in the root `CLAUDE.md` and `../docs/`. Run every command below from this folder.

## Stack

Nitro 2 (`nitropack`, config in `nitro.config.ts`; routes, middleware, plugins and tasks scanned from `server/`, plus `shared/`; no UI of its own), SQLite (WAL) with Drizzle, TMDB for shows, AniList for anime, Docker Compose, Cloudflare tunnel with Access. Tool chain is Vite+ (`vp`) only; never bun, npm/npx, ESLint or Prettier. Node is the runtime.

- Packages: `vp install`, `vp add`, `vp remove` (pnpm underneath). Commit `pnpm-lock.yaml`. Build-script approvals and overrides live in `pnpm-workspace.yaml`.
- Scripts: `vp run dev`, `vp run dev:demo`, `vp run db:generate`, `vp run check:api` (answers vs `../api/openapi.yaml`), `vp run record:fixtures` (`../api/fixtures/`). `vp dev` / `vp build` are plain Vite, not Nitro; the server builds with `vp run build` (`nitropack build`, output in `.output/`).
- Before committing: `vp check --fix`, `vp run typecheck` (`tsc --noEmit` over the generated `.nitro/types`, written by the postinstall `nitropack prepare`), `vp test run`.
- Config for fmt, lint, test and the pre-commit hook is in `vite.config.ts`. Import test helpers from `vite-plus/test`, not `vitest`.
- One-off binaries: `vp exec` (local) or `vpx` / `vp dlx`.
- Image: `docker build -f backend/Dockerfile .` from the repository root (the build reads the commit from `.git`). It builds `../app` for web in a Flutter stage and serves it at `/` (`FLUTTER_WEB_DIR` in `nitro.config.ts`), the API at `/api`; any other path is a 404 (`server/middleware/not-found.ts`). In dev only the API is served; run the Flutter app against it (`../app/CLAUDE.md`).
