// Links to a source's own page for a show, season or episode (decision #24), so every title and episode
// on screen can be checked at the source in one click. Formats checked on 2026-10-08:
// - MAL:   myanimelist.net/anime/<id>, episode myanimelist.net/anime/<id>/_/episode/<n> (page title "Episode <n>")
// - Simkl: simkl.com/<tv|anime>/<id>/<slug>, episodes .../season-<s>/episode-<e>/ (tv) and .../episode-<n>/ (anime),
//          as Simkl's own /redirect helper resolves them
// - Trakt: trakt.tv/shows/<slug>, /seasons/<s>, /seasons/<s>/episodes/<e> (Trakt's long-standing format;
//          trakt.tv blocks scripted checks, so this one was confirmed by clicking)

export type LinkSource = 'trakt' | 'simkl' | 'mal'

export interface LinkTarget {
  source: LinkSource
  kind: 'show' | 'anime'
  ids: { traktSlug?: string, simkl?: number, simklSlug?: string, mal?: number }
}

export interface EpisodeRef {
  season: number | null
  number: number
}

function simklBase(t: LinkTarget): string | null {
  if (t.ids.simkl === undefined) return null
  const slug = t.ids.simklSlug ? `/${t.ids.simklSlug}` : ''
  return `https://simkl.com/${t.kind === 'anime' ? 'anime' : 'tv'}/${t.ids.simkl}${slug}`
}

export function itemUrl(t: LinkTarget): string | null {
  switch (t.source) {
    case 'trakt':
      return t.ids.traktSlug ? `https://trakt.tv/shows/${t.ids.traktSlug}` : null
    case 'simkl':
      return simklBase(t)
    case 'mal':
      return t.ids.mal !== undefined ? `https://myanimelist.net/anime/${t.ids.mal}` : null
  }
}

// Only Trakt has season pages; elsewhere the show page is the closest.
export function seasonUrl(t: LinkTarget, season: number): string | null {
  const item = itemUrl(t)
  return t.source === 'trakt' && item ? `${item}/seasons/${season}` : item
}

export function episodeUrl(t: LinkTarget, ep: EpisodeRef): string | null {
  const item = itemUrl(t)
  if (!item) return null
  switch (t.source) {
    case 'trakt':
      return ep.season !== null ? `${item}/seasons/${ep.season}/episodes/${ep.number}` : item
    case 'simkl':
      // Simkl needs a slug in episode URLs; without one, the show page.
      if (!t.ids.simklSlug) return item
      if (t.kind === 'anime') return `${item}/episode-${ep.number}/`
      return ep.season !== null ? `${item}/season-${ep.season}/episode-${ep.number}/` : item
    case 'mal':
      return `${item}/_/episode/${ep.number}`
  }
}

export function episodeLabel(ep: EpisodeRef | null): string {
  if (!ep) return 'caught up'
  return ep.season !== null ? `S${ep.season}E${ep.number}` : `E${ep.number}`
}
