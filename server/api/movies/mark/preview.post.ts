import { z } from "zod";
import { findMovieRow, MovieMarkError, planMovieMark } from "../../../lib/movie-mark";
import { loadMovies, loadMoviesCached } from "../../../lib/movies-service";

const body = z.object({ rowKey: z.string().min(1) });

// What marking a movie watched would do, per source (#17). Writes nothing. Planned from the lists the page
// loaded; the confirm reads every source fresh before writing.
export default defineEventHandler(async (event) => {
  const { rowKey } = body.parse(await readBody(event));
  let row = findMovieRow(loadMoviesCached() ?? [], rowKey);
  if (!row) row = findMovieRow((await loadMovies()).rows, rowKey);
  if (!row)
    throw createError({
      statusCode: 404,
      statusMessage: "This movie is no longer on Movies; reload the page",
    });
  try {
    return planMovieMark(row);
  } catch (err) {
    if (err instanceof MovieMarkError)
      throw createError({ statusCode: 409, statusMessage: err.message });
    throw err;
  }
});
