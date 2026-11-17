import { useAdapters } from "../adapters";
import type { TraktShow } from "../adapters/trakt-public";
import type { Row } from "./up-next";

// Adding a show that is not anime from Shows (#105): a Trakt show you picked from Trakt's search, onto Plan to
// Watch (Trakt watchlist, Simkl Plan to Watch) or Watching (S1E1 marked watched on Trakt and on Simkl, which files
// it under Watching). MAL is not offered: it lists anime only. Its row key is `show-add:<Trakt ID>`.
export const SHOW_ADD_PREFIX = "show-add:";

export type ShowAddStatus = "watching" | "plan_to_watch";
export type ShowAddSource = "trakt" | "simkl";

export interface ShowAddTarget {
  trakt: number;
  slug: string;
  title: string;
  year: number | null;
  tmdb: number | null;
  // Season 1's poster on Trakt, for the Log page.
  poster: string | null;
}

export interface ShowAddStep {
  source: ShowAddSource;
  summary: string;
  // What the source showed when planned; the confirm refuses the write if it has moved since.
  expected: string;
}

export interface ShowAddPlan {
  rowKey: string;
  title: string;
  target: ShowAddTarget;
  steps: ShowAddStep[];
  skipped: { source: ShowAddSource; reason: string }[];
}

export class ShowAddError extends Error {}

// The IDs a write sends: Trakt's own, and TMDB's for Simkl to resolve the show by.
export const writeIds = (t: ShowAddTarget) => ({
  trakt: t.trakt,
  ...(t.tmdb !== null ? { tmdb: t.tmdb } : {}),
});

const onTrakt = (rows: Row[], t: ShowAddTarget) =>
  rows.some((r) => r.cells.trakt?.entry?.ids.trakt === t.trakt);

const onSimkl = (rows: Row[], t: ShowAddTarget) =>
  rows.some((r) => {
    const ids = r.cells.simkl?.entry?.ids;
    return (
      !!ids &&
      (ids.trakt === t.trakt ||
        ids.traktSlug === t.slug ||
        (t.tmdb !== null && ids.tmdb === t.tmdb))
    );
  });

// What each source would do. Trakt's up next and Simkl's Watching list (both as last read for Shows) say whether
// the show is already there; a show on either is never moved back. Trakt's watchlist and Simkl's other lists are not
// read: adding to Trakt's watchlist twice counts as done, and Simkl's add moves an entry from another list, which
// the step says.
export async function planShowAdd(
  rows: Row[],
  trakt: number,
  status: ShowAddStatus,
): Promise<ShowAddPlan> {
  const { traktPublic } = useAdapters();
  const found = await traktPublic.showById(trakt);
  const show: TraktShow | null = found.data;
  if (!show)
    throw new ShowAddError(
      found.status === "ok" ? "Trakt does not know this show" : "Could not read the show on Trakt",
    );
  const seasons = (await traktPublic.seasons(trakt)).data ?? [];
  const first = seasons.find((s) => s.number === 1);
  const target: ShowAddTarget = {
    trakt: show.trakt,
    slug: show.slug,
    title: show.title,
    year: show.year,
    tmdb: show.tmdb,
    poster: first?.poster ?? null,
  };
  if (status === "watching" && !((first?.airedEpisodes ?? first?.episodeCount ?? 0) > 0))
    throw new ShowAddError(
      "Trakt lists no aired season 1 episode 1 for this show; add it to Plan to Watch instead",
    );

  const plan: ShowAddPlan = {
    rowKey: `${SHOW_ADD_PREFIX}${target.trakt}`,
    title: target.title,
    target,
    steps: [],
    skipped: [],
  };
  const watching = status === "watching";

  if (onTrakt(rows, target))
    plan.skipped.push({ source: "trakt", reason: "already on your Trakt up next" });
  else
    plan.steps.push({
      source: "trakt",
      summary: watching
        ? "Mark S1E1 watched; Trakt adds a play even if you watched it before"
        : "Add to your watchlist",
      expected: "not_on_up_next",
    });

  if (onSimkl(rows, target))
    plan.skipped.push({ source: "simkl", reason: "already on your Simkl Watching list" });
  else
    plan.steps.push({
      source: "simkl",
      summary: watching
        ? "Mark S1E1 watched and put it on Watching (found by its Trakt ID); moves it there if it is on another Simkl list"
        : "Add to Plan to Watch (found by its Trakt ID); moves it there if it is on another Simkl list",
      expected: "not_watching",
    });

  return plan;
}
