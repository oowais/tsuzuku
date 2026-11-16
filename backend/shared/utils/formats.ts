// The sources' own types for an entry: Simkl `anime_type`, MAL `media_type` (seen: tv, ona, ova, movie,
// special, ...). Shared by the server (what gets linked) and the pages (how it is labelled).

// Specials and OVAs are shown on Shows but never linked to a Trakt show (decision #23): Trakt files them under
// season 0, with different numbering. Anime movies are not on Shows at all; they are on Movies.
const SIDE_STORY_FORMATS = new Set(["ova", "special", "movie", "tv_special", "music", "cm", "pv"]);

export const isSideStory = (format: string | null | undefined): boolean =>
  !!format && SIDE_STORY_FORMATS.has(format.toLowerCase());

// An anime movie (Simkl `anime_type`, MAL `media_type`): on Movies, not Shows (decisions #23, #25).
export const isMovieFormat = (format: string | null | undefined): boolean =>
  format?.toLowerCase() === "movie";

const LABELS: Record<string, string> = {
  tv: "TV",
  ona: "ONA",
  ova: "OVA",
  special: "Special",
  tv_special: "TV special",
  movie: "Movie",
  music: "Music video",
  cm: "Commercial",
  pv: "Promo video",
};

// A readable label for a source's type; an unknown one is shown as the source wrote it.
export const formatLabel = (format: string): string => LABELS[format.toLowerCase()] ?? format;
