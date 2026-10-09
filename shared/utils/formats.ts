// The sources' own types for an entry: Simkl `anime_type`, MAL `media_type` (seen: tv, ona, ova, movie,
// special, ...). Shared by the server (what gets linked) and the pages (how it is labelled).

// Specials, OVAs and anime movies are shown but never linked to a Trakt show in v1 (decision #23):
// Trakt files them under season 0 or as movies, with different numbering.
const SIDE_STORY_FORMATS = new Set(['ova', 'special', 'movie', 'tv_special', 'music', 'cm', 'pv'])

export const isSideStory = (format: string | null | undefined): boolean => !!format && SIDE_STORY_FORMATS.has(format.toLowerCase())

const LABELS: Record<string, string> = {
  tv: 'TV',
  ona: 'ONA',
  ova: 'OVA',
  special: 'Special',
  tv_special: 'TV special',
  movie: 'Movie',
  music: 'Music video',
  cm: 'Commercial',
  pv: 'Promo video'
}

// A readable label for a source's type; an unknown one is shown as the source wrote it.
export const formatLabel = (format: string): string => LABELS[format.toLowerCase()] ?? format
