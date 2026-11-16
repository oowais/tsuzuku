import { ConfigError } from "../lib/env";
import { USER_AGENT } from "../lib/oauth/providers";
import type { createSourceWrapper, SourceResult } from "../lib/source-wrapper";

// TMDB API v3 (developer.themoviedb.org, from the reference, not yet seen in a real answer), for finding a movie
// to add (#17). `TMDB_API_KEY` is either the v3 API key (sent as `api_key`) or the v4 read access token (a JWT,
// sent as a Bearer token); both are on https://www.themoviedb.org/settings/api.
// - GET /3/search/movie?query=&include_adult=false -> { results: [{ id, title, original_title, release_date
//   (YYYY-MM-DD or ""), poster_path, overview }] }
// - GET /3/movie/{id} -> the movie, with `imdb_id`; 404 when unknown.
const API = "https://api.themoviedb.org/3";
const POSTERS = "https://image.tmdb.org/t/p/w185";

export interface TmdbMovie {
  tmdb: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  imdb: string | null;
  poster: string | null;
}

type Json = Record<string, unknown>;

export function toTmdbMovie(raw: unknown): TmdbMovie | null {
  const m = (raw && typeof raw === "object" ? raw : {}) as Json;
  if (typeof m.id !== "number" || typeof m.title !== "string") return null;
  const year = typeof m.release_date === "string" ? Number(m.release_date.slice(0, 4)) : NaN;
  return {
    tmdb: m.id,
    title: m.title,
    originalTitle:
      typeof m.original_title === "string" && m.original_title !== m.title
        ? m.original_title
        : null,
    year: Number.isInteger(year) && year > 0 ? year : null,
    imdb: typeof m.imdb_id === "string" && m.imdb_id ? m.imdb_id : null,
    poster:
      typeof m.poster_path === "string" && /^\/[\w.-]+$/.test(m.poster_path)
        ? `${POSTERS}${m.poster_path}`
        : null,
  };
}

export interface TmdbOptions {
  wrapper: ReturnType<typeof createSourceWrapper>;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
}

export function createTmdbAdapter(opts: TmdbOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch;

  function key(): string {
    const value = (opts.env ?? process.env).TMDB_API_KEY?.trim();
    if (!value) throw new ConfigError("TMDB_API_KEY is not set");
    return value;
  }

  async function get<T>(path: string, params: Record<string, string> = {}) {
    let k: string;
    try {
      k = key();
    } catch (err) {
      return { status: "error", data: null, error: (err as Error).message } as SourceResult<T>;
    }
    // A v4 token is a JWT; anything else is a v3 key.
    const bearer = k.startsWith("eyJ");
    const url = new URL(`${API}${path}`);
    url.search = new URLSearchParams({ ...params, ...(bearer ? {} : { api_key: k }) }).toString();
    return opts.wrapper.call<T>({
      source: "tmdb",
      notFoundOk: true,
      fetcher: () =>
        doFetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": USER_AGENT,
            ...(bearer ? { Authorization: `Bearer ${k}` } : {}),
          },
        }),
    });
  }

  async function searchMovies(query: string) {
    const res = await get<{ results?: unknown[] }>("/search/movie", {
      query,
      include_adult: "false",
    });
    return {
      status: res.status,
      error: res.error,
      movies: (res.data?.results ?? []).map(toTmdbMovie).filter((m): m is TmdbMovie => !!m),
    };
  }

  async function movie(tmdb: number) {
    const res = await get<unknown>(`/movie/${tmdb}`);
    return { status: res.status, error: res.error, movie: res.data ? toTmdbMovie(res.data) : null };
  }

  return { searchMovies, movie };
}
