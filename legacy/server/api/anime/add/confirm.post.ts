import { randomUUID } from "node:crypto";
import { z } from "zod";
import { useAdapters } from "../../../adapters";
import type { WriteResult } from "../../../adapters/common";
import { useDb } from "../../../db";
import { planAnimeAdd, StartError } from "../../../lib/next-season-service";
import { loadUpNext } from "../../../lib/up-next-service";
import { createWriteLog } from "../../../lib/write-log";

const source = z.enum(["simkl", "mal"]);
const body = z.object({
  malId: z.number().int().positive(),
  status: z.enum(["watching", "plan_to_watch"]),
  // The steps you confirmed, each with what the source showed in the preview.
  steps: z.array(z.object({ source, expected: z.string() })).min(1),
});

// Adds an anime you picked on Shows to MAL and Simkl, onto Watching or Plan to Watch: reads the lists and MAL's list
// status again, writes only the steps that still match the preview, and logs each write. No link is made: the
// season mapping is proposed through the normal flow once Trakt shows the show.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event));
  const { rows } = await loadUpNext();
  let plan;
  try {
    plan = await planAnimeAdd(rows, input.malId, input.status);
  } catch (err) {
    if (err instanceof StartError)
      throw createError({ statusCode: 409, statusMessage: err.message });
    throw err;
  }
  const target = plan.target!;
  const watching = input.status === "watching";
  const { mal, simkl } = useAdapters();
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
    const res: WriteResult =
      step.source === "mal"
        ? await (watching ? mal.startWatching(target.malId) : mal.planToWatch(target.malId))
        : await simkl.addAnimeToList(target.malId, watching ? "watching" : "plantowatch");
    log.add(
      step.source,
      watching ? "start_watching" : "add_to_watchlist",
      {
        rowKey: plan.rowKey,
        title: target.title,
        episode: watching ? "Watching" : "Plan to Watch",
        summary:
          step.source === "mal" && step.expected === "plan_to_watch"
            ? "Moved from Plan to Watch to Watching"
            : `Added to ${watching ? "Watching" : "Plan to Watch"}`,
        expected: step.expected,
        write: { source: step.source, mal: target.malId, status: input.status },
        ...(step.source === "mal"
          ? {
              link: {
                target: { source: "mal", kind: "anime" as const, ids: { mal: target.malId } },
                episode: { season: null, number: 1 },
              },
            }
          : {}),
        listStatus: res.listStatus ?? null,
        markId,
        images: target.cover ? [target.cover] : [],
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
