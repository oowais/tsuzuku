import { z } from "zod";
import { useAdapters } from "../../adapters";
import { findMovieRow } from "../../lib/movie-mark";
import { loadMoviesCached } from "../../lib/movies-service";
import { MOVIE_SOURCES } from "../../lib/movies";

const query = z.object({ rowKey: z.string().min(1) });

// Titles to search with when linking a movie (#17): each source's own, and for an anime movie AniList's English
// and romaji titles (a MAL title is often romaji, which Trakt rarely finds). English first. No list is read.
export default defineEventHandler(async (event) => {
  const { rowKey } = await getValidatedQuery(event, (v) => query.parse(v));
  const row = findMovieRow(loadMoviesCached() ?? [], rowKey);
  if (!row) throw createError({ statusCode: 404, statusMessage: "Reload the page" });
  const titles: string[] = [];
  if (row.ids.mal) {
    const media = (await useAdapters().anilist.byMalIds([row.ids.mal])).media[row.ids.mal];
    const t = media?.title as { english?: string | null; romaji?: string | null } | undefined;
    if (t?.english) titles.push(t.english);
    if (t?.romaji) titles.push(t.romaji);
  }
  for (const s of MOVIE_SOURCES) {
    const title = row.cells[s].entry?.title;
    if (title) titles.push(title);
  }
  return { titles: [...new Set(titles)], year: row.year };
});
