# Locked decisions

Every choice below was settled in planning; change one only on purpose.

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Users | Single user. Keep `user_id` in all tables. |
| 2 | Conflicts | No automatic resolution. Every disagreement is shown and you decide. |
| 3 | Writes | Preview per source before every write, then confirm. |
| 4 | Content | Shows and anime. Movies later, manga out. |
| 5 | Platform | Web only, self-hosted. PWA can be added later. |
| 6 | Metadata | TMDB for shows, AniList for anime (AniList `idMal` links to MAL). |
| 7 | Database | SQLite (WAL) with Drizzle. |
| 8 | Rate limits | Per-source status chip, `blocked_until` saved in SQLite, stale cache badge, writes disabled while blocked. |
| 9 | "Up next" set | Union of Trakt `up_next`, Simkl watching, MAL watching. |
| 10 | Mismatch rule | Exact. Any difference flags. |
| 11 | Trakt watching | Use Trakt's own `sync/progress/up_next`, not derived from history. |
| 12 | List order | Trakt order (last watched). Everything else on Simkl or MAL goes in a separate "Not in Trakt up next" section, whether unlinked or linked to a Trakt show that Trakt does not list as up next: something to watch first, then caught up, each by its own last activity. |
| 13 | Manual update | "Mark next episode watched", one episode at a time. When every source on a row agrees on the next episode, one click covers them all; otherwise each source is marked on its own. Each source marks its own next episode in its own numbering, with a preview per source and a confirm. No bulk catch-up. |
| 14 | Mapping | Deterministic IDs, then ranked candidates you confirm once. Laya replaces the ranking later. |
| 15 | Anime seasons | Season-level mapping with `episode_offset` for anime. Other shows link at show level. |
| 16 | Source auth | OAuth redirect per source, encrypted tokens, automatic refresh. |
| 17 | App login | Cloudflare Access (email + PIN). The tunnel is the only way in: the container joins the cloudflared container's Docker network and publishes no port (bound to `127.0.0.1` only if cloudflared runs on the host). |
| 18 | Framework | Nuxt 4. No background scheduler or job queue. |
| 19 | Display | Each source shows its own title, so wrong links are visible. |
| 20 | UI library | Nuxt UI (`@nuxt/ui`, MIT), wrapped in `UApp`. Replaces nxui and shadcn-vue. |
| 21 | Tooling | bun as package manager and script runner; Node as the runtime (no `--bun`, no `Bun.*` APIs). |
| 22 | Caught up | A show with no next episode on a source stays on Up Next with a "caught up" label for that source; it is never hidden. Simkl keeps caught-up shows in `watching`; Trakt drops them from `up_next`. (#14) |
| 23 | Specials, OVAs, anime movies | Shown in v1, each as its own row with that source's title, progress and mark-next button, labelled by type. Not linked across sources: Trakt season 0 and MAL OVA entries number episodes differently, and Trakt files anime movies as movies. Linking waits for movies (#17). (#15) |
| 24 | Source links | Every title, season and episode on screen links to that source's own page. When Simkl and MAL list the same entry it says so ("Simkl + MAL"); when they disagree, each source's value is shown separately. Episode links only use URL formats checked against the real sites (`shared/utils/source-links.ts`); otherwise the link goes to the show. |
