import { episodeLabel, episodeUrl, itemUrl, type EpisodeRef, type LinkTarget } from '#shared/utils/source-links'

// Display helpers for list entries (decision #24): each source keeps its own title and progress, and
// entries listed by both Simkl and MAL say so.

export const SOURCE_LABELS: Record<string, string> = { trakt: 'Trakt', simkl: 'Simkl', mal: 'MAL', anilist: 'AniList' }

// Each source's logo, shown next to its name everywhere (<SourceName>), in its brand colour. MAL's dark
// blue is lightened in dark mode; Simkl's brand is black, so it takes the text colour.
export const SOURCE_ICONS: Record<string, { icon: string, class: string }> = {
  trakt: { icon: 'i-simple-icons-trakt', class: 'text-[#9F42C6]' },
  simkl: { icon: 'i-simple-icons-simkl', class: '' },
  mal: { icon: 'i-simple-icons-myanimelist', class: 'text-[#2E51A2] dark:text-[#8DA6E8]' },
  anilist: { icon: 'i-simple-icons-anilist', class: 'text-[#02A9FF]' }
}

// List statuses as Simkl and MAL name them, for display.
export const LIST_STATUS_LABELS: Record<string, string> = {
  completed: 'Completed', hold: 'On hold', on_hold: 'On hold', dropped: 'Dropped',
  watching: 'Watching', plantowatch: 'Plan to watch', plan_to_watch: 'Plan to watch'
}

export interface EntryLike extends LinkTarget {
  key: string
  title: string
  next: EpisodeRef | null
}

export type LinkItem = { label: string, url: string | null, source?: string }

// "Simkl + MAL", each name linking to that source's page.
export const entrySourceLinks = (entries: EntryLike[]): LinkItem[] =>
  entries.map(e => ({ label: SOURCE_LABELS[e.source]!, url: itemUrl(e), source: e.source }))

// Each source's own title, once per distinct title.
export const entryTitles = (entries: EntryLike[]) => [...new Set(entries.map(e => e.title))].join(' / ')

// Next episode per source, merged when they agree: "E6 on Simkl + MAL", else "E6 on Simkl · E5 on MAL".
export function entryNextGroups(entries: EntryLike[]) {
  const groups = new Map<string, { label: string, links: LinkItem[] }>()
  for (const e of entries) {
    const label = episodeLabel(e.next)
    const group = groups.get(label) ?? { label, links: [] }
    group.links.push({ label: SOURCE_LABELS[e.source]!, url: e.next ? episodeUrl(e, e.next) : itemUrl(e), source: e.source })
    groups.set(label, group)
  }
  return [...groups.values()]
}
