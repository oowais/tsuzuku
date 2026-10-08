# Context

Background that is not in `decisions.md` or `plan.md`: what was considered and rejected, what is known about the APIs, and where this runs. Read it before proposing alternatives.

## Rejected options (do not re-propose without a reason)

| Option | Why not |
| --- | --- |
| One source as primary / canonical (e.g. Trakt) | Simkl returns the most cross-IDs and is the better mapping hub; "biggest" matters less than who gives IDs. No source is treated as correct. |
| Computing one "next episode" (highest progress wins) | You want each source's own progress and next episode shown side by side, with the disparity visible. Updating a source is always manual. |
| Automatic conflict resolution (union, newest wins, fixed source of truth) | Every disagreement goes to you. Un-watch or a wrong mark would otherwise spread. |
| Auto fan-out writes, even for verified mappings | Preview per source before every write. A wrong mapping would mark the wrong show. |
| Bulk "set progress to N" | It would stamp `watched_at` on episodes never watched on that source. Only "mark next episode watched". |
| Full-library sync, scheduler, `jobs` table, Redis/BullMQ | Only what is next to watch is needed. Fetch live on open, short-TTL cache, Refresh button. |
| Deriving Trakt "watching" from history, or a custom Trakt list | Trakt's own `sync/progress/up_next` already gives the list. |
| No database at all | Still needed for ID mappings, metadata cache, tokens and `blocked_until`. SQLite is enough. |
| Postgres | Single user. Drizzle keeps a later switch cheap. |
| Show-level link only for anime | Breaks on multi-entry anime; the wrong MAL entry could be written. |
| Interleaving shows not in Trakt up next into the main list | The main list keeps Trakt's own order. They get a separate section. |
| Jikan as the anime source | Unofficial scraping, rate limited. AniList is official GraphQL and returns `idMal`. |
| Exact-match tolerance (±1) or "behind only" | Exact: any difference flags. |
| App-level login | Cloudflare Access in front, container bound to `127.0.0.1`. |
| nxui and shadcn-vue | nxui is mostly animated showcase components with no plain primitives; Nuxt UI covers them in one module. |
| Nuxt 3 | End of life since July 31, 2026. Use Nuxt 4. |
| PWA, native mobile | Web only first. PWA can be added later. |

## What is known about the APIs

Items marked "seen" were checked against real responses on 2026-10-08 (step 3); the rest comes from docs only. Confirm anything unverified from real responses before relying on it.

- **Trakt `GET /sync/progress/up_next`** (developer portal reference, operation `getSyncProgressUpNextStandard`): OAuth required, paginated. Params: `extended`, `page`, `limit`, `sort_by`, `sort_how`, `include_stats`, `lifetime_stats`; the reference gives no values for `sort_by`. Without pagination params a low default limit (often 10) applies; a given `limit` is capped (often 250). Min data returns only `show.title`, `show.ids.trakt`, `show.ids.slug`, `progress.aired`, `progress.completed`.
  - Seen with `extended=full`: `show.ids` has `trakt, slug, tmdb, tvdb, imdb`; `progress` has `aired, completed, last_watched_at, reset_at, hidden, last_episode, next_episode, stats`; episodes carry `season, number, number_abs, title, first_aired, episode_type` (`standard`, `season_premiere`, `mid_season_premiere`, `season_finale`) and their own `ids`. Undocumented extras: `show_id` (= `show.ids.trakt`), `total_count`, `cached_aired_episode_count`, `prev_number_abs`, `last_aired_number_abs`.
  - Seen order: default is `progress.last_watched_at` newest first; `sort_how=asc` reverses it (the reference's example URL uses `asc`). The app pins `sort_how=desc` and leaves `sort_by` unset.
  - Seen: hidden shows are excluded; the 9 returned shows matched the Trakt web app's "Continue Watching" exactly, in the same order.
  - Seen paging headers: `x-pagination-item-count`, `-limit`, `-page`, `-page-count`. They are wrong for this endpoint: page 1 returned 9 items with item-count 1337 and page-count 14, page 2 was empty. Stop on a short page instead. No rate limit headers were sent.
- **Trakt `up_next_nitro`:** what the Trakt web app calls, on the "Premium" API server `apiz.trakt.tv` (public is `api.trakt.tv`), with `intent=continue` and a `marker` cursor. Not marked VIP in the reference, but not needed: plain `up_next` gives the same list. `sync/playback` is not needed either.
- **Trakt OAuth (developer portal, 2026-10-08):** creating an app needs a linked GitHub account. New apps get no client secret and must use PKCE (S256 only); the token request sends `code_verifier` and no `client_secret`. Authorize at `https://auth.trakt.tv/oauth/authorize`. `http://localhost` redirects are accepted with a warning; the portal recommends `https://` only. Refresh without a secret is unverified.
- **Token responses (seen 2026-10-08, field names only):** Trakt: `access_token, created_at, expires_at, expires_in, refresh_token, scope, token_type`, scope `public offline_access`, `expires_in` 7 days (not the 86400 in the old docs). Simkl V2: `access_token, expires_in, refresh_token, scope, token_type`, scope `media:read media:write`, 7 days. MAL: `access_token, expires_in, refresh_token, token_type`, 31 days.
- **Trakt rate limits:** 1000 GET per 5 minutes and 1 POST per second (docs). No rate limit headers seen on `up_next`; assume a 429 with `Retry-After`.
- **MAL:** episode count only, no per-episode dates. Official API v2 (https://myanimelist.net/apiconfig/references/api/v2), OAuth2 with PKCE `plain`. Seen: access token lasts 31 days; refresh not yet seen.
  - `GET /v2/users/@me/animelist?status=watching&sort=list_updated_at&limit=1000&nsfw=true&fields=...` returns `{ data: [{ node, list_status }], paging }`, `paging.next` holds the next page URL.
  - Seen: `node` has `id, title, main_picture, num_episodes, media_type` (`tv`, `ona`), `status` (`finished_airing`, `currently_airing`), `alternative_titles` (`en, ja, synonyms`), `start_season` (`year, season`), `start_date`; `list_status` has `status, score, num_episodes_watched, is_rewatching, updated_at`, and `start_date` when set.
  - Seen: no rate limit headers. Limits are undocumented.
- **Simkl watching list (seen):** `/sync/all-items/{shows|anime}/watching?next_watch_info=yes` returns `{ shows: [...] }` or `{ anime: [...] }`, `{}` when empty. Items have `status, added_to_watchlist_at, last_watched_at, last_watched, next_to_watch` (`S01E05` for shows, `E12` for anime, null when caught up), `watched_episodes_count, total_episodes_count, not_aired_episodes_count, user_rating, user_rated_at`, and `show` with `title, poster, year, ids`. Anime also have `anime_type` (`tv`, `ona`, ...) and, when there is a next episode, `next_to_watch_info` (`title, episode, date`). `last_watched_at` can be null for anime.
  - Seen IDs: every show has `simkl, slug, imdb, tmdb, tvdb, tvdbslug, traktslug`; every anime has `simkl, slug, mal, anilist, kitsu, anidb`, and some also `tmdb, imdb, tvdb, traktslug`.
  - `next_to_watch` is null exactly when no aired episode is left; Simkl keeps caught-up shows in `watching`.
  - Sync rule: Simkl suspends a `client_id` that polls `/sync/all-items` without checking `/sync/activities` first and using `date_from` deltas. The adapter follows their sync guide (see `server/adapters/simkl.ts`).
  - Every request needs `client_id`, `app-name`, `app-version` URL params and a `User-Agent`.
  - Seen rate limit headers: `x-ratelimit-limit` (the daily quota per user, set by their plan: 500 free, 1000 PRO, 10000 VIP) and `x-ratelimit-remaining`. Docs: 10 GET and 1 POST per second.
- **Simkl:** returns MAL, TMDB, IMDb and TVDB IDs. Auth uses AUTH V2 (V1 retires around April 2027), app type "Server apps & services": authorize at `https://simkl.com/oauth2/authorize`, token at `https://api.simkl.com/oauth2/token`, PKCE S256 plus client secret, scope `media:read media:write` (a misspelled scope silently gives read-only; check the granted `scope`). Access tokens last 7 days; refresh tokens are non-rotating with a sliding 180-day window, and a refresh immediately invalidates the previous access token, so only one process may refresh. Docs: https://api.simkl.org/llms.txt.
- **AniList:** public GraphQL at `https://graphql.anilist.co`, no auth (https://docs.anilist.co). Field names checked against the live schema: `Page(perPage: 50) { media(idMal_in: [...], type: ANIME) { id idMal format episodes status title { romaji english native } synonyms startDate relations { edges { relationType node { id idMal format episodes ... } } } } }`.
  - Seen rate limit: `x-ratelimit-limit=30` (docs: 90 per minute, cut to 30 while the API is degraded), `x-ratelimit-remaining`; a 429 carries `Retry-After` and a 1 minute timeout.
  - Seen `idMal` coverage: all 10 MAL IDs from the Simkl and MAL watching lists were found.
  - Seen relations: every season entry has a `PREQUEL` edge whose node carries `idMal`, so a season chain can be walked hop by hop. A `PREQUEL` is not always the previous season: One Piece's is a one-off ONA, so a chain walk must check format and episode counts. `episodes` is null while a series airs. Other relation types seen: `SIDE_STORY, SUMMARY, ADAPTATION, CHARACTER, OTHER, ALTERNATIVE, SPIN_OFF`.
- **TMDB:** free, attribution required in the UI.

## Where it runs

- Developed locally (Windows with PowerShell, or Linux with fish). Deployed with Docker Compose on a homelab laptop behind a Cloudflare tunnel and Cloudflare Access.
- Source control and issues on GitHub (`oowais/tsuzuku`), project "Tsuzuku".

## Parked ideas

- **Laya** (open-weight decision model) to rank mapping candidates, only after the manual flow works. It reads text only and is a base for fine-tuning, not zero-shot. Plan: labeled set from deterministic matches, benchmark, fine-tune the multilingual checkpoint if weak, keep the non-AI verifier (year, type, episode count).
- Movies, PWA, per-show "trust this mapping, skip preview", Access JWT check in the app.
