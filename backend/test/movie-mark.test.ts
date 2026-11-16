import { describe, expect, it } from "vite-plus/test";
import { findMovieRow, planMovieMark } from "../server/lib/movie-mark";
import { buildMovieRows, movieEntriesFrom, type MovieLists } from "../server/lib/movies";

const traktMovie = (trakt: number, ids: Record<string, unknown> = {}) => ({
  title: `Trakt ${trakt}`,
  year: 2020,
  ids: { trakt, slug: `t-${trakt}`, ...ids },
});
const simklMovie = (simkl: number, status: string, ids: Record<string, unknown> = {}) => ({
  status,
  user_rating: 7,
  movie: { title: `Simkl ${simkl}`, year: 2020, ids: { simkl, ...ids } },
});
const simklAnime = (simkl: number, status: string, ids: Record<string, unknown> = {}) => ({
  status,
  anime_type: "movie",
  show: { title: `Simkl ${simkl}`, year: 2020, ids: { simkl, ...ids } },
});
const mal = (id: number, status: string, episodes = 1) => ({
  node: { id, title: `Mal ${id}`, media_type: "movie", num_episodes: episodes },
  list_status: { status, score: 0 },
});
const rows = (lists: MovieLists) => buildMovieRows(movieEntriesFrom(lists).entries);

describe("planning a movie mark", () => {
  it("ticks every source that has it to watch, by that source's own ID", () => {
    const [row] = rows({
      trakt: {
        watchlist: [{ listed_at: "2026-10-01T00:00:00Z", movie: traktMovie(1, { tmdb: 10 }) }],
      },
      simkl: { movies: [simklMovie(101, "plantowatch", { tmdb: "10" })] },
    });
    const plan = planMovieMark(row!);
    expect(plan.steps.map((s) => [s.source, s.optional, s.expected])).toEqual([
      ["trakt", false, "watchlist"],
      ["simkl", false, "plantowatch"],
    ]);
    expect(plan.steps[0]!.write).toEqual({ source: "trakt", ids: { trakt: 1 } });
    expect(plan.steps[1]!.write).toEqual({ source: "simkl", kind: "movie", ids: { simkl: 101 } });
    expect(plan.steps[1]!.currentRating).toBe(7);
    // Not anime: nothing about MAL.
    expect(plan.skipped).toEqual([]);
  });

  it("offers a source without the movie unticked, by the IDs the others gave", () => {
    const [row] = rows({
      simkl: { movies: [simklMovie(102, "plantowatch", { imdb: "tt2" })] },
    });
    const trakt = planMovieMark(row!).steps.find((s) => s.source === "trakt")!;
    expect(trakt).toMatchObject({ optional: true, expected: "none" });
    expect(trakt.write).toEqual({ source: "trakt", ids: { tmdb: undefined, imdb: "tt2" } });
  });

  it("skips what is already watched, set aside or not linked", () => {
    const [row] = rows({
      trakt: {
        watched: [{ last_watched_at: "2025-05-01T00:00:00Z", movie: traktMovie(3, { tmdb: 30 }) }],
      },
      simkl: { anime: [simklAnime(103, "plantowatch", { tmdb: "30", mal: "300" })] },
      mal: { data: [mal(300, "dropped")] },
    });
    const plan = planMovieMark(row!);
    expect(plan.steps.map((s) => s.source)).toEqual(["simkl"]);
    expect(plan.steps[0]!.write).toMatchObject({ kind: "anime", ids: { simkl: 103 } });
    expect(plan.skipped).toEqual([
      { source: "trakt", reason: "already watched (2025-05-01)" },
      { source: "mal", reason: "dropped on MAL; change it there" },
    ]);

    const [malOnly] = rows({ mal: { data: [mal(400, "watching", 2)] } });
    const p = planMovieMark(malOnly!);
    expect(p.skipped[0]).toMatchObject({ source: "trakt" });
    expect(p.skipped[0]!.reason).toContain("not linked");
    expect(p.steps.find((s) => s.source === "mal")!.write).toEqual({
      source: "mal",
      mal: 400,
      episodes: 2,
    });
    // Simkl does not have it: offered by its MAL ID.
    expect(p.steps.find((s) => s.source === "simkl")).toMatchObject({
      optional: true,
      write: { kind: "anime", ids: { mal: 400 } },
    });
  });

  it("finds the same movie in fresh lists by its key or the entry that gave it", () => {
    const fresh = rows({
      simkl: { movies: [simklMovie(105, "plantowatch", { tmdb: "50" })] },
      trakt: {
        watchlist: [{ listed_at: "2026-10-01T00:00:00Z", movie: traktMovie(5, { tmdb: 50 }) }],
      },
    });
    expect(findMovieRow(fresh, "trakt:5")?.key).toBe("trakt:5");
    expect(findMovieRow(fresh, "simkl:105")?.key).toBe("trakt:5");
    expect(findMovieRow(fresh, "simkl:999")).toBeUndefined();
  });
});
