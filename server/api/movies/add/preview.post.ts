import { z } from "zod";
import { planMovieAdd } from "../../../lib/movie-add";
import { MovieAddError, resolvePick } from "../../../lib/movie-add-service";
import { cachedMovieEntries } from "../../../lib/movies-service";

const body = z.object({
  from: z.enum(["tmdb", "anilist"]),
  id: z.number().int().positive(),
  traktId: z.number().int().positive().optional(),
});

// What adding a searched movie would do, per source (#17). Writes nothing; planned from the lists as last read.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event));
  try {
    return planMovieAdd(await resolvePick(input), cachedMovieEntries());
  } catch (err) {
    if (err instanceof MovieAddError)
      throw createError({ statusCode: 409, statusMessage: err.message });
    throw err;
  }
});
