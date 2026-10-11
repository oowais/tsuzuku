// Adding a movie found by search (#17): what each source would do, planned from your lists. Nothing here writes;
// the confirm plans again from fresh lists and writes only steps that still match (decision #3). A movie already
// on a source's list, or watched there, is never moved: that source is skipped with the reason.
// - A TMDB pick has the TMDB (and IMDb) ID: Trakt's watchlist and Simkl's Plan to Watch take it directly. MAL only
//   when one of your entries ties it to a MAL entry.
// - An AniList pick has the MAL ID: MAL and Simkl take it directly. Trakt needs the TMDB ID, which AniList does
//   not have: from your lists when they tie it, else from a Trakt movie you pick among real search results.
// - A movie already on the page: the sources missing it, by the IDs its entries carry; a Trakt movie or MAL entry
//   you pick fills in what none of them has. Such a pick is kept as a link, so the entries stay on one card.

import type { MovieEntry, MovieIds, MovieSource } from "./movies";
import { MOVIE_SOURCES } from "./movies";

export interface MovieAddPick {
  from: "tmdb" | "anilist";
  title: string;
  year: number | null;
  ids: MovieIds;
  // The poster, for the write log: the row's, or TMDB's for a TMDB result (an AniList result has none here).
  images?: string[];
}

export type MovieAddWrite =
  | { source: "trakt"; ids: { trakt?: number; tmdb?: number; imdb?: string } }
  | {
      source: "simkl";
      kind: "movie" | "anime";
      ids: { tmdb?: number; imdb?: string; mal?: number };
    }
  | { source: "mal"; mal: number };

export interface MovieAddStep {
  source: MovieSource;
  summary: string;
  // Always "none": the source had nothing for this movie when planned.
  expected: "none";
  write: MovieAddWrite;
}

export interface MovieAddPlan {
  title: string;
  year: number | null;
  ids: MovieIds;
  anime: boolean;
  steps: MovieAddStep[];
  skipped: { source: MovieSource; reason: string }[];
  // An anime movie no list ties to Trakt: pick its Trakt movie to add it there.
  traktSearch: boolean;
  // No MAL entry is known for it: if it is an anime movie, pick its MAL entry to add it there.
  malSearch: boolean;
}

const LABELS: Record<MovieSource, string> = { trakt: "Trakt", simkl: "Simkl", mal: "MAL" };
const WHERE: Record<MovieEntry["state"], string> = {
  watchlist: "already on your list",
  watching: "already on Watching",
  watched: "already watched",
  dropped: "already there as Dropped",
  on_hold: "already there as On Hold",
};

// Entries that are this movie: sharing a TMDB, IMDb, Trakt or MAL ID with it.
function sameMovie(e: MovieEntry, ids: MovieIds): boolean {
  return (
    (!!ids.tmdb && e.ids.tmdb === ids.tmdb) ||
    (!!ids.imdb && e.ids.imdb === ids.imdb) ||
    (!!ids.trakt && e.ids.trakt === ids.trakt) ||
    (!!ids.mal && e.ids.mal === ids.mal)
  );
}

export function planMovieAdd(pick: MovieAddPick, entries: MovieEntry[]): MovieAddPlan {
  // The pick's IDs, with what your entries add (one round: Simkl ties TMDB and MAL together).
  const ids: MovieIds = { ...pick.ids };
  const matched = entries.filter((e) => sameMovie(e, pick.ids));
  for (const e of matched)
    for (const [k, v] of Object.entries(e.ids))
      (ids as Record<string, unknown>)[k] ??= v as unknown;
  for (const e of entries) if (!matched.includes(e) && sameMovie(e, ids)) matched.push(e);

  const anime = pick.from === "anilist" || !!ids.mal || matched.some((e) => e.anime);
  const plan: MovieAddPlan = {
    title: pick.title,
    year: pick.year,
    ids,
    anime,
    steps: [],
    skipped: [],
    traktSearch: false,
    malSearch: !ids.mal,
  };

  for (const source of MOVIE_SOURCES) {
    const e = matched.find((x) => x.source === source);
    if (e) {
      plan.skipped.push({
        source,
        reason: `${WHERE[e.state]}${e.title !== pick.title ? ` (${e.title})` : ""}`,
      });
      continue;
    }
    if (source === "trakt") {
      if (ids.trakt || ids.tmdb || ids.imdb)
        plan.steps.push({
          source,
          summary: "Add to watchlist",
          expected: "none",
          write: { source, ids: { trakt: ids.trakt, tmdb: ids.tmdb, imdb: ids.imdb } },
        });
      else {
        plan.traktSearch = true;
        plan.skipped.push({ source, reason: "pick its Trakt movie to add it there" });
      }
      continue;
    }
    if (source === "simkl") {
      plan.steps.push({
        source,
        summary: `Add to Plan to Watch (found by its ${anime && ids.mal ? "MAL" : "TMDB"} ID)`,
        expected: "none",
        write:
          anime && ids.mal
            ? { source, kind: "anime", ids: { mal: ids.mal, tmdb: ids.tmdb } }
            : { source, kind: "movie", ids: { tmdb: ids.tmdb, imdb: ids.imdb } },
      });
      continue;
    }
    if (ids.mal)
      plan.steps.push({
        source,
        summary: "Add to Plan to Watch",
        expected: "none",
        write: { source, mal: ids.mal },
      });
    else if (anime)
      plan.skipped.push({
        source,
        reason: `nothing ties it to a ${LABELS.mal} entry; add it from the anime search`,
      });
  }
  return plan;
}
