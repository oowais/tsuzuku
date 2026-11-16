// The Movies page (#17, decision #25): what is on each source's movie lists, one row per movie, each source with
// its own title and state. Built from the raw list answers (shapes in docs/context.md); nothing is merged into
// one value and no difference is resolved (decision #2).

import { isMovieFormat } from "../../shared/utils/formats";
import { httpsUrl, simklPoster } from "./entries";

export type MovieSource = "trakt" | "simkl" | "mal";
export const MOVIE_SOURCES: MovieSource[] = ["trakt", "simkl", "mal"];

// Where the movie is on a source, in common words: on the watchlist (Trakt watchlist, Simkl and MAL Plan to
// Watch), watching (Simkl anime and MAL only), watched, or set aside (dropped, on hold).
export type MovieState = "watchlist" | "watching" | "watched" | "dropped" | "on_hold";
export const OPEN_STATES: MovieState[] = ["watchlist", "watching"];

export interface MovieIds {
  trakt?: number;
  traktSlug?: string;
  simkl?: number;
  // For links only.
  simklSlug?: string;
  mal?: number;
  anilist?: number;
  tmdb?: number;
  imdb?: string;
}

export interface MovieEntry {
  source: MovieSource;
  // `${source}:${id}`.
  key: string;
  title: string;
  year: number | null;
  // Simkl's anime list or MAL. Trakt has no anime flag.
  anime: boolean;
  ids: MovieIds;
  state: MovieState;
  // The source's own word for it (Trakt `watchlist` / `watched`, Simkl and MAL list statuses).
  listStatus: string;
  // Trakt only: watched before and on the watchlist again.
  watchedBefore?: boolean;
  addedAt: string | null;
  watchedAt: string | null;
  image: string | null;
  // Your score, 1-10 (Simkl `user_rating`, MAL `score`; MAL's 0 means none). Null when unrated or unknown
  // (Trakt's lists carry none).
  rating: number | null;
  // MAL only: the entry's episode count (`num_episodes`, 0 when unknown), for a mark that completes it.
  episodes?: number | null;
  // Links you confirmed that name this entry (set by applyLinks).
  linkIds?: number[];
}

export interface MovieLists {
  // Trakt keeps the watchlist and what you watched apart (GET /sync/watchlist/movies, GET /sync/watched/movies).
  trakt?: { watchlist?: unknown[]; watched?: unknown[] } | null;
  // Every Simkl list: movies under `movies`, anime movies (`anime_type` movie) under `anime`.
  simkl?: { movies?: unknown[]; anime?: unknown[] } | null;
  // Your MAL list, every status; only `media_type` movie is used.
  mal?: { data?: unknown[] } | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
// Simkl sends most external IDs as strings, Trakt as numbers.
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : undefined;
};
const firstOf = (v: unknown) => (Array.isArray(v) ? v[0] : undefined);
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

const SIMKL_STATES: Record<string, MovieState> = {
  plantowatch: "watchlist",
  watching: "watching",
  completed: "watched",
  dropped: "dropped",
  hold: "on_hold",
};
const MAL_STATES: Record<string, MovieState> = {
  plan_to_watch: "watchlist",
  watching: "watching",
  completed: "watched",
  dropped: "dropped",
  on_hold: "on_hold",
};

// A Trakt list item: `{ listed_at, movie }` on the watchlist, `{ last_watched_at, movie }` among the watched.
function traktMovie(raw: unknown) {
  const item = obj(raw);
  const movie = obj(item.movie);
  const ids = obj(movie.ids);
  const trakt = num(ids.trakt);
  if (!trakt) throw new Error("Trakt movie without movie.ids.trakt");
  return {
    trakt,
    title: str(movie.title) ?? "",
    year: num(movie.year) ?? null,
    ids: compact({
      trakt,
      traktSlug: str(ids.slug),
      tmdb: num(ids.tmdb),
      imdb: str(ids.imdb),
    }),
    image: httpsUrl(firstOf(obj(movie.images).poster)),
    listedAt: str(item.listed_at) ?? null,
    watchedAt: str(item.last_watched_at) ?? null,
  };
}

// The watchlist first: a movie on it is open, even when you watched it before.
export function traktMovieEntries(lists: MovieLists["trakt"]): MovieEntry[] {
  const out = new Map<number, MovieEntry>();
  const watched = new Map<number, string | null>();
  for (const raw of lists?.watched ?? []) {
    const m = traktMovie(raw);
    watched.set(m.trakt, m.watchedAt);
    out.set(m.trakt, {
      source: "trakt",
      key: `trakt:${m.trakt}`,
      title: m.title,
      year: m.year,
      anime: false,
      ids: m.ids,
      state: "watched",
      listStatus: "watched",
      addedAt: null,
      watchedAt: m.watchedAt,
      image: m.image,
      rating: null,
    });
  }
  for (const raw of lists?.watchlist ?? []) {
    const m = traktMovie(raw);
    const before = watched.has(m.trakt);
    out.set(m.trakt, {
      source: "trakt",
      key: `trakt:${m.trakt}`,
      title: m.title,
      year: m.year,
      anime: false,
      ids: m.ids,
      state: "watchlist",
      listStatus: "watchlist",
      ...(before ? { watchedBefore: true } : {}),
      addedAt: m.listedAt,
      watchedAt: watched.get(m.trakt) ?? null,
      image: m.image ?? out.get(m.trakt)?.image ?? null,
      rating: null,
    });
  }
  return [...out.values()];
}

// A Simkl item: movies carry `movie`, anime `show` and `anime_type`.
export function simklMovieEntry(raw: unknown, anime: boolean): MovieEntry | null {
  const item = obj(raw);
  if (anime && !isMovieFormat(str(item.anime_type))) return null;
  const media = obj(anime ? item.show : item.movie);
  const ids = obj(media.ids);
  const simkl = num(ids.simkl);
  if (!simkl) throw new Error(`Simkl item without ${anime ? "show" : "movie"}.ids.simkl`);
  const status = str(item.status) ?? "";
  const state = SIMKL_STATES[status];
  if (!state) return null;
  return {
    source: "simkl",
    key: `simkl:${simkl}`,
    title: str(media.title) ?? "",
    year: num(media.year) ?? null,
    anime,
    ids: compact({
      simkl,
      simklSlug: str(ids.slug),
      traktSlug: str(ids.traktslug),
      mal: num(ids.mal),
      anilist: num(ids.anilist),
      tmdb: num(ids.tmdb),
      imdb: str(ids.imdb),
    }),
    state,
    listStatus: status,
    addedAt: str(item.added_to_watchlist_at) ?? null,
    watchedAt: state === "watched" ? (str(item.last_watched_at) ?? null) : null,
    image: simklPoster(media.poster),
    rating: num(item.user_rating) ?? null,
  };
}

export function malMovieEntry(raw: unknown): MovieEntry | null {
  const item = obj(raw);
  const node = obj(item.node);
  const list = obj(item.list_status);
  if (!isMovieFormat(str(node.media_type))) return null;
  const mal = num(node.id);
  if (!mal) throw new Error("MAL item without node.id");
  const status = str(list.status) ?? "";
  const state = MAL_STATES[status];
  if (!state) return null;
  const year = num(obj(node.start_season).year) ?? num(str(node.start_date)?.slice(0, 4)) ?? null;
  return {
    source: "mal",
    key: `mal:${mal}`,
    title: str(node.title) ?? "",
    year,
    anime: true,
    ids: { mal },
    state,
    listStatus: status,
    // MAL has no "added" time; `updated_at` is the last change to the entry.
    addedAt: str(list.updated_at) ?? null,
    watchedAt: state === "watched" ? (str(list.finish_date) ?? null) : null,
    image: httpsUrl(obj(node.main_picture).large) ?? httpsUrl(obj(node.main_picture).medium),
    rating: num(list.score) ?? null,
    episodes: num(node.num_episodes) ?? null,
  };
}

// An item that cannot be read is reported and skipped, so one odd item never hides the rest.
export function movieEntriesFrom(lists: MovieLists): {
  entries: MovieEntry[];
  errors: { source: MovieSource; error: string }[];
} {
  const entries: MovieEntry[] = [];
  const errors: { source: MovieSource; error: string }[] = [];
  const read = (source: MovieSource, fn: () => MovieEntry | MovieEntry[] | null) => {
    try {
      const got = fn();
      if (Array.isArray(got)) entries.push(...got);
      else if (got) entries.push(got);
    } catch (err) {
      errors.push({ source, error: err instanceof Error ? err.message : String(err) });
    }
  };
  read("trakt", () => traktMovieEntries(lists.trakt));
  for (const raw of lists.simkl?.movies ?? []) read("simkl", () => simklMovieEntry(raw, false));
  for (const raw of lists.simkl?.anime ?? []) read("simkl", () => simklMovieEntry(raw, true));
  for (const raw of lists.mal?.data ?? []) read("mal", () => malMovieEntry(raw));
  return { entries, errors };
}

// Why a source has nothing in a row: the row carries an ID that source's lists would have matched, so the movie
// is not on them; nothing ties the row to that source yet; or MAL, for a movie that is not anime.
export type MovieAbsence = "not_listed" | "not_linked" | "not_anime";

export interface MovieCell {
  entry: MovieEntry | null;
  absent: MovieAbsence | null;
}

// A link you confirmed (#17): IDs from different sources that are one movie. Only the ID fields are read here.
export interface MovieLink {
  id: number;
  traktId: number | null;
  traktSlug: string | null;
  tmdbId: number | null;
  imdbId: string | null;
  simklId: number | null;
  malId: number | null;
}

const linkIds = (l: MovieLink): MovieIds =>
  Object.fromEntries(
    Object.entries({
      trakt: l.traktId,
      traktSlug: l.traktSlug,
      tmdb: l.tmdbId,
      imdb: l.imdbId,
      simkl: l.simklId,
      mal: l.malId,
    }).filter(([, v]) => v !== null),
  ) as MovieIds;

// Whether an entry is one of the movies a link names: the same ID from the same kind of source. A Trakt entry is
// matched by its Trakt, TMDB or IMDb ID, a Simkl one by its Simkl ID, a MAL one by its MAL ID.
function linkNames(e: MovieEntry, l: MovieLink): boolean {
  if (e.source === "trakt")
    return (
      (!!l.traktId && e.ids.trakt === l.traktId) ||
      (!!l.tmdbId && e.ids.tmdb === l.tmdbId) ||
      (!!l.imdbId && e.ids.imdb === l.imdbId)
    );
  if (e.source === "simkl") return !!l.simklId && e.ids.simkl === l.simklId;
  return !!l.malId && e.ids.mal === l.malId;
}

// Entries a link names get the link's IDs (theirs win), so grouping joins them and a source without the movie
// can be written by those IDs.
export function applyLinks(entries: MovieEntry[], links: MovieLink[]): MovieEntry[] {
  if (!links.length) return entries;
  return entries.map((e) => {
    const hit = links.filter((l) => linkNames(e, l));
    if (!hit.length) return e;
    const ids = { ...e.ids };
    for (const l of hit)
      for (const [k, v] of Object.entries(linkIds(l)))
        (ids as Record<string, unknown>)[k] ??= v as unknown;
    return { ...e, ids, linkIds: hit.map((l) => l.id) };
  });
}

export interface MovieRow {
  // The first entry's key in source order; stable while that entry stays.
  key: string;
  // The English title where one is known (Trakt's, or AniList's for an anime movie), else the first entry's.
  title: string;
  // An anime movie's romaji title, when it differs (AniList's, else MAL's).
  altTitle: string | null;
  year: number | null;
  anime: boolean;
  cells: Record<MovieSource, MovieCell>;
  // The IDs the row's entries carry, for links and writes.
  ids: MovieIds;
  // Sources do not agree: different states, or listed on one and not on another.
  differs: boolean;
  // Newest time a source put it on a list, for the order.
  addedAt: string | null;
  images: string[];
  // Links you confirmed that join this row, so they can be undone.
  links: number[];
}

// The IDs two entries are tied by. TMDB and IMDb come from Trakt and Simkl, MAL from Simkl and MAL, the Simkl ID
// and Trakt slug from Simkl's own items; each is unique to one movie on that source.
function linkKeys(e: MovieEntry): string[] {
  const k: string[] = [];
  if (e.ids.tmdb) k.push(`tmdb:${e.ids.tmdb}`);
  if (e.ids.imdb) k.push(`imdb:${e.ids.imdb}`);
  if (e.ids.mal) k.push(`mal:${e.ids.mal}`);
  if (e.ids.simkl) k.push(`simkl:${e.ids.simkl}`);
  if (e.ids.traktSlug) k.push(`traktslug:${e.ids.traktSlug}`);
  if (e.ids.trakt) k.push(`trakt:${e.ids.trakt}`);
  return k;
}

const ORDER: Record<MovieSource, number> = { trakt: 0, simkl: 1, mal: 2 };

// Groups entries that share an ID. Two entries of one source never end up in one row: such a link is left out,
// so a wrong ID on one source cannot hide a movie.
export function groupMovies(entries: MovieEntry[]): MovieEntry[][] {
  const sorted = [...entries].sort((a, b) => ORDER[a.source] - ORDER[b.source]);
  const groups: MovieEntry[][] = [];
  const byKey = new Map<string, MovieEntry[]>();
  for (const e of sorted) {
    let group: MovieEntry[] | undefined;
    for (const k of linkKeys(e)) {
      const g = byKey.get(k);
      if (g && !g.some((x) => x.source === e.source)) {
        group = g;
        break;
      }
    }
    if (!group) {
      group = [];
      groups.push(group);
    }
    group.push(e);
    for (const k of linkKeys(e)) if (!byKey.has(k)) byKey.set(k, group);
  }
  return groups;
}

export function buildMovieRows(entries: MovieEntry[], links: MovieLink[] = []): MovieRow[] {
  const rows: MovieRow[] = [];
  for (const group of groupMovies(applyLinks(entries, links))) {
    // Only movies still to watch somewhere; watched or set aside everywhere drops off (decision #25).
    if (!group.some((e) => OPEN_STATES.includes(e.state))) continue;
    const ids: MovieIds = {};
    for (const e of group)
      for (const [k, v] of Object.entries(e.ids))
        (ids as Record<string, unknown>)[k] ??= v as unknown;
    // Anime when Simkl or MAL lists it as such, or a link ties it to a MAL entry.
    const anime = group.some((e) => e.anime) || !!ids.mal;
    const cell = (source: MovieSource): MovieCell => {
      const entry = group.find((e) => e.source === source) ?? null;
      if (entry) return { entry, absent: null };
      if (source === "mal")
        return {
          entry: null,
          absent: !anime ? "not_anime" : ids.mal ? "not_listed" : "not_linked",
        };
      // Every item on Trakt's and Simkl's lists carries a TMDB or IMDb ID (anime on Simkl a MAL ID), so a row
      // with one of those would have matched.
      const known = !!(ids.tmdb || ids.imdb || (source === "simkl" && ids.mal));
      return { entry: null, absent: known ? "not_listed" : "not_linked" };
    };
    const cells = { trakt: cell("trakt"), simkl: cell("simkl"), mal: cell("mal") };
    const states = new Set(
      MOVIE_SOURCES.map((s) => cells[s])
        .filter((c) => c.entry || c.absent === "not_listed")
        .map((c) => c.entry?.state ?? "none"),
    );
    const first = group[0]!;
    rows.push({
      key: first.key,
      title: first.title,
      altTitle: null,
      year: group.find((e) => e.year !== null)?.year ?? null,
      anime,
      cells,
      ids,
      differs: states.size > 1,
      addedAt:
        group
          .map((e) => e.addedAt)
          .filter((t): t is string => !!t)
          .sort()
          .at(-1) ?? null,
      images: group.map((e) => e.image).filter((i): i is string => !!i),
      links: [...new Set(group.flatMap((e) => e.linkIds ?? []))],
    });
  }
  // Newest on a list first; never-dated ones last, by title.
  return rows.sort(
    (a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? "") || a.title.localeCompare(b.title),
  );
}
