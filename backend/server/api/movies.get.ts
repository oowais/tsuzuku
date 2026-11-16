import { loadMovies } from "../lib/movies-service";

// The Movies page (#17): one row per movie still to watch on some source, each source with its own title and
// state, and each source's fetch status.
export default defineEventHandler(async () => {
  const { rows, errors, results } = await loadMovies();
  const sources = Object.fromEntries(
    Object.entries(results).map(([source, r]) => [
      source,
      {
        status: r.status,
        stale: r.stale,
        fetchedAt: r.fetchedAt,
        retryAfter: r.retryAfter,
        error: r.error,
      },
    ]),
  );
  return { rows, sources, errors };
});
