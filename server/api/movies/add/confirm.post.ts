import { randomUUID } from "node:crypto";
import { z } from "zod";
import { useAdapters } from "../../../adapters";
import type { WriteResult } from "../../../adapters/common";
import { useDb } from "../../../db";
import { planMovieAdd } from "../../../lib/movie-add";
import { MovieAddError, resolvePick } from "../../../lib/movie-add-service";
import { createMovieLinkStore } from "../../../lib/movie-link-store";
import { loadMovies } from "../../../lib/movies-service";
import { createWriteLog } from "../../../lib/write-log";

const source = z.enum(["trakt", "simkl", "mal"]);
const body = z
  .object({
    // A movie on the page (add it where it is missing), or a search result.
    rowKey: z.string().min(1).optional(),
    from: z.enum(["tmdb", "anilist"]).optional(),
    id: z.number().int().positive().optional(),
    traktId: z.number().int().positive().optional(),
    steps: z.array(z.object({ source })).min(1),
  })
  .refine((v) => v.rowKey || (v.from && v.id), "A row or a search result is needed");

// Adds a searched movie to the confirmed sources' watchlists (#17). Every list is read again first; a source
// that has the movie by now (on a list or watched) is skipped, never moved. A Trakt movie you picked for an
// anime movie is kept as a link, so the sources' entries join on the Movies page.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event));
  let pick;
  try {
    pick = await resolvePick(input);
  } catch (err) {
    if (err instanceof MovieAddError)
      throw createError({ statusCode: 409, statusMessage: err.message });
    throw err;
  }
  const { entries } = await loadMovies();
  const plan = planMovieAdd(pick, entries);
  const { trakt, simkl, mal } = useAdapters();
  const log = createWriteLog(useDb());
  const markId = randomUUID();
  const outcomes: { source: z.infer<typeof source>; ok: boolean; error?: string }[] = [];

  for (const wanted of input.steps) {
    const step = plan.steps.find((s) => s.source === wanted.source);
    if (!step) {
      const skipped = plan.skipped.find((s) => s.source === wanted.source);
      outcomes.push({
        source: wanted.source,
        ok: false,
        error: skipped?.reason ?? "Changed since the preview; reload and check",
      });
      continue;
    }
    const w = step.write;
    const res: WriteResult =
      w.source === "trakt"
        ? await trakt.addMovieToWatchlist(w.ids)
        : w.source === "simkl"
          ? await simkl.addMovieToList(w.kind, w.ids)
          : await mal.planToWatch(w.mal);
    const anime = w.source === "mal" || (w.source === "simkl" && w.kind === "anime");
    log.add(
      step.source,
      "add_to_watchlist",
      {
        rowKey: input.rowKey ? `movie:${input.rowKey}` : `movie-add:${input.from}:${input.id}`,
        title: plan.title,
        episode: "Movie",
        summary: step.summary,
        expected: step.expected,
        write: w,
        link: {
          target: {
            source: step.source,
            kind: anime ? "anime" : "movie",
            ids: { traktSlug: plan.ids.traktSlug, mal: plan.ids.mal },
          },
          episode: { season: null, number: 1 },
        },
        listStatus: res.listStatus ?? null,
        markId,
      },
      res.ok ? null : (res.error ?? res.status),
    );
    outcomes.push({
      source: step.source,
      ok: res.ok,
      error: res.ok ? undefined : (res.error ?? res.status),
    });
  }

  // The Trakt movie you picked for an anime movie: a link, kept once a write went through.
  if (input.traktId && pick.ids.mal && outcomes.some((o) => o.ok)) {
    const store = createMovieLinkStore(useDb());
    const known = store.all().some((l) => l.traktId === input.traktId && l.malId === pick.ids.mal);
    if (!known)
      store.add({
        traktId: pick.ids.trakt ?? null,
        traktSlug: pick.ids.traktSlug ?? null,
        tmdbId: pick.ids.tmdb ?? null,
        imdbId: pick.ids.imdb ?? null,
        simklId: null,
        malId: pick.ids.mal,
        title: pick.year ? `${pick.title} (${pick.year})` : pick.title,
      });
  }
  return { outcomes };
});
