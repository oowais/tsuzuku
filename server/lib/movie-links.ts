import { useAdapters } from "../adapters";
import { targetOf } from "./next-season";
import type { MovieRow } from "./movies";

// Linking a movie by hand (#17, decision #14): candidates are real results of a search on the source (Trakt movie
// search, or AniList's anime movies for MAL), and a pick is looked up again on that source before its IDs are
// stored. Nothing is linked without your pick.

export type LinkTarget = "trakt" | "mal";

export interface MovieCandidate {
  id: number;
  title: string;
  year: number | null;
  // What else the source says, for telling candidates apart.
  detail: string | null;
  url: string;
  // Already on one of your lists of that source.
  onList: boolean;
}

export class MovieLinkError extends Error {}

// Best first: on your lists, then the row's year, then the source's own order.
export function rankCandidates(candidates: MovieCandidate[], year: number | null) {
  const score = (c: MovieCandidate) => (c.onList ? 2 : 0) + (year && c.year === year ? 1 : 0);
  return candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => score(b.c) - score(a.c) || a.i - b.i)
    .map(({ c }) => c);
}

export async function searchCandidates(
  target: LinkTarget,
  query: string,
  year: number | null,
  listed: { trakt: Set<number>; mal: Set<number> },
): Promise<MovieCandidate[]> {
  if (target === "trakt") {
    const res = await useAdapters().traktPublic.searchMovies(query);
    if (res.status !== "ok") throw new MovieLinkError(res.error ?? `Trakt: ${res.status}`);
    return rankCandidates(
      res.data.map((m) => ({
        id: m.trakt,
        title: m.title,
        year: m.year,
        detail: null,
        url: `https://trakt.tv/movies/${m.slug}`,
        onList: listed.trakt.has(m.trakt),
      })),
      year,
    );
  }
  const res = await useAdapters().anilist.searchMovies(query);
  if (res.status !== "ok") throw new MovieLinkError(res.error ?? `AniList: ${res.status}`);
  return rankCandidates(
    res.media.map((m) => {
      const t = targetOf(m);
      return {
        id: t.malId,
        title: t.title,
        year: t.year,
        detail:
          [t.format, t.episodes ? `${t.episodes} eps` : null].filter(Boolean).join(" · ") || null,
        url: `https://myanimelist.net/anime/${t.malId}`,
        onList: listed.mal.has(t.malId),
      };
    }),
    year,
  );
}

// The IDs to store for linking `row` to the picked movie on `target`: the pick's, read again from the source,
// and the row's own entries' (so each of them is named by the link).
export async function linkFor(row: MovieRow, target: LinkTarget, id: number) {
  if (row.cells[target].entry)
    throw new MovieLinkError(
      `This movie already has a ${target === "trakt" ? "Trakt" : "MAL"} entry`,
    );
  const own = {
    traktId: row.cells.trakt.entry?.ids.trakt ?? null,
    traktSlug: row.cells.trakt.entry?.ids.traktSlug ?? null,
    tmdbId: row.cells.trakt.entry?.ids.tmdb ?? null,
    imdbId: row.cells.trakt.entry?.ids.imdb ?? null,
    simklId: row.cells.simkl.entry?.ids.simkl ?? null,
    malId: row.cells.mal.entry?.ids.mal ?? null,
  };
  if (target === "trakt") {
    const res = await useAdapters().traktPublic.movie(id);
    if (!res.data || res.data.trakt !== id)
      throw new MovieLinkError(
        res.status === "ok"
          ? "Trakt does not know this movie"
          : (res.error ?? `Trakt: ${res.status}`),
      );
    const m = res.data;
    return {
      ...own,
      traktId: m.trakt,
      traktSlug: m.slug,
      tmdbId: m.tmdb,
      imdbId: m.imdb,
      title: m.year ? `${m.title} (${m.year})` : m.title,
    };
  }
  const lookup = await useAdapters().anilist.byMalIds([id]);
  const media = lookup.media[id];
  if (!media)
    throw new MovieLinkError(
      lookup.status === "ok"
        ? "AniList does not know this MAL entry"
        : (lookup.error ?? `AniList: ${lookup.status}`),
    );
  const t = targetOf(media);
  return { ...own, malId: t.malId, title: t.year ? `${t.title} (${t.year})` : t.title };
}
