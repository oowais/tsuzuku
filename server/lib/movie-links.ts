import { useAdapters } from "../adapters";
import { targetOf } from "./next-season";

// Picking the Trakt movie for a movie on the page (#17, decision #14): candidates are real results of a search on
// the source, best first; the add flow looks a pick up again before writing it or keeping it as a link.

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
