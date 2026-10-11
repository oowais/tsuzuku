// "Mark watched" for a movie (#17): what each source would do, planned from one row of the Movies page. Nothing
// here writes; the confirm plans again from fresh lists and writes only steps that still match (decision #3).
// A source with the movie on a list it is still to watch from is ticked by default; a source that has it on no
// list is offered unticked (it would be recorded there as watched); a source that already has it watched, set
// aside, or not linked is skipped with the reason.

import type { LinkTarget } from "../../shared/utils/source-links";
import type { MovieRow, MovieSource } from "./movies";
import { MOVIE_SOURCES, OPEN_STATES } from "./movies";

export type MovieWrite =
  | { source: "trakt"; ids: { trakt?: number; tmdb?: number; imdb?: string } }
  | {
      source: "simkl";
      // Anime movies go to Simkl as a whole show; other movies as movies (add-to-history reference).
      kind: "movie" | "anime";
      ids: { simkl?: number; tmdb?: number; imdb?: string; mal?: number };
    }
  // Completed with every episode watched (1 for nearly every movie).
  | { source: "mal"; mal: number; episodes: number };

export interface MovieMarkStep {
  source: MovieSource;
  // The source's own title, or the row's when the source does not list it.
  title: string;
  summary: string;
  // What the source showed when planned (its list status, or "none"); the confirm refuses the write if it moved.
  expected: string;
  // On none of that source's lists: offered, unticked.
  optional: boolean;
  // Your current score there, when the list says (Simkl, MAL).
  currentRating: number | null;
  write: MovieWrite;
  link: { target: LinkTarget; episode: { season: null; number: number } };
}

export interface MovieMarkPlan {
  rowKey: string;
  title: string;
  steps: MovieMarkStep[];
  skipped: { source: MovieSource; reason: string }[];
}

const LABELS: Record<MovieSource, string> = { trakt: "Trakt", simkl: "Simkl", mal: "MAL" };
const STATE_WORDS: Record<string, string> = {
  dropped: "dropped",
  on_hold: "on hold",
};

export class MovieMarkError extends Error {}

export function planMovieMark(row: MovieRow): MovieMarkPlan {
  const plan: MovieMarkPlan = { rowKey: row.key, title: row.title, steps: [], skipped: [] };
  for (const source of MOVIE_SOURCES) {
    const cell = row.cells[source];
    const e = cell.entry;
    if (cell.absent === "not_anime") continue;
    if (cell.absent === "not_linked") {
      plan.skipped.push({
        source,
        reason: `not linked; nothing ties this movie to ${LABELS[source]}`,
      });
      continue;
    }
    if (e && e.state === "watched") {
      plan.skipped.push({
        source,
        reason: `already watched${e.watchedAt ? ` (${e.watchedAt.slice(0, 10)})` : ""}`,
      });
      continue;
    }
    if (e && !OPEN_STATES.includes(e.state)) {
      plan.skipped.push({
        source,
        reason: `${STATE_WORDS[e.state] ?? e.state} on ${LABELS[source]}; change it there`,
      });
      continue;
    }
    const listed = !!e;
    const title = e?.title ?? row.title;
    const expected = e?.listStatus ?? "none";
    const anime = e?.anime ?? row.anime;
    const ids = e?.ids ?? row.ids;
    const target = (
      kind: LinkTarget["kind"],
      linkIds: LinkTarget["ids"],
    ): MovieMarkStep["link"] => ({
      target: { source, kind, ids: linkIds },
      episode: { season: null, number: 1 },
    });

    if (source === "trakt") {
      // On the watchlist: by its Trakt ID. Not listed: by the TMDB or IMDb ID another source gave.
      const write: MovieWrite = {
        source,
        ids: listed
          ? { trakt: ids.trakt! }
          : { trakt: row.ids.trakt, tmdb: row.ids.tmdb, imdb: row.ids.imdb },
      };
      plan.steps.push({
        source,
        title,
        summary: listed
          ? "Add to history, watched now; Trakt takes it off the watchlist"
          : "Not on your Trakt lists: add to history, watched now (found by its TMDB / IMDb ID)",
        expected,
        optional: !listed,
        currentRating: null,
        write,
        link: target("movie", { traktSlug: ids.traktSlug }),
      });
      continue;
    }

    if (source === "simkl") {
      const write: MovieWrite = {
        source,
        kind: anime ? "anime" : "movie",
        ids: listed
          ? { simkl: ids.simkl! }
          : anime
            ? { mal: row.ids.mal, tmdb: row.ids.tmdb }
            : { tmdb: row.ids.tmdb, imdb: row.ids.imdb },
      };
      plan.steps.push({
        source,
        title,
        summary: listed
          ? `Add to history, watched now; moves it from ${e!.listStatus === "watching" ? "Watching" : "Plan to Watch"} to Completed`
          : `Not on your Simkl lists: add to history as Completed (found by its ${anime ? "MAL" : "TMDB / IMDb"} ID)`,
        expected,
        optional: !listed,
        currentRating: e?.rating ?? null,
        write,
        link: target(anime ? "anime" : "movie", { simkl: ids.simkl, simklSlug: ids.simklSlug }),
      });
      continue;
    }

    const mal = ids.mal ?? row.ids.mal;
    if (!mal) continue;
    // MAL reports 0 episodes when it does not know; a movie is one.
    const episodes = e?.episodes && e.episodes > 0 ? e.episodes : 1;
    plan.steps.push({
      source,
      title,
      summary: listed
        ? `Completed, ${episodes} of ${episodes} watched (was ${e!.listStatus === "watching" ? "Watching" : "Plan to Watch"})`
        : `Not on your MAL list: add as Completed, ${episodes} of ${episodes} watched`,
      expected,
      optional: !listed,
      currentRating: e?.rating ?? null,
      write: { source, mal, episodes },
      link: target("anime", { mal }),
    });
  }
  if (!plan.steps.length && !plan.skipped.length)
    throw new MovieMarkError("Nothing to mark for this movie");
  return plan;
}

// A row of the fresh lists that is the same movie as the one planned: the same key, or holding the entry that
// gave the key (the row key is its first entry's, which stays while that entry does).
export function findMovieRow(rows: MovieRow[], rowKey: string): MovieRow | undefined {
  return (
    rows.find((r) => r.key === rowKey) ??
    rows.find((r) => MOVIE_SOURCES.some((s) => r.cells[s].entry?.key === rowKey))
  );
}
