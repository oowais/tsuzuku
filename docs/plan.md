# Tsuzuku: Project Plan

Decisions live in [decisions.md](decisions.md). Work is tracked in the GitHub project.

## Overview

A self-hosted web app that shows what to watch next across Trakt, Simkl and MyAnimeList, and makes disagreements between them visible. It fetches live, keeps no full copy of any library, and never changes a source without a preview and a manual confirm.

- **Scope:** shows and anime on Shows; movies as a watchlist on Movies (#17, decision #25). Manga out.
- **User:** you only, with a `user_id` column kept in every table.
- **Core idea:** one row per show, one column per source, each with its own title, progress and next episode.

## Architecture

One Nuxt 4 server in a container brokers everything. The browser reaches it only through Cloudflare Access, and it reaches the five external APIs only through the source wrapper.

```mermaid
flowchart LR
  B[Browser<br/>Shows page] -->|HTTPS| CF[Cloudflare Access<br/>email + PIN]
  CF -->|tunnel to localhost| S
  subgraph S[Nuxt 4 server in Docker]
    API[API routes<br/>up-next, mark watched, OAuth] --> W[Source wrapper<br/>429 handling, throttle, status per source]
    W --> DB[(SQLite WAL<br/>tokens, mappings, caches,<br/>blocked_until, write log)]
  end
  W -->|read and write| T[Trakt]
  W -->|read and write| SK[Simkl]
  W -->|read and write| M[MyAnimeList]
  W -->|read only| TM[TMDB]
  W -->|read only| AL[AniList]
```

Stack: Nuxt 4 (Vue, Nitro), Nuxt UI, SQLite in WAL mode with Drizzle, Docker Compose, Cloudflare tunnel. The server binds to 127.0.0.1; the wrapper is the single place that handles status, 429s and throttling.

## Data model

SQLite stores only what live calls cannot: tokens, mappings, cached metadata and source state. Watch progress is never stored as truth; it is fetched on open and cached briefly.

| Table                 | Purpose                           | Key columns                                                                                                            |
| --------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `source_accounts`     | One row per connected source      | `user_id`, `source`, encrypted access and refresh token, `expires_at`, `blocked_until`, `last_status`, `last_fetch_at` |
| `mappings`            | One row per linked show           | `user_id`, Trakt, Simkl, MAL, TMDB, AniList IDs, `kind` (show or anime), `status` (auto, confirmed, rejected)          |
| `mapping_seasons`     | Anime season to MAL/AniList entry | `mapping_id`, `trakt_season`, `mal_id`, `anilist_id`, `episode_offset`, `episode_count`                                |
| `movie_links`         | Movies you linked by hand         | `user_id`, Trakt ID and slug, TMDB, IMDb, Simkl and MAL IDs, the picked title                                          |
| `rejected_candidates` | Candidates you declined           | `user_id`, `source`, `source_item_id`, `candidate_id`                                                                  |
| `metadata_cache`      | TMDB and AniList responses        | `provider`, `external_id`, JSON, `fetched_at`                                                                          |
| `fetch_cache`         | Last list per source              | `user_id`, `source`, JSON, `fetched_at`                                                                                |
| `write_log`           | Every confirmed write             | `user_id`, `source`, `item`, `action`, `result`, `at`                                                                  |

Back up with `sqlite3 .backup` or Litestream, not a raw file copy during writes. Keep the token encryption key outside the database and back it up separately.

## Source adapters and rate limits

Each source sits behind one wrapper that returns `{status, data, fetchedAt, retryAfter}`. One source failing never blanks the page: the three fetches run with `Promise.allSettled`.

| Source | Watching list                                                                                       | Write "mark next"                                               | Notes                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Trakt  | `GET /sync/progress/up_next?extended=full&sort_how=desc` (OAuth, paginated)                         | Add episode to history                                          | `extended=full` gives TMDB/TVDB IDs, `last_watched_at` and the next episode. Hidden shows are excluded. |
| Simkl  | `/sync/activities`, then `/sync/all-items/{shows,anime}/watching` once and `date_from` deltas after | Add episode to history                                          | Returns cross-IDs (MAL, TMDB, IMDb, TVDB). Must check activities first or the client ID gets suspended. |
| MAL    | `GET /users/@me/animelist?status=watching`                                                          | Increment watched count by 1; set completed on the last episode | Count only, no per-episode dates. Access tokens last 31 days.                                           |

"Fetch live" means one call per source on open. For Simkl that call is `/sync/activities`; the lists are fetched only when it shows a change, and the cached list is served otherwise. Raw responses are kept in `fetch_cache` (`GET /api/sources/watching` returns them).

**Rate limit handling**

1. On a 429, read `Retry-After`, save `blocked_until` for that source, and stop calling it.
2. Serve cached data with a "stale, fetched N min ago" badge. Never show it as "missing".
3. Disable write buttons for that source; the preview shows "blocked, retry in 42s".
4. Auto-retry once when the countdown ends, plus a manual Refresh button.
5. A small in-memory token bucket per source avoids most 429s.

**Status chip per source:** ok, rate limited (countdown), auth expired, error. A source with a failed token refresh shows "auth expired" and a Reconnect button.

## Mapping

A show is linked across sources in two layers, and you confirm every uncertain link once.

1. **Deterministic first.** Shared IDs: Trakt and Simkl return TMDB/IMDb/TVDB; Simkl and AniList (`idMal`) bridge to MAL.
2. **Ranked candidates.** For an unmatched item, search the target source by title (English, romaji, Japanese) and rank by title and year match. You confirm with one tap. The result is cached permanently; rejected candidates are stored so they are not suggested again.
3. **Laya later.** The ranking step is the only part Laya replaces. Plan: build a labeled set from the deterministic matches, benchmark Laya zero-shot, fine-tune the multilingual checkpoint if weak, and keep the non-AI verifier (year, type, episode count) after the model.

**Anime seasons.** Trakt has one show with seasons; MAL has one entry per season or cour. For anime, `mapping_seasons` links each Trakt season to a MAL/AniList entry with an `episode_offset` (for example Trakt S1E26 = MAL entry 2, episode 1). AniList sequel and prequel relations propose the chain; you confirm. Other shows link at show level only.

**Unmapped is not missing.** The UI separates "not in that list" from "unmapped", so a failed link never looks like an absent show.

## UI and write flow

**Shows page** (`/`; called Up Next until 2026-10-10, Progress until 2026-10-11, when Movies came). Main list in Trakt `up_next` order, then a separate "Not in Trakt up next" section: Simkl and MAL watching shows that are unlinked, or linked to a Trakt show Trakt does not list as up next. Shows with something to watch come first, caught-up ones after (collapsed, not hidden), each by its own last activity.

Each row has one column per source showing:

- that source's own title and entry (MAL shows the entry title plus episode count, so season splits are visible)
- progress, for example "S2E5" or "7/12"
- its own next episode
- a state: in sync, differs, caught up, not in that list, unmapped, stale, or blocked

No source is treated as correct, and no "next episode" is computed across sources. Differences are highlighted and left for you.

Every title, season and episode links to that source's page; entries that Simkl and MAL both list are labelled "Simkl + MAL", and their values are shown separately when they differ (decision #24).

**Caught-up rows** (#62) say when the next episode airs, per source that knows, side by side: Trakt's `next_episode` for a linked Trakt show (cached a day, or until it airs) and AniList's `nextAiringEpisode` for anime (part of the existing AniList lookup, fetched again once a cached date has passed). Only the Shows page asks, never the write path.

**Movies** (#17, decision #25): `/movies`. The union of the Trakt movie watchlist, Simkl's movies and anime movies, and MAL entries with `media_type` `movie`, every status read so a movie on one watchlist shows what the others say (watched, dropped). One row per movie, linked by shared IDs (TMDB and IMDb between Trakt and Simkl, Simkl's MAL ID to MAL); two entries of one source never share a row. The card leads with the English title (Trakt's, or AniList's for an anime movie) in full, with an anime movie's romaji under it (AniList's, else MAL's); expanded, each source shows its own title and state; a source without the movie says "not on your lists" when the row has an ID its lists would have matched, else "not linked"; MAL is left out for movies that are not anime. A movie that is to watch (watchlist, watching) on no source drops off; nothing is kept about it. Anime movies are no longer on Shows. Reads: Trakt `GET /sync/watchlist/movies` (paged) and `GET /sync/watched/movies` (ids, title, year and last watch kept); Simkl `/sync/all-items/movies` and `/sync/all-items/anime?anime_type=movies` behind `/sync/activities` with a snapshot of their own (`activities:movies`) and `date_from` deltas; MAL the whole list (no status filter), only movies kept.

**Movies: mark watched.** On a card it previews each source, then writes on confirm (decision #3): a source with the movie to watch is ticked (Trakt: add to history, which takes it off the watchlist; Simkl: add to history, Completed; MAL: Completed with every episode watched, start and finish date today unless set); a source without it on any list is offered unticked, found by the IDs the others gave; watched, dropped, on hold and not-linked sources are skipped with the reason. One optional score (unticked by default) goes to every source marked: in the MAL PATCH, in Simkl's history item, and for Trakt in a ratings call after the mark. The confirm reads every list again, writes only steps that still match, refuses a repeat of a recent write, and logs each write under `movie:<row key>`.

**Movies: links** (decision #14) join what shared IDs cannot, without a step of their own: where none of your lists ties a movie to Trakt or MAL, the add preview ("Add to Trakt", "Add to the other watchlists" in a card's menu, or a search result) lets you pick the Trakt movie or MAL entry among real search results (Trakt's movie search, AniList's anime movies), with the movie's titles offered as queries (AniList's English title first). The pick is looked up on its source again; once a write goes through, it is kept in `movie_links` with the row's IDs, so the entries stay on one card and can be marked by those IDs. A link writes nothing to the sources; "Remove your link" in the menu undoes a wrong pick. A source without the movie links to its page when the row has its ID, and offers "Add".

**Movies: add from a search.** "Add" on the page finds a movie on TMDB (any movie; `TMDB_API_KEY`, the v3 key or the v4 read token) or AniList (anime movies) and previews each source, then writes on confirm: Trakt `POST /sync/watchlist`, Simkl `POST /sync/add-to-list` to Plan to Watch, MAL Plan to Watch. A TMDB pick goes to Trakt and Simkl by its TMDB ID, to MAL only when your lists tie it to a MAL entry; an AniList pick goes to MAL and Simkl by its MAL ID, and to Trakt when your lists tie it to a TMDB ID or you pick its Trakt movie among real search results (kept as a link). A source that already lists the movie, or has it watched, is skipped and never moved. The confirm reads every list again; each write is logged as `add_to_watchlist`.

**Shows: add an anime.** "Add" on Shows finds an anime series on AniList (anime movies are left out: they belong on Movies) and puts it on Watching or Plan to Watch, your choice, on MAL and Simkl by its MAL ID, with a preview per source and a confirm. MAL's list status is read first: an entry already on your MAL list is skipped, except Plan to Watch moving to Watching. Simkl is skipped when its Watching list already has it; its other lists are not read, and its add moves an entry from one, which the step says. Trakt is not offered (an AniList pick carries no Trakt ID); the season mapping is proposed through the normal flow once Trakt shows the show. The confirm reads the lists again; writes are logged as `start_watching` or `add_to_watchlist`, with AniList's cover.

**Calendar** (#72): `/calendar`, read-only, last month to next month. Trakt's own calendar of your shows (not cut down to Shows: Trakt drops caught-up shows from up next, and those are the ones airing), AniList's airing schedule for the anime on Shows, and Simkl's date for your next episode (anime: a Japan-time calendar date, shown on that date as written). Each item is one source's own title, episode and date, linked to that source; one show's items sit together, so different dates for one episode show side by side. Faded when watched on that source's side (Trakt: in your Trakt history since the month began, read with the calendar and again after a Trakt write; anime: within the MAL count, else Simkl's). Month grid on wide screens, an agenda from today on narrow ones. Progress rows come from the cached lists, so opening the calendar costs two Trakt calls (calendar, history) and one AniList call per month, cached 6 hours.

## Standalone app (#103, plan B)

The same Vue UI shipped as an installed app for Android, Windows and Linux with Tauri 2, talking to the Tsuzuku server over its API. Plan A (a window that only opens the server URL) is skipped; B is tried in full and reverted if it does not work. Everything below is additive: the web build, the server and the browser behaviour stay as they are, so reverting the app's PRs restores today. Decision #5 (web only, PWA) changes when the app ships.

```mermaid
flowchart LR
  A[App<br/>Vue UI in the system webview] -->|Tauri HTTP plugin<br/>+ Access service token| CF[Cloudflare Access<br/>Service Auth]
  B[Browser] -->|HTTPS, email + PIN| CF
  CF -->|tunnel| S[Nuxt 4 server<br/>unchanged]
  S -->|source wrapper| X[Trakt, Simkl, MAL, TMDB, AniList]
```

The app talks only to the Tsuzuku server. Every Trakt, Simkl, MAL, TMDB and AniList call is still made by the server through the source wrapper, and source tokens never leave it, so the cost of a page load is the same as in the browser.

**App build.** A second build mode, `TSUZUKU_APP=1`: `ssr: false` and `nuxt generate`, so the UI is static files that Tauri packages (`frontendDist`). The server build is untouched. Things that rely on the server render:

- **Cookies:** the theme and the progress style are cookies (`useCookie`); in the app they live on the app's own origin, which works without a server.
- **Fonts:** `@nuxt/fonts` downloads them at build time, so they ship with the app.
- **Icons:** Nuxt Icon bundles the icons it finds in the code; a name built at runtime is fetched from `/api/_nuxt_icon`, which in the app would hit the app's origin. The app build bundles every icon used (client bundle with scan, plus the dynamic names), and is checked to fetch none at runtime.

**One fetch layer.** The UI calls the server in 40 places (`useFetch` and `$fetch`, 18 files), all with paths like `/api/up-next`. A client plugin, active only inside Tauri, replaces the global `$fetch` with one that adds the server URL, sends the request through Tauri's HTTP plugin (made by Rust, so no CORS) and adds the Access service token headers. The call sites do not change; to verify that `useFetch` picks up the replaced `$fetch`.

**Links to the server.** Two buttons are links, not fetches, and need their own handling in the app:

- **Connect / Reconnect** (`/api/auth/<source>/start`): opens the system browser at `<server>/api/auth/...`, where the OAuth round trip finishes as today. Connecting sources stays a browser job.
- **Backup download** (`/api/backups/<name>`): fetched through the fetch layer and saved with a file dialog.

**First run and the Server setting.** On first launch the app asks for:

- the server URL, stored on the device;
- the Access service token (`CF-Access-Client-Id`, `CF-Access-Client-Secret`), kept in the device's secure storage. Which plugin does that on all three platforms (Stronghold, or the OS keychain on desktop and Android's Keystore) is picked while building it.

A test call (`/api/sources/status`, which goes through Access, unlike `/api/health`) checks both before saving. A Server section in Settings changes them later.

**Cloudflare and the server.** A Service Auth policy in the Access application for the service token. Access signs those requests too, so the server's own check (`server/middleware/access.ts`) should pass unchanged; to verify. No CORS change is needed.

**Version drift.** An installed app can be older than the server. An API version number in `shared/`, bumped when an API change breaks older clients, is served by the server and built into the app; on a mismatch the app shows a banner asking for an update. Otherwise API changes stay backwards-compatible.

**Tauri project.** `src-tauri/` in this repo (Tauri 2): app id, icons from `public/`, plugins `http` (scoped to `https://**`, as the server URL is only known at runtime), `store`, `opener`, `dialog` and `fs` (backups), `updater` (desktop). The CLI comes in through `vp add -D @tauri-apps/cli` and runs with `vp exec tauri`; scripts for the app's dev run and builds.

**Builds (GitHub Actions, free for this public repo on standard runners).** A workflow on a tag (`app-v*`) attaches every build to a GitHub Release:

- **Linux:** an AppImage on `ubuntu-latest` (WebKitGTK 4.1).
- **Windows:** an installer on `windows-latest` (`tauri-action`).
- **Android:** an APK on `ubuntu-latest` (Android SDK preinstalled, NDK and Rust's Android targets added), signed with a keystore kept in Actions secrets.

Updates: Tauri's updater on Windows and Linux; Obtainium tracks the APK on Releases.

**Public repo: nothing personal in the builds.** Releases on a public repo can be downloaded by anyone, so no build carries the server URL or a token: both are entered on the device.

**Testing.** The Linux app builds and runs in the cloud dev container (Rust and WebKitGTK are available) against the demo server (`vp run dev:demo`), under a virtual display for screenshots. Windows and Android are built in CI; Android is tried on the phone.

**Order.**

1. App build mode, the fetch layer, the first-run screen, `src-tauri/`; the Linux app working against the demo server.
2. The Actions workflow for all three platforms, signed APK.
3. Connect and backup links, the Server setting, the version check, secure storage on every platform.
4. On the phone: Access login with the service token, scrolling, writes (preview and confirm). Then decision #5 is updated, or the PRs are reverted.
