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
| 6 | Mark next episode watched, with preview and write log | done |
| 7 | Deploy with Docker Compose behind Cloudflare Access | done |

What works today: connect the three sources on `/settings`, line your shows up across them on `/mappings`, and see what to watch next on `/`, with each source's own progress and any difference flagged. A difference you accept stays hidden until a source moves. Mark the next episode watched from there, with a preview per source; every write is listed on `/log`.

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

## Demo mode

To try the UI without real accounts, or to check a change on every case:

```sh
bun run dev:demo
```

- Fictional shows and anime (`server/demo/fixtures.ts`), answered by a fake Trakt, Simkl, MAL and AniList inside the dev server (`server/demo/fake-sources.ts`). The real adapters, parsing and mapping run; nothing leaves the machine.
- A separate database, `.data/demo.db`, filled on first start: links, a proposal waiting on `/mappings`, an accepted difference and a write log. No token is stored, and connecting a source is off.
- Every Up Next case appears: all sources agree, differs, accepted, caught up, not on a list, not linked, Trakt season not set, only on Trakt, an OVA, and an episode that airs in a few days.
- Marking watched works: the fake sources apply it, so the row moves on. They start over when the server restarts.
- `DEMO_FAIL=mal bun run dev:demo` (or `simkl`, `trakt`, comma-separated) makes those sources answer with a rate limit, to see "blocked" and stale data.
- To start over, delete `.data/demo.db`. Demo mode refuses to run with `NODE_ENV=production`, which the Docker image sets.

## Deploy (Docker Compose behind Cloudflare Access)

One container on a home server, reachable only through an existing Cloudflare tunnel whose `cloudflared` runs in its own container. Tsuzuku joins that container's Docker network and publishes no port.

### 1. Server

```sh
git clone https://github.com/oowais/tsuzuku.git
cd tsuzuku
cp .env.example .env
mkdir data
```

Fill in `.env` as in setup step 3, with:

- `APP_URL=https://tsuzuku.<your-domain>`
- `TUNNEL_NETWORK=<network>`: a Docker network shared with cloudflared. Give Tsuzuku one of its own and let cloudflared join it, so Tsuzuku sees no other app's containers:
  1. `docker network create tsuzuku`, and set `TUNNEL_NETWORK=tsuzuku`.
  2. In cloudflared's compose file, add `tsuzuku` to the service's `networks` and declare it at the bottom as `tsuzuku: {external: true}`, then `docker compose up -d` there (the tunnel drops for a few seconds).
  3. Check: `docker inspect <cloudflared container> --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}'` lists `tsuzuku`.
- The same `TOKEN_ENC_KEY` as your local `.env` if you bring your database along (step 2).

The container runs as user `node` (uid 1000). If your user on the server has another uid, run `sudo chown 1000:1000 data`.

### 2. Bring your database (optional)

It keeps your links, rejected matches, accepted differences, the write log and the source connections. On your dev machine, with or without the dev server running:

```sh
sqlite3 .data/tsuzuku.db ".backup tsuzuku-copy.db"
scp tsuzuku-copy.db <server>:tsuzuku/data/tsuzuku.db
```

Afterwards stop using those connections locally: stop `bun run dev` and move `.data/` aside (`mv .data .data-before-deploy`). There is no disconnect button, and both copies hold the same tokens: Trakt and MAL issue a new refresh token on every refresh, so whichever copy refreshes second is locked out. Connect sources fresh in dev if you need them there; that creates separate tokens.

### 3. Start

```sh
docker compose up -d --build
docker compose ps
```

`ps` shows `healthy` once the server answers. Migrations run at startup. To update later: `git pull`, then the same `up -d --build`.

### 4. Cloudflare

In the Zero Trust dashboard:

1. **Networks → Tunnels → your tunnel → Public hostname:** `tsuzuku.<your-domain>`, service `http://tsuzuku:3000`.
2. **Access → Applications → Add → Self-hosted:** the same hostname. Policy **Allow**, rule **Emails** = your email. Login method: one-time PIN.
3. **Optional, TOTP on top of the PIN:** in **Access settings**, allow MFA with **Authenticator application**. Enable the **App Launcher** (same policy), open `https://<team>.cloudflareaccess.com` and enroll your authenticator. Then on the app: **Login methods → MFA → Customize MFA settings**, authenticator application, 24 hours. A long app session (for example `8760h`) then means the PIN is rare and TOTP is the daily check.

4. **The app checks Access too.** Copy the application's **Overview → Application Audience (AUD) Tag** into the server's `.env` as `CF_ACCESS_AUD`, and your team domain (**Settings → Team name and domain**, `<team>.cloudflareaccess.com`) as `CF_ACCESS_TEAM_DOMAIN`. Without both, the container will not start; with them, any request that did not come through Access gets a 403 (logged as `[access] Refused …`).

Open `https://tsuzuku.<your-domain>`: Cloudflare asks for the PIN first, then the app loads.

### 5. Source apps

Add the production redirect URLs next to the local ones, on each source's app page:

- `https://tsuzuku.<your-domain>/api/auth/trakt/callback`
- `https://tsuzuku.<your-domain>/api/auth/simkl/callback`
- `https://tsuzuku.<your-domain>/api/auth/mal/callback`

If a source's form takes only one redirect URL, create a second app for production, put its ID and secret in the server's `.env`, and connect that source again on `/settings`.

### 6. Backups

**In the app:** Settings → Backups → **Back up now** makes a copy with SQLite's online backup, safe while the app runs, into `data/backups/`, keeps the newest 14, and lists them with a **Download** button, which is the easy way to get a copy off the machine. Only names in that list are served.

**From the shell:** `scripts/backup.mjs` makes the same copy:

```sh
docker compose exec -T tsuzuku node scripts/backup.mjs
```

Copy `data/backups/` off the machine now and then. Keep `TOKEN_ENC_KEY` in your password manager, never next to the backups: a backup without the key still has your links and log, but the source connections have to be made again.

To run it on a schedule instead, a systemd service with `WorkingDirectory=` set to the clone and `ExecStart=/usr/bin/docker compose exec -T tsuzuku node scripts/backup.mjs`, plus a timer, does it.

**Quick check without the tunnel:** uncomment the `ports` lines in `compose.yaml` (`127.0.0.1:3000:3000`), run `up -d`, and open `http://localhost:3000` on the server. If cloudflared runs on the host instead of in a container, use that and point the tunnel at `http://localhost:3000`.

## Scripts

| Command | What |
| --- | --- |
| `bun run dev` | Dev server on port 3000 |
| `bun run dev:demo` | Dev server in demo mode: fictional shows, fake sources, no accounts needed |
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
