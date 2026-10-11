import { z } from "zod";
import { useDb } from "../../db";
import { createMovieLinkStore } from "../../lib/movie-link-store";
import { linkFor, MovieLinkError } from "../../lib/movie-links";
import { findMovieRow } from "../../lib/movie-mark";
import { loadMovies, loadMoviesCached } from "../../lib/movies-service";

const body = z.object({
  rowKey: z.string().min(1),
  target: z.enum(["trakt", "mal"]),
  // The picked candidate's Trakt or MAL ID; looked up on the source again before it is stored.
  id: z.number().int().positive(),
});

// Links a movie on the Movies page to the Trakt movie or MAL entry you picked (#17).
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event));
  let row = findMovieRow(loadMoviesCached() ?? [], input.rowKey);
  if (!row) row = findMovieRow((await loadMovies()).rows, input.rowKey);
  if (!row)
    throw createError({ statusCode: 404, statusMessage: "This movie is no longer on Movies" });
  try {
    return createMovieLinkStore(useDb()).add(await linkFor(row, input.target, input.id));
  } catch (err) {
    if (err instanceof MovieLinkError)
      throw createError({ statusCode: 409, statusMessage: err.message });
    throw err;
  }
});
