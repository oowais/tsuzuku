import { useAdapters } from "../adapters";
import { targetOf } from "./next-season";
import type { MovieAddPick } from "./movie-add";
import { findMovieRow } from "./movie-mark";
import { loadMovies, loadMoviesCached } from "./movies-service";

export class MovieAddError extends Error {}

export interface PickInput {
  // A movie already on the Movies page: the sources missing it are offered, by the IDs its entries and your
  // links carry (after a link, or from the card's menu). Otherwise a search result:
  rowKey?: string;
  from?: "tmdb" | "anilist";
  // The TMDB ID, or the MAL ID of an AniList result.
  id?: number;
  // For an anime movie: the Trakt movie you picked for it.
  traktId?: number;
  // For a movie no MAL entry is known for: the one you picked (an anime movie).
  malId?: number;
}

// The picked movie, looked up again on the source it came from (and Trakt, for a Trakt movie you picked), so only
// real IDs are planned with.
export async function resolvePick(input: PickInput): Promise<MovieAddPick> {
  let pick: MovieAddPick;
  if (input.rowKey) {
    const row =
      findMovieRow(loadMoviesCached() ?? [], input.rowKey) ??
      findMovieRow((await loadMovies()).rows, input.rowKey);
    if (!row) throw new MovieAddError("This movie is no longer on Movies; reload the page");
    pick = {
      from: row.anime ? "anilist" : "tmdb",
      title: row.title,
      year: row.year,
      ids: { ...row.ids },
    };
  } else if (!input.from || !input.id) throw new MovieAddError("No movie picked");
  else if (input.from === "tmdb") {
    const res = await useAdapters().tmdb.movie(input.id);
    if (!res.movie)
      throw new MovieAddError(
        res.status === "ok"
          ? "TMDB does not know this movie"
          : (res.error ?? `TMDB: ${res.status}`),
      );
    const m = res.movie;
    pick = {
      from: "tmdb",
      title: m.title,
      year: m.year,
      ids: { tmdb: m.tmdb, ...(m.imdb ? { imdb: m.imdb } : {}) },
    };
  } else {
    const lookup = await useAdapters().anilist.byMalIds([input.id]);
    const media = lookup.media[input.id];
    if (!media)
      throw new MovieAddError(
        lookup.status === "ok"
          ? "AniList does not know this MAL entry"
          : (lookup.error ?? `AniList: ${lookup.status}`),
      );
    const t = targetOf(media);
    pick = {
      from: "anilist",
      title: t.title,
      year: t.year,
      ids: { mal: t.malId, ...(t.anilistId ? { anilist: t.anilistId } : {}) },
    };
  }
  if (input.malId) {
    const lookup = await useAdapters().anilist.byMalIds([input.malId]);
    const media = lookup.media[input.malId];
    if (!media)
      throw new MovieAddError(
        lookup.status === "ok"
          ? "AniList does not know this MAL entry"
          : (lookup.error ?? `AniList: ${lookup.status}`),
      );
    const t = targetOf(media);
    pick.ids = { ...pick.ids, mal: t.malId, ...(t.anilistId ? { anilist: t.anilistId } : {}) };
  }
  if (input.traktId) {
    const res = await useAdapters().traktPublic.movie(input.traktId);
    if (!res.data || res.data.trakt !== input.traktId)
      throw new MovieAddError(
        res.status === "ok"
          ? "Trakt does not know this movie"
          : (res.error ?? `Trakt: ${res.status}`),
      );
    const m = res.data;
    pick.ids = {
      ...pick.ids,
      trakt: m.trakt,
      traktSlug: m.slug,
      ...(m.tmdb ? { tmdb: m.tmdb } : {}),
      ...(m.imdb ? { imdb: m.imdb } : {}),
    };
  }
  return pick;
}
