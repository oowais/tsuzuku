# Tsuzuku legacy (Nuxt)

The current Nuxt app: the one in production until cutover (#108, phase 5), then deleted. Shared rules, layout and docs are in the root `CLAUDE.md` and `../docs/`. Run every command below from this folder.

## Stack

Nuxt 4, Nuxt UI (`@nuxt/ui`, wrapped in `UApp`), SQLite (WAL) with Drizzle, TMDB for shows, AniList for anime, Docker Compose, Cloudflare tunnel with Access. Tool chain is Vite+ (`vp`) only; never bun, npm/npx, ESLint or Prettier. Node is the runtime.

- Packages: `vp install`, `vp add`, `vp remove` (pnpm underneath). Commit `pnpm-lock.yaml`. Build-script approvals and overrides live in `pnpm-workspace.yaml`.
- Scripts: `vp run dev`, `vp run dev:demo`, `vp run db:generate`. `vp dev` / `vp build` are plain Vite, not Nuxt.
- Before committing: `vp check --fix`, `vp run typecheck` (Vue templates; `vp check` skips .vue types), `vp test run`.
- Config for fmt, lint, test and the pre-commit hook is in `vite.config.ts`. Import test helpers from `vite-plus/test`, not `vitest`.
- One-off binaries: `vp exec` (local) or `vpx` / `vp dlx`.
- Image: `docker build -f legacy/Dockerfile .` from the repository root (the build reads the commit from `.git`).
