import { z } from "zod";
import { planShowAdd, ShowAddError } from "../../../lib/show-add-service";
import { loadUpNext, loadUpNextCached } from "../../../lib/up-next-service";

const body = z.object({
  traktId: z.number().int().positive(),
  status: z.enum(["watching", "plan_to_watch"]),
});

// What adding a show you picked from Trakt's search on Shows would do, per source (#105): Trakt and Simkl, onto
// Plan to Watch (Trakt watchlist, Simkl Plan to Watch) or Watching (S1E1 marked watched on both). Writes nothing;
// the confirm reads the lists again.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event));
  const rows = loadUpNextCached() ?? (await loadUpNext()).rows;
  try {
    return await planShowAdd(rows, input.traktId, input.status);
  } catch (err) {
    if (err instanceof ShowAddError)
      throw createError({ statusCode: 409, statusMessage: err.message });
    throw err;
  }
});
