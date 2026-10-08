# Tsuzuku

A self-hosted web app that shows what to watch next across **Trakt**, **Simkl** and **MyAnimeList**, and makes disagreements between them visible. Single user.

Each source keeps its own title, progress and next episode, side by side. No source is treated as correct, nothing is merged or resolved automatically, and nothing is written to a source without a per-source preview and your confirm.

## Status

Built in steps tracked as GitHub issues `step-1` to `step-7` (order in [docs/plan.md](docs/plan.md#build-order)).

| Step | What | State |
| --- | --- | --- |
| 1 | SQLite schema, token encryption, source wrapper (429 handling, throttle) | done |
| 2 | OAuth for Trakt, Simkl and MAL, with refresh | done |
| 3 | Read-only fetch of the three watching lists | done |
| 4 | Mapping: links by ID, anime season chains, Trakt search, `/mappings` | done |
| 5 | Up Next page with one column per source | done |
| 6 | Mark next episode watched, with preview and write log | next |
| 7 | Deploy with Docker Compose behind Cloudflare Access | |

What works today: connect the three sources on `/settings`, line your shows up across them on `/mappings`, and see what to watch next on `/`, with each source's own progress and any difference flagged. A difference you accept stays hidden until a source moves.

## Requirements

- **Node** `^22.21.0`, `^24.11.0` or `>=26.0.0`. Node is the runtime.
- **bun**, as package manager and script runner only. Never run the app with `bun --bun`: `better-sqlite3` is a native Node addon.
- Accounts on Trakt, Simkl and MyAnimeList, and a GitHub account (Trakt requires one to create apps).

## Setup

### 1. Install

```sh
git clone git@github.com:oowais/tsuzuku.git
cd tsuzuku
bun install
bun run test
```

`better-sqlite3` ships prebuilt binaries for common platforms, so no compiler is needed.

### 2. Register an app on each source

Each source needs its own app with a redirect URL that matches exactly. For local development:

| Source | Where | Redirect URL | Notes |
| --- | --- | --- | --- |
| Trakt | [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications) | `http://localhost:3000/api/auth/trakt/callback` | Link GitHub first. New apps use PKCE and get **no client secret**; only the Client ID is needed. The localhost warning is fine for development. Leave scopes and permissions off. |
| Simkl | [simkl.com/settings/developer](https://simkl.com/settings/developer/) | `http://localhost:3000/api/auth/simkl/callback` | Create an **AUTH V2** app of type **Server apps & services** (Client ID + secret, PKCE). The secret is shown **once**: copy it straight into `.env`. |
| MyAnimeList | [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) | `http://localhost:3000/api/auth/mal/callback` | App type **web**. Homepage `http://localhost:3000`. |

For a deployed instance, add the same paths on your own domain (`https://<your-domain>/api/auth/<source>/callback`) and set `APP_URL` to match.

### 3. Fill in `.env`

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored; never commit it.

`TOKEN_ENC_KEY` encrypts the source tokens stored in SQLite. Generate 32 random bytes in base64:

```sh
openssl rand -base64 32
```

On Windows PowerShell: `[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`

**Back this key up separately from the database.** Without it the stored tokens are unreadable and every source has to be connected again.

| Variable | Needed for |
| --- | --- |
| `TOKEN_ENC_KEY` | Always |
| `APP_URL` | OAuth redirect URLs. `http://localhost:3000` for development |
| `DATABASE_PATH` | Optional, defaults to `.data/tsuzuku.db` |
| `TRAKT_CLIENT_ID` | Trakt (there is no secret) |
| `SIMKL_CLIENT_ID`, `SIMKL_CLIENT_SECRET` | Simkl |
| `MAL_CLIENT_ID`, `MAL_CLIENT_SECRET` | MyAnimeList |
| `TMDB_API_KEY` | Not used yet (show metadata, later) |

### 4. Run and connect

```sh
bun run dev
```

Open <http://localhost:3000/settings> and connect Trakt, Simkl and MyAnimeList. Then open <http://localhost:3000/mappings> to confirm how your shows line up.

Database migrations run when the server starts. **Restart `bun run dev` after pulling changes that add a migration** (`server/db/migrations/`).

## Scripts

| Command | What |
| --- | --- |
| `bun run dev` | Dev server on port 3000 |
| `bun run test` | Unit tests (Vitest) |
| `bun run lint` | ESLint |
| `bun run typecheck` | Type check (`nuxt typecheck`) |
| `bun run db:generate` | Generate a migration after changing `server/db/schema.ts` |

CI runs lint, typecheck and tests on every push.

## How it works

- **Stack:** Nuxt 4 and Nuxt UI, SQLite in WAL mode with Drizzle, TMDB and AniList for metadata.
- **Source wrapper** (`server/lib/source-wrapper.ts`): every call to Trakt, Simkl, MAL, TMDB or AniList goes through it. It throttles per source, honours `429` / `Retry-After`, and serves the last good response marked stale when a source is blocked or failing. One failing source never blanks the page.
- **Live, not synced:** lists are fetched when you open a page. Simkl is checked through `/sync/activities` first, as its API rules require, and the lists are fetched only when something changed. There is no background sync and no job queue.
- **Mapping** (`server/lib/mapping*.ts`, `server/lib/seasons.ts`): links by shared IDs first, then AniList prequel chains for anime seasons, then title matches and search. Anything not proven by an ID waits for your confirm. Only real IDs returned by a source are stored.
- **Links:** every title, season and episode links to that source's own page.

## Docs

- [docs/decisions.md](docs/decisions.md): the locked decisions. Change one only on purpose.
- [docs/plan.md](docs/plan.md): architecture, data model, adapters, mapping, UI, auth, build order.
- [docs/context.md](docs/context.md): rejected options and why, and what is known about each API from real responses.
- [CLAUDE.md](CLAUDE.md): rules for AI-assisted work on this repo.

## Data and secrets

- The database is `.data/tsuzuku.db` (gitignored). Back it up with `sqlite3 .backup` or Litestream, not a raw copy while the app is writing.
- Source tokens are encrypted with `TOKEN_ENC_KEY`. Keep the key outside the database and back it up separately.
- Secrets are never logged. The OAuth log lines show token response field names only.
