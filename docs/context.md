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
| Interleaving shows not on Trakt into the main list | Trakt gives no timestamp in min data. They get a separate section. |
| Jikan as the anime source | Unofficial scraping, rate limited. AniList is official GraphQL and returns `idMal`. |
| Exact-match tolerance (±1) or "behind only" | Exact: any difference flags. |
| App-level login | Cloudflare Access in front, container bound to `127.0.0.1`. |
| nxui and shadcn-vue | nxui is mostly animated showcase components with no plain primitives; Nuxt UI covers them in one module. |
| Nuxt 3 | End of life since July 31, 2026. Use Nuxt 4. |
| PWA, native mobile | Web only first. PWA can be added later. |

## What is known about the APIs

Only what was seen in docs and one screenshot. Anything else is unverified; confirm it from real responses (see the `verify` issues).

- **Trakt `GET /sync/progress/up_next`:** OAuth required, paginated, supports extended info. Params: `extended`, `page`, `limit`, `sort_by`, `sort_how`, `include_stats`, `lifetime_stats`. Docs: without pagination params a low default limit (often 10) applies; a given `limit` is capped (often 250). Min data returns only `show.title`, `show.ids.trakt`, `show.ids.slug`, `progress.aired`, `progress.completed`. The docs example URL used `sort_how=asc`, so pin the sort explicitly.
- **Trakt `up_next_nitro`:** not needed; VIP status unchecked. `sync/playback` is unchecked.
- **Trakt rate limits:** assume a 429 with `Retry-After`; check the Rate Limits page.
- **MAL:** episode count only, no per-episode dates. Tokens expire often. Official API v2, OAuth2 with PKCE.
- **Simkl:** returns MAL, TMDB, IMDb and TVDB IDs (expected). OAuth2 with PIN flow exists; the plan uses redirect.
- **AniList:** GraphQL, returns `idMal`, relations for sequels and prequels, roughly 90 requests per minute (unverified).
- **TMDB:** free, attribution required in the UI.

## Where it runs

- Developed locally (Windows with PowerShell, or Linux with fish). Deployed with Docker Compose on a homelab laptop behind a Cloudflare tunnel and Cloudflare Access.
- Source control and issues on GitHub (`oowais/tsuzuku`), project "Tsuzuku".

## Parked ideas

- **Laya** (open-weight decision model) to rank mapping candidates, only after the manual flow works. It reads text only and is a base for fine-tuning, not zero-shot. Plan: labeled set from deterministic matches, benchmark, fine-tune the multilingual checkpoint if weak, keep the non-AI verifier (year, type, episode count).
- Movies, PWA, per-show "trust this mapping, skip preview", Access JWT check in the app.
