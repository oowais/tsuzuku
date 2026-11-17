# Tsuzuku

A self-hosted app that shows what to watch next across **Trakt**, **Simkl** and **MyAnimeList**, and makes disagreements between them visible. Single user.

Each source keeps its own title, progress and next episode, side by side. No source is treated as correct, nothing is merged or resolved automatically, and nothing is written to a source without a per-source preview and your confirm.

## Layout

| Path                 | What                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `app/`               | The Flutter app, the only UI: Android, Windows, Linux and a web build. Tooling: `flutter`. See [app/CLAUDE.md](app/CLAUDE.md).   |
| `backend/`           | The server: plain Nitro, the API and the web build, one Docker image. Tooling: `vp`. See [backend/CLAUDE.md](backend/CLAUDE.md). |
| `api/openapi.yaml`   | The API contract between them; the app's client is generated from it, and CI checks the server's answers against it.             |
| `api/fixtures/`      | Golden fixtures: recorded source responses in, the server's answers out.                                                         |
| `docs/`              | Decisions, plan and context.                                                                                                     |
| `compose.yaml`       | The deployment.                                                                                                                  |
| `.github/workflows/` | `ci.yml` (server, contract, image), `app.yml` (app checks), `app-release.yml` (app releases).                                    |

What works: connect the three sources in Settings, line your shows up across them in Mappings, and see what to watch next on Shows, with each source's own progress and any difference flagged. Movies, Calendar, Stats and the write log sit next to it. Every write (mark watched, start a season, add a movie or an anime) shows a preview per source and waits for your confirm.

The Flutter app replaced a Vue UI in #108; the last commit with the Vue UI is `7789437`.

## Requirements

- Server: **Node** `^22.21.0`, `^24.11.0` or `>=26.0.0` as the runtime, and **[Vite+](https://viteplus.dev)** (`vp`) as the only tool chain: it picks the Node version, runs pnpm, and formats, lints, type checks and tests. Install it with `curl -fsSL https://vite.plus | bash`.
- App: **Flutter** (stable; CI pins the version in `.github/workflows/app.yml`).
- Accounts on Trakt, Simkl and MyAnimeList, and a GitHub account (Trakt requires one to create apps).

## Setup

### 1. Install

```sh
git clone git@github.com:oowais/tsuzuku.git
cd tsuzuku/backend
vp install
vp test run
```

`better-sqlite3` ships prebuilt binaries for common platforms, so no compiler is needed.

### 2. Register an app on each source

Each source needs its own app with a redirect URL that matches exactly. For local development:

| Source      | Where                                                                 | Redirect URL                                    | Notes                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trakt       | [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications)    | `http://localhost:3000/api/auth/trakt/callback` | Link GitHub first. New apps use PKCE and get **no client secret**; only the Client ID is needed. The localhost warning is fine for development. Leave scopes and permissions off. |
| Simkl       | [simkl.com/settings/developer](https://simkl.com/settings/developer/) | `http://localhost:3000/api/auth/simkl/callback` | Create an **AUTH V2** app of type **Server apps & services** (Client ID + secret, PKCE). The secret is shown **once**: copy it straight into `.env`.                              |
| MyAnimeList | [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig)        | `http://localhost:3000/api/auth/mal/callback`   | App type **web**. Homepage `http://localhost:3000`.                                                                                                                               |

For a deployed instance, add the same paths on your own domain (`https://<your-domain>/api/auth/<source>/callback`) and set `APP_URL` to match.

### 3. Fill in `.env`

Copy `backend/.env.example` to `backend/.env` and fill it in. `.env` is gitignored; never commit it.

`TOKEN_ENC_KEY` encrypts the source tokens stored in SQLite. Generate 32 random bytes in base64:

```sh
openssl rand -base64 32
```

On Windows PowerShell: `[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`

**Back this key up separately from the database.** Without it the stored tokens are unreadable and every source has to be connected again.

| Variable                                 | Needed for                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `TOKEN_ENC_KEY`                          | Always                                                                                                            |
| `APP_URL`                                | OAuth redirect URLs. `http://localhost:3000` for development                                                      |
| `DATABASE_PATH`                          | Optional, defaults to `.data/tsuzuku.db`                                                                          |
| `TRAKT_CLIENT_ID`                        | Trakt (there is no secret)                                                                                        |
| `SIMKL_CLIENT_ID`, `SIMKL_CLIENT_SECRET` | Simkl                                                                                                             |
| `MAL_CLIENT_ID`, `MAL_CLIENT_SECRET`     | MyAnimeList                                                                                                       |
| `TMDB_API_KEY`                           | Movie search on the Movies page (TMDB API key or read access token); without it only anime movies can be searched |

### 4. Run and connect

```sh
vp run dev
```

The dev server serves the API only; the UI is the Flutter app in `app/`. Run it against the dev server (`app/CLAUDE.md`), then connect Trakt, Simkl and MyAnimeList in Settings and confirm how your shows line up in Mappings.

Database migrations run when the server starts. **Restart `vp run dev` after pulling changes that add a migration** (`backend/server/db/migrations/`).

## Demo mode

To try the app without real accounts, or to check a change on every case (from `backend/`):

```sh
vp run dev:demo
```

- Fictional shows and anime (`backend/server/demo/fixtures.ts`), answered by a fake Trakt, Simkl, MAL and AniList inside the dev server (`backend/server/demo/fake-sources.ts`). The real adapters, parsing and mapping run; nothing leaves the machine.
- A separate database, `.data/demo.db`, filled on first start: links, a proposal waiting in Mappings, an accepted difference and a write log. No token is stored, and connecting a source is off.
- Every Up Next case appears: all sources agree, differs, accepted, caught up, not on a list, not linked, Trakt season not set, only on Trakt, an OVA, and an episode that airs in a few days.
- Marking watched works: the fake sources apply it, so the row moves on. They start over when the server restarts.
- `DEMO_FAIL=mal vp run dev:demo` (or `simkl`, `trakt`, comma-separated) makes those sources answer with a rate limit, to see "blocked" and stale data.
- Point the app at it with `--dart-define=TSUZUKU_DEV_SERVER=http://localhost:3000` (`app/CLAUDE.md`).
- To start over, delete `.data/demo.db`. Demo mode refuses to run with `NODE_ENV=production`, which the Docker image sets.

## Deploy (Docker Compose behind Cloudflare Access)

One container on a home server, serving the API and the Flutter web build, reachable only through an existing Cloudflare tunnel whose `cloudflared` runs in its own container. Tsuzuku joins that container's Docker network and publishes no port.

### 1. Server

```sh
git clone https://github.com/oowais/tsuzuku.git
cd tsuzuku
cp backend/.env.example .env
mkdir data
```

Fill in `.env` as in setup step 3 (every variable is described in `backend/.env.example`), with:

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

Afterwards stop using those connections locally: stop `vp run dev` and move `.data/` aside (`mv .data .data-before-deploy`). There is no disconnect button, and both copies hold the same tokens: Trakt and MAL issue a new refresh token on every refresh, so whichever copy refreshes second is locked out. Connect sources fresh in dev if you need them there; that creates separate tokens.

### 3. Start

CI builds the image on every push to `main` that touches `backend/`, `api/` or `app/`, and publishes it to GHCR as a private package, `ghcr.io/oowais/tsuzuku`, tagged `latest` and with the short commit; it keeps the newest 10. The image builds the Flutter web build from `app/` at the same commit and serves it at `/`. The server pulls the image; nothing is built there, and nothing pulls by itself (no Watchtower). The first publish takes the repository's visibility, so after it open the package's settings (your profile → Packages → tsuzuku) and set it to **Private**; later pushes keep that.

Once per server, log in with a **classic** personal access token (GHCR does not take fine-grained ones) that has only the `read:packages` scope: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic). Paste it at the password prompt:

```sh
docker login ghcr.io -u oowais
```

Then:

```sh
docker compose pull
docker compose up -d
docker compose ps
```

`ps` shows `healthy` once the server answers. Migrations run at startup.

**Update:** `git pull` (for changes to `compose.yaml`), then the same `pull` and `up -d`.

**Roll back:** set `image:` in `compose.yaml` to an earlier commit tag, such as `ghcr.io/oowais/tsuzuku:70b9070`, then `docker compose up -d`. Only the newest 10 tags exist. If newer commits added a migration (`backend/server/db/migrations/`), take a backup before going back.

When the token expires, `pull` fails with `unauthorized`: make a new one and log in again.

### 4. Cloudflare

In the Zero Trust dashboard:

1. **Networks → Tunnels → your tunnel → Public hostname:** `tsuzuku.<your-domain>`, service `http://tsuzuku:3000`.
2. **Access → Applications → Add → Self-hosted:** the same hostname. Policy **Allow**, rule **Emails** = your email. Login method: one-time PIN.
3. **Optional, TOTP on top of the PIN:** in **Access settings**, allow MFA with **Authenticator application**. Enable the **App Launcher** (same policy), open `https://<team>.cloudflareaccess.com` and enroll your authenticator. Then on the app: **Login methods → MFA → Customize MFA settings**, authenticator application, 24 hours. A long app session (for example `8760h`) then means the PIN is rare and TOTP is the daily check.

4. **The app checks Access too.** Copy the application's **Overview → Application Audience (AUD) Tag** into the server's `.env` as `CF_ACCESS_AUD`, and your team domain (**Settings → Team name and domain**, `<team>.cloudflareaccess.com`) as `CF_ACCESS_TEAM_DOMAIN`. Without both, the container will not start; with them, any request that did not come through Access gets a 403 (logged as `[access] Refused …`).

Open `https://tsuzuku.<your-domain>`: Cloudflare asks for the PIN first, then the web build loads.

5. **For the native apps:** create a service token (**Access controls → Service credentials → Service Tokens**, non-expiring) and add a **Service Auth** policy for it to the same application. The app asks for its client ID and secret on first run, with the server URL.

### 5. Source apps

Add the production redirect URLs next to the local ones, on each source's app page:

- `https://tsuzuku.<your-domain>/api/auth/trakt/callback`
- `https://tsuzuku.<your-domain>/api/auth/simkl/callback`
- `https://tsuzuku.<your-domain>/api/auth/mal/callback`

If a source's form takes only one redirect URL, create a second app for production, put its ID and secret in the server's `.env`, and connect that source again in Settings.

### 6. Backups

**In the app:** one is made every night at 03:00 in the server's time zone (UTC in the container unless `TZ` is set in `.env`). Settings → Backups → **Back up now** makes one at any time. Each nightly run leaves a `[backup]` line in `docker compose logs tsuzuku`, and the start-up log says when it runs. Each is a copy made with SQLite's online backup, safe while the app runs, into `data/backups/`. The newest 14 are kept and listed with a **Download** button, which is the easy way to get a copy off the machine. Only names in that list are served.

**From the shell:** `scripts/backup.mjs` makes the same copy:

```sh
docker compose exec -T tsuzuku node scripts/backup.mjs
```

Copy `data/backups/` off the machine now and then. Keep `TOKEN_ENC_KEY` in your password manager, never next to the backups: a backup without the key still has your links and log, but the source connections have to be made again.

**Quick check without the tunnel:** uncomment the `ports` lines in `compose.yaml` (`127.0.0.1:3000:3000`), run `up -d`, and open `http://localhost:3000` on the server. If cloudflared runs on the host instead of in a container, use that and point the tunnel at `http://localhost:3000`.

## The app

Run, build and test it from `app/` with `flutter` (see [app/CLAUDE.md](app/CLAUDE.md)). The web build needs nothing extra: it ships inside the server image.

**Releasing.** Bump `version:` in `app/pubspec.yaml` to `X.Y.Z`, commit, push, then tag and push the tag:

```sh
git tag app-vX.Y.Z
git push origin app-vX.Y.Z
```

`.github/workflows/app-release.yml` checks that the tag equals the `pubspec.yaml` version, then builds and attaches to a public GitHub Release: `tsuzuku.apk` (signed with the release keystore), `tsuzuku-setup.exe` (per-user Windows installer) and `tsuzuku-x86_64.AppImage`, the last two with ed25519 `.sig` files. No server URL or token is in any build. Installed apps find the release themselves: Android and Windows update in the app, Linux through Shelly. The signing keys live in Actions secrets and the password manager; never change them, or updates stop installing over the old app.

## Scripts

Run from `backend/`.

| Command              | What                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `vp run dev`         | Dev server on port 3000                                                    |
| `vp run dev:demo`    | Dev server in demo mode: fictional shows, fake sources, no accounts needed |
| `vp test`            | Unit tests (Vitest), in watch mode; `vp test run` runs once                |
| `vp check`           | Format check, lint and type check (oxfmt, oxlint); `--fix` fixes           |
| `vp run typecheck`   | Type check (`tsc`, with Nitro's generated types)                           |
| `vp run db:generate` | Generate a migration after changing `server/db/schema.ts`                  |

`vp run dev` and `vp dev` differ: `vp dev` is Vite's own dev server, not Nitro's. A pre-commit hook (`.vite-hooks/`, set up by `vp install`) runs `vp check --fix` on staged files.

`ci.yml` runs `vp check`, typecheck, tests and the contract check, then builds and starts the Docker image; on `main` it also publishes the image to GHCR. It runs on changes to `backend/`, `api/` or `app/` (Markdown aside); `app.yml` runs the app's checks on changes to `app/` or `api/`. A push that changes only Markdown or `docs/` runs neither.

## How it works

- **Stack:** a Flutter app (Android, Windows, Linux, web) on a plain Nitro server, SQLite in WAL mode with Drizzle, TMDB and AniList for metadata. The image serves the Flutter web build at `/` and the API at `/api`; the native apps keep a read-only snapshot of the last answers, the web build has no service worker.
- **Source wrapper** (`backend/server/lib/source-wrapper.ts`): every call to Trakt, Simkl, MAL, TMDB or AniList goes through it. It throttles per source, honours `429` / `Retry-After`, and serves the last good response marked stale when a source is blocked or failing. One failing source never blanks the page.
- **Live, not synced:** lists are fetched when you open a page. Simkl is checked through `/sync/activities` first, as its API rules require, and the lists are fetched only when something changed. There is no background sync and no job queue.
- **Mapping** (`backend/server/lib/mapping*.ts`, `backend/server/lib/seasons.ts`): links by shared IDs first, then AniList prequel chains for anime seasons, then title matches and search. Anything not proven by an ID waits for your confirm. Only real IDs returned by a source are stored.
- **Links:** every title, season and episode links to that source's own page.

## Docs

- [docs/decisions.md](docs/decisions.md): the locked decisions. Change one only on purpose.
- [docs/plan.md](docs/plan.md): architecture, data model, adapters, mapping, UI, the apps, the server.
- [docs/context.md](docs/context.md): rejected options and why, and what is known about each API from real responses.
- [CLAUDE.md](CLAUDE.md) (and one per subproject): rules for AI-assisted work on this repo.

## Data and secrets

- The database is `backend/.data/tsuzuku.db` in development and `data/tsuzuku.db` next to `compose.yaml` when deployed (both gitignored). Back it up with `sqlite3 .backup` or Litestream, not a raw copy while the app is writing.
- Source tokens are encrypted with `TOKEN_ENC_KEY`. Keep the key outside the database and back it up separately.
- Secrets are never logged. The OAuth log lines show token response field names only.
