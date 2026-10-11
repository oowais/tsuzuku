import { describe, expect, it } from "vite-plus/test";
import { entriesFrom } from "../server/lib/entries";
import { buildMovieRows, movieEntriesFrom, type MovieLists } from "../server/lib/movies";

// Raw shapes from each source's reference (docs/context.md), made-up values.
const traktMovie = (trakt: number, ids: Record<string, unknown> = {}) => ({
  title: `Trakt ${trakt}`,
  year: 2020,
  ids: { trakt, slug: `t-${trakt}`, ...ids },
});
const onWatchlist = (
  trakt: number,
  ids: Record<string, unknown> = {},
  at = "2026-10-01T00:00:00Z",
) => ({
  rank: 1,
  id: trakt,
  listed_at: at,
  type: "movie",
  movie: traktMovie(trakt, ids),
});
const watched = (trakt: number, ids: Record<string, unknown> = {}) => ({
  plays: 1,
  last_watched_at: "2025-01-01T00:00:00Z",
  movie: traktMovie(trakt, ids),
});
const simklMovie = (simkl: number, status: string, ids: Record<string, unknown> = {}) => ({
  status,
  added_to_watchlist_at: "2026-09-01T00:00:00Z",
  movie: { title: `Simkl ${simkl}`, year: 2020, ids: { simkl, ...ids } },
});
const simklAnime = (
  simkl: number,
  status: string,
  type: string,
  ids: Record<string, unknown> = {},
) => ({
  status,
  anime_type: type,
  added_to_watchlist_at: "2026-09-01T00:00:00Z",
  show: { title: `Simkl ${simkl}`, year: 2020, ids: { simkl, ...ids } },
});
const mal = (id: number, status: string, type = "movie") => ({
  node: { id, title: `Mal ${id}`, media_type: type },
  list_status: { status, updated_at: "2026-08-01T00:00:00+00:00" },
});

const rows = (lists: MovieLists) => buildMovieRows(movieEntriesFrom(lists).entries);

describe("movie rows", () => {
  it("links Trakt and Simkl by TMDB or IMDb ID and shows each source's own state", () => {
    const r = rows({
      trakt: { watchlist: [onWatchlist(1, { tmdb: 10 }), onWatchlist(2, { imdb: "tt2" })] },
      simkl: {
        movies: [
          simklMovie(101, "plantowatch", { tmdb: "10" }),
          simklMovie(102, "completed", { imdb: "tt2" }),
        ],
      },
    });
    expect(r).toHaveLength(2);
    const agree = r.find((x) => x.key === "trakt:1")!;
    expect(agree.cells.simkl.entry).toMatchObject({
      title: "Simkl 101",
      state: "watchlist",
      listStatus: "plantowatch",
    });
    expect(agree.differs).toBe(false);
    const differs = r.find((x) => x.key === "trakt:2")!;
    expect(differs.cells.simkl.entry?.state).toBe("watched");
    expect(differs.differs).toBe(true);
    // Not anime: MAL does not apply.
    expect(differs.cells.mal).toEqual({ entry: null, absent: "not_anime" });
  });

  it("bridges an anime movie to MAL through Simkl's MAL ID, and leaves out other anime", () => {
    const r = rows({
      trakt: { watchlist: [onWatchlist(3, { tmdb: 30 })] },
      simkl: {
        anime: [
          simklAnime(103, "plantowatch", "movie", { tmdb: "30", mal: "300" }),
          simklAnime(104, "watching", "tv", { mal: "400" }),
        ],
      },
      mal: { data: [mal(300, "plan_to_watch"), mal(400, "watching", "tv")] },
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.anime).toBe(true);
    expect(r[0]!.cells.trakt.entry?.key).toBe("trakt:3");
    expect(r[0]!.cells.simkl.entry?.key).toBe("simkl:103");
    expect(r[0]!.cells.mal.entry).toMatchObject({ key: "mal:300", state: "watchlist" });
  });

  it("says when a source is not on the lists and when nothing links it", () => {
    const r = rows({
      trakt: { watchlist: [] },
      simkl: { movies: [simklMovie(105, "plantowatch", { imdb: "tt5" })] },
      mal: { data: [mal(500, "watching")] },
    });
    const simklOnly = r.find((x) => x.key === "simkl:105")!;
    expect(simklOnly.cells.trakt.absent).toBe("not_listed");
    const malOnly = r.find((x) => x.key === "mal:500")!;
    expect(malOnly.cells.trakt.absent).toBe("not_linked");
    expect(malOnly.cells.simkl.absent).toBe("not_listed");
    expect(malOnly.differs).toBe(true);
  });

  it("drops a movie watched on every source, keeps one watched and back on the Trakt watchlist", () => {
    const r = rows({
      trakt: {
        watchlist: [onWatchlist(7, { imdb: "tt7" })],
        watched: [watched(7, { imdb: "tt7" }), watched(8, { tmdb: 80 })],
      },
      simkl: { movies: [simklMovie(108, "completed", { tmdb: "80" })] },
    });
    expect(r.map((x) => x.key)).toEqual(["trakt:7"]);
    expect(r[0]!.cells.trakt.entry).toMatchObject({
      state: "watchlist",
      watchedBefore: true,
      watchedAt: "2025-01-01T00:00:00Z",
    });
  });

  it("never puts two entries of one source in a row", () => {
    const r = rows({
      trakt: { watchlist: [onWatchlist(1, { tmdb: 10 }), onWatchlist(2, { tmdb: 10 })] },
    });
    expect(r).toHaveLength(2);
  });

  it("orders by the newest time a source listed it", () => {
    const r = rows({
      trakt: {
        watchlist: [
          onWatchlist(1, {}, "2026-01-01T00:00:00Z"),
          onWatchlist(2, {}, "2026-03-01T00:00:00Z"),
        ],
      },
    });
    expect(r.map((x) => x.key)).toEqual(["trakt:2", "trakt:1"]);
  });

  it("reports an unreadable item and keeps the rest", () => {
    const { entries, errors } = movieEntriesFrom({
      simkl: { movies: [{ status: "plantowatch", movie: {} }, simklMovie(1, "plantowatch")] },
    });
    expect(entries).toHaveLength(1);
    expect(errors[0]).toMatchObject({ source: "simkl" });
  });
});

describe("anime movies on Shows", () => {
  it("are left out of the watching lists (decision #23)", () => {
    const { entries } = entriesFrom({
      simkl: { anime: [{ ...simklAnime(1, "watching", "movie"), next_to_watch: "E1" }] },
      mal: {
        data: [
          {
            ...mal(2, "watching"),
            node: { id: 2, title: "M", media_type: "movie", num_episodes: 1 },
          },
          mal(3, "watching", "tv"),
        ],
      },
    });
    expect(entries.map((e) => e.key)).toEqual(["mal:3"]);
  });
});
