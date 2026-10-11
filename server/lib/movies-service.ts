import { useAdapters } from "../adapters";
import { isDemo } from "../demo";
import { buildMovieRows, movieEntriesFrom, type MovieRow } from "./movies";

// Reads the three sources' movie lists side by side and builds the Movies rows (#17). One failing source never
// blanks the page: its last good lists are used, marked stale, or its column stays empty.
export async function loadMovies() {
  const { trakt, simkl, mal } = useAdapters();
  const [traktRes, simklRes, malRes] = await Promise.all([
    trakt.fetchMovieLists(),
    simkl.fetchMovies(),
    mal.fetchMovies(),
  ]);
  const { entries, errors } = movieEntriesFrom({
    trakt: traktRes.data,
    simkl: simklRes.data,
    mal: malRes.data,
  });
  const rows = buildMovieRows(entries);
  // The fictional movies have no source posters; demo mode draws one per row.
  if (isDemo()) for (const r of rows) r.images = [demoPoster(r)];
  return { rows, errors, results: { trakt: traktRes, simkl: simklRes, mal: malRes } };
}

const demoPoster = (r: MovieRow) =>
  `/_demo/poster?key=${encodeURIComponent(r.key)}&title=${encodeURIComponent(r.title)}`;
