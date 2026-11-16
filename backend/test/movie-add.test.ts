import { describe, expect, it } from "vite-plus/test";
import { createTmdbAdapter, toTmdbMovie } from "../server/adapters/tmdb";
import { createDb } from "../server/db";
import { planMovieAdd } from "../server/lib/movie-add";
import {
  applyLinks,
  buildMovieRows,
  movieEntriesFrom,
  type MovieLists,
} from "../server/lib/movies";
import { createSourceWrapper } from "../server/lib/source-wrapper";

const entries = (lists: MovieLists) => movieEntriesFrom(lists).entries;
const traktMovie = (trakt: number, ids: Record<string, unknown> = {}) => ({
  title: `Trakt ${trakt}`,
  year: 2020,
  ids: { trakt, slug: `t-${trakt}`, ...ids },
});

describe("planning a movie add", () => {
  it("adds a TMDB pick to Trakt and Simkl by its TMDB ID; MAL only for an anime movie", () => {
    const plan = planMovieAdd(
      { from: "tmdb", title: "New", year: 2022, ids: { tmdb: 77, imdb: "tt77" } },
      [],
    );
    expect(plan.steps.map((s) => [s.source, s.write])).toEqual([
      ["trakt", { source: "trakt", ids: { trakt: undefined, tmdb: 77, imdb: "tt77" } }],
      ["simkl", { source: "simkl", kind: "movie", ids: { tmdb: 77, imdb: "tt77" } }],
    ]);
    expect(plan.skipped).toEqual([]);
    expect(plan.anime).toBe(false);
  });

  it("never moves a movie a source already has, watched or listed", () => {
    const plan = planMovieAdd(
      { from: "tmdb", title: "Seen", year: 2020, ids: { tmdb: 10 } },
      entries({
        trakt: {
          watched: [
            { last_watched_at: "2025-01-01T00:00:00Z", movie: traktMovie(1, { tmdb: 10 }) },
          ],
        },
        simkl: {
          anime: [
            {
              status: "plantowatch",
              anime_type: "movie",
              show: { title: "Simkl title", ids: { simkl: 5, tmdb: "10", mal: "500" } },
            },
          ],
        },
      }),
    );
    expect(plan.skipped).toEqual([
      { source: "trakt", reason: "already watched (Trakt 1)" },
      { source: "simkl", reason: "already on your list (Simkl title)" },
    ]);
    // Simkl's item ties it to a MAL entry, so MAL can take it.
    expect(plan.anime).toBe(true);
    expect(plan.steps).toEqual([
      {
        source: "mal",
        summary: "Add to Plan to Watch",
        expected: "none",
        write: { source: "mal", mal: 500 },
      },
    ]);
  });

  it("asks which Trakt movie an anime pick is, unless a list ties it", () => {
    const pick = { from: "anilist" as const, title: "Anime", year: 2024, ids: { mal: 300 } };
    const alone = planMovieAdd(pick, []);
    expect(alone.traktSearch).toBe(true);
    expect(alone.steps.map((s) => s.source)).toEqual(["simkl", "mal"]);
    expect(alone.steps[0]!.write).toEqual({
      source: "simkl",
      kind: "anime",
      ids: { mal: 300, tmdb: undefined },
    });

    const withTrakt = planMovieAdd({ ...pick, ids: { mal: 300, trakt: 9, tmdb: 90 } }, []);
    expect(withTrakt.traktSearch).toBe(false);
    expect(withTrakt.steps[0]).toMatchObject({
      source: "trakt",
      write: { ids: { trakt: 9, tmdb: 90 } },
    });
  });
});

describe("TMDB", () => {
  it("reads a movie, its year and a poster URL; a bad poster path is dropped", () => {
    expect(
      toTmdbMovie({
        id: 1,
        title: "A",
        original_title: "B",
        release_date: "2021-04-02",
        poster_path: "/x.jpg",
        imdb_id: "tt1",
      }),
    ).toEqual({
      tmdb: 1,
      title: "A",
      originalTitle: "B",
      year: 2021,
      imdb: "tt1",
      poster: "https://image.tmdb.org/t/p/w185/x.jpg",
    });
    expect(
      toTmdbMovie({ id: 2, title: "C", release_date: "", poster_path: "//evil" }),
    ).toMatchObject({
      year: null,
      poster: null,
    });
  });

  it("sends a v3 key as api_key and a v4 token as a Bearer token, and fails without one", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetch = (async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ results: [] }));
    }) as unknown as typeof globalThis.fetch;
    const wrapper = createSourceWrapper({ db: createDb(":memory:") });
    const env = (TMDB_API_KEY?: string) => ({ TMDB_API_KEY }) as NodeJS.ProcessEnv;
    await createTmdbAdapter({ wrapper, fetch, env: env("abc") }).searchMovies("x");
    expect(new URL(calls[0]!.url).searchParams.get("api_key")).toBe("abc");
    await createTmdbAdapter({ wrapper, fetch, env: env("eyJtoken") }).searchMovies("x");
    expect(new URL(calls[1]!.url).searchParams.has("api_key")).toBe(false);
    expect(calls[1]!.headers.Authorization).toBe("Bearer eyJtoken");
    const missing = await createTmdbAdapter({ wrapper, fetch, env: env() }).searchMovies("x");
    expect(missing).toMatchObject({ status: "error", error: "TMDB_API_KEY is not set" });
    expect(calls).toHaveLength(2);
  });
});

describe("adding a linked movie where it is missing", () => {
  it("offers only the source without it: Trakt's watchlist, by the IDs your link gave", () => {
    const lists: MovieLists = {
      simkl: {
        anime: [
          {
            status: "plantowatch",
            anime_type: "movie",
            show: { title: "Slime", ids: { simkl: 5, mal: "300" } },
          },
        ],
      },
      mal: {
        data: [
          {
            node: { id: 300, title: "Slime", media_type: "movie" },
            list_status: { status: "plan_to_watch" },
          },
        ],
      },
    };
    const linked = applyLinks(movieEntriesFrom(lists).entries, [
      { id: 1, traktId: 9, traktSlug: "slime", tmdbId: 90, imdbId: null, simklId: 5, malId: 300 },
    ]);
    const [row] = buildMovieRows(linked);
    const plan = planMovieAdd(
      { from: "anilist", title: row!.title, year: row!.year, ids: row!.ids },
      linked,
    );
    expect(plan.steps).toEqual([
      {
        source: "trakt",
        summary: "Add to watchlist",
        expected: "none",
        write: { source: "trakt", ids: { trakt: 9, tmdb: 90, imdb: undefined } },
      },
    ]);
    expect(plan.skipped.map((s) => s.source)).toEqual(["simkl", "mal"]);
  });
});

describe("picking a source's movie in the add preview", () => {
  it("offers a MAL pick only while no MAL entry is known", () => {
    expect(
      planMovieAdd({ from: "tmdb", title: "A", year: null, ids: { tmdb: 1 } }, []).malSearch,
    ).toBe(true);
    const picked = planMovieAdd(
      { from: "tmdb", title: "A", year: null, ids: { tmdb: 1, mal: 7 } },
      [],
    );
    expect(picked.malSearch).toBe(false);
    expect(picked.anime).toBe(true);
    expect(picked.steps.map((s) => s.source)).toEqual(["trakt", "simkl", "mal"]);
  });
});
