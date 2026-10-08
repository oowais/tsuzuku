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
| 12 | List order | Trakt order (last watched). Shows not on Trakt go in a separate section. |
| 13 | Manual update | "Mark next episode watched" per source only. No bulk catch-up. |
| 14 | Mapping | Deterministic IDs, then ranked candidates you confirm once. Laya replaces the ranking later. |
| 15 | Anime seasons | Season-level mapping with `episode_offset` for anime. Other shows link at show level. |
| 16 | Source auth | OAuth redirect per source, encrypted tokens, automatic refresh. |
| 17 | App login | Cloudflare Access (email + PIN). Container bound to `127.0.0.1`. |
| 18 | Framework | Nuxt 4. No background scheduler or job queue. |
| 19 | Display | Each source shows its own title, so wrong links are visible. |
| 20 | UI library | Nuxt UI (`@nuxt/ui`, MIT), wrapped in `UApp`. Replaces nxui and shadcn-vue. |
