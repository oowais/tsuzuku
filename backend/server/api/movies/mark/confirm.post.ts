import { randomUUID } from "node:crypto";
import { z } from "zod";
import { useAdapters } from "../../../adapters";
import type { WriteResult } from "../../../adapters/common";
import { useDb } from "../../../db";
import {
  findMovieRow,
  MovieMarkError,
  planMovieMark,
  type MovieMarkStep,
} from "../../../lib/movie-mark";
import { loadMovies } from "../../../lib/movies-service";
import { createWriteLog } from "../../../lib/write-log";

const source = z.enum(["trakt", "simkl", "mal"]);
const body = z.object({
  rowKey: z.string().min(1),
  // The steps you confirmed, each with what the source showed in the preview.
  steps: z.array(z.object({ source, expected: z.string() })).min(1),
  // The score (1-10) when you ticked one; it goes to every source written.
  rating: z.number().int().min(1).max(10).nullable().optional(),
  // Today in your own time zone, for MAL's start and finish dates.
  today: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export interface MovieMarkOutcome {
  source: z.infer<typeof source>;
  ok: boolean;
  error?: string;
  retryAfter?: number | null;
  listStatus?: string | null;
  // Trakt takes the score in a call of its own, after the mark: it can fail while the mark stood.
  ratingError?: string;
}

// Marks a movie watched on the confirmed sources (#17), one after another. Every list is read again first and a
// source is written only when it still shows what the preview showed; a recent write the source does not show
// yet is not repeated (Trakt takes duplicate plays). Each write goes to the log, under the row key prefixed
// `movie:` so it never matches a show's.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event));
  const { trakt, simkl, mal } = useAdapters();
  const log = createWriteLog(useDb());

  const row = findMovieRow((await loadMovies()).rows, input.rowKey);
  let fresh: MovieMarkStep[] = [];
  let planError: string | null = row ? null : "This movie is no longer on Movies";
  if (row) {
    try {
      fresh = planMovieMark(row).steps;
    } catch (err) {
      if (!(err instanceof MovieMarkError)) throw err;
      planError = err.message;
    }
  }

  const logKey = `movie:${input.rowKey}`;
  const markId = randomUUID();
  const outcomes: MovieMarkOutcome[] = [];
  for (const wanted of input.steps) {
    const step = fresh.find((s) => s.source === wanted.source);
    if (!step || step.expected !== wanted.expected) {
      outcomes.push({
        source: wanted.source,
        ok: false,
        error: planError ?? "Changed since the preview; reload and check",
      });
      continue;
    }
    const done = log.recentSuccess(step.source, logKey, step.expected);
    if (done) {
      outcomes.push({
        source: step.source,
        ok: false,
        error: `Already marked at ${done.at.toISOString().slice(0, 16).replace("T", " ")} UTC; the source has not caught up yet`,
      });
      continue;
    }

    const w = step.write;
    const now = new Date();
    const rating = input.rating ?? null;
    let res: WriteResult;
    let summary = step.summary;
    if (w.source === "trakt") res = await trakt.markMovieWatched(w.ids, now);
    else if (w.source === "simkl") res = await simkl.markMovieWatched(w.kind, w.ids, now, rating);
    else {
      // Start and finish date today, unless the entry already has them (as for a first and a last episode).
      const has = input.today && step.expected !== "none" ? await mal.listStatus(w.mal) : null;
      const unread = !!has?.error;
      const start = input.today && !unread && !has?.startDate ? input.today : null;
      const finish = input.today && !unread && !has?.finishDate ? input.today : null;
      res = await mal.setWatched(w.mal, w.episodes, "completed", { start, finish }, rating);
      if (start) summary = `${summary}, start date ${start}`;
      if (finish) summary = `${summary}, finish date ${finish}`;
    }
    if (rating && w.source !== "trakt") summary = `${summary}, rated ${rating}/10`;

    log.add(
      step.source,
      "mark_watched",
      {
        rowKey: logKey,
        title: step.title,
        episode: "Movie",
        summary,
        expected: step.expected,
        write: w,
        link: step.link,
        listStatus: res.listStatus ?? null,
        markId,
        images: row?.images ?? [],
      },
      res.ok ? null : (res.error ?? res.status),
    );
    const outcome: MovieMarkOutcome = {
      source: step.source,
      ok: res.ok,
      error: res.ok ? undefined : (res.error ?? res.status),
      retryAfter: res.retryAfter,
      listStatus: res.listStatus ?? null,
    };
    outcomes.push(outcome);

    if (res.ok && rating && w.source === "trakt") {
      const rated = await trakt.rateMovie(w.ids, rating, now);
      log.add(
        "trakt",
        "rate",
        {
          rowKey: logKey,
          title: step.title,
          episode: "Movie",
          summary: `Rated ${rating}/10`,
          expected: step.expected,
          write: { rating },
          link: step.link,
          markId,
          images: row?.images ?? [],
        },
        rated.ok ? null : (rated.error ?? rated.status),
      );
      if (!rated.ok) outcome.ratingError = rated.error ?? rated.status;
    }
  }
  return { outcomes };
});
