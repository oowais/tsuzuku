import { useAdapters } from "../adapters";
import { isDemo } from "../demo";
import {
  applyLinks,
  buildMovieRows,
  movieEntriesFrom,
  type MovieEntry,
  type MovieLists,
  type MovieRow,
} from "./movies";
import { useDb } from "../db";
import { createMovieLinkStore } from "./movie-link-store";
import { useSourceWrapper } from "./source-wrapper";

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
  const links = createMovieLinkStore(useDb()).all();
  const rows = await withTitles(buildMovieRows(entries, links));
  // The fictional movies have no source posters; demo mode draws one per row.
  if (isDemo()) withDemoPosters(rows);
  return {
    rows,
    // Every entry, watched ones too, with your links' IDs.
    entries: applyLinks(entries, links),
    errors,
    results: { trakt: traktRes, simkl: simklRes, mal: malRes },
  };
}

// Each row's demo poster by its key's place in key order, shifted so Movies does not start on the covers Shows starts on:
// neighbours get different covers, and a row keeps its cover when the list reorders.
function withDemoPosters(rows: MovieRow[]) {
  const order = rows.map((r) => r.key).sort();
  for (const r of rows)
    r.images = [
      `/_demo/poster?n=${order.indexOf(r.key) + 7}&key=${encodeURIComponent(r.key)}&title=${encodeURIComponent(r.title)}`,
    ];
}

// The rows from the lists as last fetched, without calling a source: for the mark preview, which then opens at
// once. The confirm reads every source fresh. Null when a list was never fetched.
export function loadMoviesCached(): MovieRow[] | null {
  const wrapper = useSourceWrapper();
  const lists = {
    trakt: wrapper.readCache("trakt", "movies"),
    simkl: wrapper.readCache("simkl", "movies"),
    mal: wrapper.readCache("mal", "movies"),
  } as MovieLists;
  if (!lists.trakt || !lists.simkl || !lists.mal) return null;
  const rows = buildMovieRows(movieEntriesFrom(lists).entries, createMovieLinkStore(useDb()).all());
  if (isDemo()) withDemoPosters(rows);
  return rows;
}

// Every entry from the lists as last fetched, with your links' IDs, without calling a source (the add preview).
export function cachedMovieEntries(): MovieEntry[] {
  const wrapper = useSourceWrapper();
  const { entries } = movieEntriesFrom({
    trakt: wrapper.readCache("trakt", "movies"),
    simkl: wrapper.readCache("simkl", "movies"),
    mal: wrapper.readCache("mal", "movies"),
  } as MovieLists);
  return applyLinks(entries, createMovieLinkStore(useDb()).all());
}

// English titles first, as everywhere in Tsuzuku, with an anime movie's romaji beside it: Trakt's title is English;
// for anime, AniList's English and romaji titles (cached a week, one batched call for new ones). Simkl and MAL
// mostly title anime in romaji. When AniList cannot be asked, the cards keep the sources' own titles.
async function withTitles(rows: MovieRow[]): Promise<MovieRow[]> {
  const malIds = rows.filter((r) => r.anime && r.ids.mal).map((r) => r.ids.mal!);
  const media = malIds.length ? (await useAdapters().anilist.byMalIds(malIds)).media : {};
  for (const r of rows) {
    const t = (r.ids.mal ? media[r.ids.mal]?.title : undefined) as
      | { english?: string | null; romaji?: string | null }
      | undefined;
    const english = r.cells.trakt.entry?.title || t?.english || null;
    const romaji = r.anime ? t?.romaji || r.cells.mal.entry?.title || null : null;
    if (english) r.title = english;
    else if (romaji) r.title = romaji;
    r.altTitle = romaji && romaji.toLowerCase() !== r.title.toLowerCase() ? romaji : null;
  }
  return rows;
}
