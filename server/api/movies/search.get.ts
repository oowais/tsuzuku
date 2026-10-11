import { z } from "zod";
import { useAdapters } from "../../adapters";
import { targetOf } from "../../lib/next-season";
import { cachedMovieEntries } from "../../lib/movies-service";

const query = z.object({
  from: z.enum(["tmdb", "anilist"]),
  q: z.string().trim().min(2).max(200),
});

// Movies to add (#17): TMDB for any movie, AniList for anime movies. Each result says which of your sources
// already list it. Read-only.
export default defineEventHandler(async (event) => {
  const { from, q } = await getValidatedQuery(event, (v) => query.parse(v));
  const entries = cachedMovieEntries();
  const listedOn = (match: (ids: { tmdb?: number; mal?: number }) => boolean) => [
    ...new Set(entries.filter((e) => match(e.ids)).map((e) => e.source)),
  ];
  if (from === "tmdb") {
    const res = await useAdapters().tmdb.searchMovies(q);
    if (res.status !== "ok")
      throw createError({ statusCode: 502, statusMessage: res.error ?? `TMDB: ${res.status}` });
    return res.movies.map((m) => ({
      id: m.tmdb,
      title: m.title,
      year: m.year,
      detail: m.originalTitle,
      poster: m.poster,
      url: `https://www.themoviedb.org/movie/${m.tmdb}`,
      listedOn: listedOn((ids) => ids.tmdb === m.tmdb),
    }));
  }
  const res = await useAdapters().anilist.searchMovies(q);
  if (res.status !== "ok")
    throw createError({ statusCode: 502, statusMessage: res.error ?? `AniList: ${res.status}` });
  return res.media.map((media) => {
    const t = targetOf(media);
    const cover = (media.coverImage as { large?: unknown } | undefined)?.large;
    return {
      id: t.malId,
      title: t.title,
      year: t.year,
      detail:
        [t.format, t.episodes ? `${t.episodes} eps` : null].filter(Boolean).join(" · ") || null,
      poster: typeof cover === "string" ? cover : null,
      url: `https://myanimelist.net/anime/${t.malId}`,
      listedOn: listedOn((ids) => ids.mal === t.malId),
    };
  });
});
