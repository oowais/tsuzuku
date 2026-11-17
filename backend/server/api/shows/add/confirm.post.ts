import { randomUUID } from "node:crypto";
import { z } from "zod";
import { useAdapters } from "../../../adapters";
import type { WriteResult } from "../../../adapters/common";
import { useDb } from "../../../db";
import { planShowAdd, ShowAddError, writeIds } from "../../../lib/show-add-service";
import { loadUpNext } from "../../../lib/up-next-service";
import { createWriteLog } from "../../../lib/write-log";

const source = z.enum(["trakt", "simkl"]);
const body = z.object({
  traktId: z.number().int().positive(),
  status: z.enum(["watching", "plan_to_watch"]),
  // The steps you confirmed, each with what the source showed in the preview.
  steps: z.array(z.object({ source, expected: z.string() })).min(1),
});

// Adds a show you picked on Shows to Trakt and Simkl (#105): Plan to Watch puts it on Trakt's watchlist and Simkl's
// Plan to Watch; Watching marks S1E1 watched on both (Simkl files it under Watching). Reads the lists again, writes
// only the steps that still match the preview, refuses a repeat of a recent mark, and logs each write.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event));
  const { rows } = await loadUpNext();
  let plan;
  try {
    plan = await planShowAdd(rows, input.traktId, input.status);
  } catch (err) {
    if (err instanceof ShowAddError)
      throw createError({ statusCode: 409, statusMessage: err.message });
    throw err;
  }
  const target = plan.target;
  const ids = writeIds(target);
  const watching = input.status === "watching";
  const action = watching ? "mark_watched" : "add_to_watchlist";
  const { trakt, simkl } = useAdapters();
  const log = createWriteLog(useDb());
  const markId = randomUUID();
  const outcomes: { source: z.infer<typeof source>; ok: boolean; error?: string }[] = [];

  for (const wanted of input.steps) {
    const step = plan.steps.find((s) => s.source === wanted.source);
    if (!step || step.expected !== wanted.expected) {
      const skipped = plan.skipped.find((s) => s.source === wanted.source);
      outcomes.push({
        source: wanted.source,
        ok: false,
        error: skipped?.reason ?? "Changed since the preview; reload and check",
      });
      continue;
    }
    // A source can be slow to show a mark, and Trakt does not reject duplicate plays.
    const done = watching ? log.recentSuccess(step.source, plan.rowKey, step.expected) : null;
    if (done) {
      outcomes.push({
        source: step.source,
        ok: false,
        error: `Already marked at ${done.at.toISOString().slice(0, 16).replace("T", " ")} UTC; the source has not caught up yet`,
      });
      continue;
    }
    const now = new Date();
    const first = { season: 1, number: 1 };
    let res: WriteResult;
    if (step.source === "trakt")
      res = watching
        ? await trakt.markWatched(target.trakt, first, now)
        : await trakt.addShowToWatchlist(ids);
    else
      res = watching
        ? await simkl.markWatched("show", ids, first, now, "watching")
        : await simkl.addShowToList(ids, "plantowatch");
    log.add(
      step.source,
      action,
      {
        rowKey: plan.rowKey,
        title: target.title,
        episode: watching ? "S1E1" : "Plan to Watch",
        summary: watching ? "Marked S1E1 watched" : "Added to Plan to Watch",
        expected: step.expected,
        write: { source: step.source, ids, status: input.status },
        ...(step.source === "trakt"
          ? {
              link: {
                target: { source: "trakt", kind: "show" as const, ids: { traktSlug: target.slug } },
                episode: watching ? first : { season: null, number: 0 },
              },
            }
          : {}),
        listStatus: res.listStatus ?? null,
        markId,
        images: target.poster ? [target.poster] : [],
      },
      res.ok ? null : (res.error ?? res.status),
    );
    outcomes.push({
      source: step.source,
      ok: res.ok,
      error: res.ok ? undefined : (res.error ?? res.status),
    });
  }
  return { outcomes };
});
