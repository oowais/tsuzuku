import { z } from "zod";
import { planAnimeAdd, StartError } from "../../../lib/next-season-service";
import { loadUpNext, loadUpNextCached } from "../../../lib/up-next-service";

const body = z.object({
  malId: z.number().int().positive(),
  status: z.enum(["watching", "plan_to_watch"]),
});

// What adding an anime you picked on Shows would do, per source: MAL and Simkl, onto Watching or Plan to Watch.
// Writes nothing. Reads MAL's list status for the entry, so an entry already on your MAL list is never moved; the
// confirm reads it again.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event));
  const rows = loadUpNextCached() ?? (await loadUpNext()).rows;
  try {
    return await planAnimeAdd(rows, input.malId, input.status);
  } catch (err) {
    if (err instanceof StartError)
      throw createError({ statusCode: 409, statusMessage: err.message });
    throw err;
  }
});
