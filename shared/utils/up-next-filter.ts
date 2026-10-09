// The Up Next filter bar (#68): client-side only, over the rows the page already has. The state lives in
// the URL query (`q`, `kind`, `only`) so it survives a refresh and can be bookmarked.

export type FilterChip = 'differs' | 'unmapped' | 'next'
export const FILTER_CHIPS: FilterChip[] = ['differs', 'unmapped', 'next']

export interface UpNextFilter {
  q: string
  kind: 'anime' | 'show' | null
  only: FilterChip[]
}

// Only the parts of a row the filter reads.
export interface FilterableRow {
  title: string
  kind: string
  differs: boolean
  accepted: boolean
  hasNext: boolean
  cells: Partial<Record<string, { state: string, entry: { title: string, altTitles?: string[] } | null, ref?: { title: string } | null } | undefined>>
}

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v)

export function parseFilter(query: Record<string, unknown>): UpNextFilter {
  const q = first(query.q)
  const kind = first(query.kind)
  const only = first(query.only)
  return {
    q: typeof q === 'string' ? q : '',
    kind: kind === 'anime' || kind === 'show' ? kind : null,
    only: typeof only === 'string' ? FILTER_CHIPS.filter(c => only.split(',').includes(c)) : []
  }
}

// Empty values are left out, so an unfiltered page has a clean URL.
export function filterQuery(f: UpNextFilter): Record<string, string> {
  return {
    ...(f.q.trim() ? { q: f.q } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.only.length ? { only: FILTER_CHIPS.filter(c => f.only.includes(c)).join(',') } : {})
  }
}

export const isFiltering = (f: UpNextFilter) => !!f.q.trim() || !!f.kind || f.only.length > 0

// Case and accents ignored: "pokemon" finds "Pokémon".
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()

// Every title the sources gave: the row's, each source's own (with MAL's English, Japanese and synonyms),
// and the linked title of a show that is not on that source's list.
export function rowTitles(row: FilterableRow): string[] {
  return [row.title, ...Object.values(row.cells).flatMap(c => c ? [c.entry?.title, ...(c.entry?.altTitles ?? []), c.ref?.title] : [])]
    .filter((t): t is string => !!t)
}

export function matchesFilter(row: FilterableRow, f: UpNextFilter): boolean {
  if (f.kind && row.kind !== f.kind) return false
  // A difference you accepted is no longer flagged, so it does not count here either.
  if (f.only.includes('differs') && !(row.differs && !row.accepted)) return false
  if (f.only.includes('unmapped') && !Object.values(row.cells).some(c => c?.state === 'unmapped')) return false
  if (f.only.includes('next') && !row.hasNext) return false
  const words = fold(f.q).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const titles = rowTitles(row).map(fold)
  return words.every(w => titles.some(t => t.includes(w)))
}
