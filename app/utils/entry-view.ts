import { episodeLabel, episodeUrl, itemUrl, type EpisodeRef, type LinkTarget } from '#shared/utils/source-links'

// Display helpers for list entries (decision #24): each source keeps its own title and progress, and
// entries listed by both Simkl and MAL say so.

export const SOURCE_LABELS: Record<string, string> = { trakt: 'Trakt', simkl: 'Simkl', mal: 'MAL' }

export interface EntryLike extends LinkTarget {
  key: string
  title: string
  next: EpisodeRef | null
}

export type LinkItem = { label: string, url: string | null }

// "Simkl + MAL", each name linking to that source's page.
export const entrySourceLinks = (entries: EntryLike[]): LinkItem[] =>
  entries.map(e => ({ label: SOURCE_LABELS[e.source]!, url: itemUrl(e) }))

// Each source's own title, once per distinct title.
export const entryTitles = (entries: EntryLike[]) => [...new Set(entries.map(e => e.title))].join(' / ')

// Next episode per source, merged when they agree: "E6 on Simkl + MAL", else "E6 on Simkl · E5 on MAL".
export function entryNextGroups(entries: EntryLike[]) {
  const groups = new Map<string, { label: string, links: LinkItem[] }>()
  for (const e of entries) {
    const label = episodeLabel(e.next)
    const group = groups.get(label) ?? { label, links: [] }
    group.links.push({ label: SOURCE_LABELS[e.source]!, url: e.next ? episodeUrl(e, e.next) : itemUrl(e) })
    groups.set(label, group)
  }
  return [...groups.values()]
}
