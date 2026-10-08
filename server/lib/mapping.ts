import type { Entry, EntryIds } from './entries'

// Deterministic links: entries on different sources that share a real ID (decision #14, first layer).
// Only IDs the sources themselves returned are compared; nothing is guessed or generated.

// Which ID fields can link two entries. `traktSlug` links a Simkl item to the Trakt show it names.
const LINK_IDS = ['trakt', 'traktSlug', 'simkl', 'mal', 'anilist', 'tmdb', 'tvdb', 'imdb'] as const satisfies readonly (keyof EntryIds)[]
export type LinkId = (typeof LINK_IDS)[number]

export interface LinkGroup {
  keys: string[]
  // The ID fields that joined the group.
  via: LinkId[]
  // Set when the group would hold two entries from the same source, for example two Simkl season entries
  // that both carry the franchise's TMDB ID. Such a group is never linked automatically.
  conflict?: string
}

export function linkByIds(entries: Entry[]): LinkGroup[] {
  const parent = new Map(entries.map(e => [e.key, e.key]))
  const find = (k: string): string => {
    const p = parent.get(k)!
    if (p === k) return k
    const root = find(p)
    parent.set(k, root)
    return root
  }
  const via = new Map<string, Set<LinkId>>()

  // Index every entry under each ID it carries, then join entries from different sources that share one.
  const byId = new Map<string, Entry[]>()
  for (const e of entries) {
    for (const id of LINK_IDS) {
      const value = e.ids[id]
      if (value === undefined) continue
      const list = byId.get(`${id}:${value}`) ?? []
      list.push(e)
      byId.set(`${id}:${value}`, list)
    }
  }
  for (const [idKey, list] of byId) {
    const id = idKey.slice(0, idKey.indexOf(':')) as LinkId
    for (let i = 1; i < list.length; i++) {
      const a = list[0]!
      const b = list[i]!
      if (a.source === b.source) continue
      const ra = find(a.key)
      const rb = find(b.key)
      const joined = new Set([...(via.get(ra) ?? []), ...(via.get(rb) ?? []), id])
      parent.set(rb, ra)
      via.set(ra, joined)
    }
  }

  const groups = new Map<string, Entry[]>()
  for (const e of entries) {
    const root = find(e.key)
    groups.set(root, [...(groups.get(root) ?? []), e])
  }

  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([root, members]) => {
      const sources = members.map(m => m.source)
      const duplicate = sources.find((s, i) => sources.indexOf(s) !== i)
      return {
        keys: members.map(m => m.key),
        via: [...(via.get(root) ?? [])].sort(),
        ...(duplicate ? { conflict: `More than one ${duplicate} entry shares an ID` } : {})
      }
    })
}
