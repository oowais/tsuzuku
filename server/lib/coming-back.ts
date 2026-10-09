import type { AniListMedia } from '../adapters/anilist'

// "Coming back" (#66, part 2): sequels of anime you completed that are on no watching list yet. Pure: the
// completed entries' AniList media (cached rows, with the sequels' own fields on the relation edges) and your
// whole MAL list go in, the sequels worth showing come out. Nothing here calls a source.

export type SequelStage = 'announced' | 'scheduled' | 'airing' | 'released'

export interface Sequel {
  malId: number
  anilistId: number
  title: string
  format: string
  stage: SequelStage
  // AniList's own start date, any part of it null (an announcement can be just a year or a month).
  startDate: { year: number | null, month: number | null, day: number | null }
  // The next episode to air (Unix seconds), while one is scheduled.
  nextEpisode: { episode: number, airingAt: number } | null
  // The completed entry this follows: the newest one on the way, so long shows land on their latest season.
  from: { malId: number, title: string }
  // Already queued on MAL: same situation as the rest (the season is not started), shown with a badge.
  onPlanToWatch: boolean
}

const DAY = 24 * 60 * 60 * 1000
// Formats that count as a next season. Side stories, recaps and adaptations are other relation types or formats.
const SEQUEL_FORMATS = new Set(['TV', 'ONA', 'MOVIE'])

interface Edge {
  type: string
  node: Record<string, unknown>
}

const numberOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function edgesOf(media: AniListMedia | null | undefined): Edge[] {
  const edges = (media?.relations as { edges?: { relationType?: unknown, node?: unknown }[] } | undefined)?.edges
  return (edges ?? []).flatMap(e => (typeof e.relationType === 'string' && e.node && typeof e.node === 'object' ? [{ type: e.relationType, node: e.node as Record<string, unknown> }] : []))
}

// The title as the page would show it: English where AniList has one.
function titleOf(node: object | null | undefined, fallback: string): string {
  const t = ((node as { title?: unknown } | null | undefined)?.title ?? {}) as { english?: unknown, romaji?: unknown }
  return (typeof t.english === 'string' && t.english) || (typeof t.romaji === 'string' && t.romaji) || fallback
}

// A sequel edge usable here: a next season in a format that counts, with a MAL ID (every write uses it).
function sequelEdges(media: AniListMedia | null | undefined): Edge[] {
  return edgesOf(media).filter(e => e.type === 'SEQUEL' && SEQUEL_FORMATS.has(String(e.node.format)) && numberOf(e.node.idMal) !== null)
}

// Where a sequel stands, from its own fields on the relation edge. Null for a cancelled one.
export function stageOf(node: Record<string, unknown>, now: number): { stage: SequelStage, next: Sequel['nextEpisode'] } | null {
  const raw = node.nextAiringEpisode as { episode?: unknown, airingAt?: unknown } | null | undefined
  const episode = numberOf(raw?.episode)
  const airingAt = numberOf(raw?.airingAt)
  const next = episode !== null && airingAt !== null ? { episode, airingAt } : null
  switch (node.status) {
    case 'CANCELLED':
      return null
    case 'NOT_YET_RELEASED':
    case 'HIATUS':
      // Episode 1 with a date still ahead: it has a premiere.
      return { stage: next && next.episode === 1 && next.airingAt * 1000 > now ? 'scheduled' : 'announced', next }
    case 'RELEASING':
      return { stage: next && next.episode === 1 ? 'scheduled' : 'airing', next }
    default:
      return { stage: 'released', next: null }
  }
}

const startOf = (node: Record<string, unknown>): Sequel['startDate'] => {
  const d = (node.startDate ?? {}) as { year?: unknown, month?: unknown, day?: unknown }
  return { year: numberOf(d.year), month: numberOf(d.month), day: numberOf(d.day) }
}

export interface ComingBackInput {
  // Your whole MAL list: status per MAL ID (watching, completed, on_hold, dropped, plan_to_watch).
  statuses: Record<number, string>
  // AniList media by MAL ID, for the completed entries (null: AniList has none).
  media: Record<number, AniListMedia | null | undefined>
  now: number
}

// The sequels of completed entries that are on no watching list. A sequel that is itself completed is followed
// further instead of shown; one on Watching, On hold or Dropped is left out; Plan to Watch stays, with a badge.
export function comingBack({ statuses, media, now }: ComingBackInput): Sequel[] {
  const found = new Map<number, Sequel>()
  const visited = new Set<number>()

  const follow = (malId: number) => {
    if (visited.has(malId)) return
    visited.add(malId)
    const current = media[malId]
    const here = { malId, title: titleOf(current, `MAL ${malId}`) }
    for (const { node } of sequelEdges(current)) {
      const next = numberOf(node.idMal)!
      const status = statuses[next]
      if (status === 'completed') {
        follow(next)
        continue
      }
      if (status === 'watching' || status === 'on_hold' || status === 'dropped') continue
      const where = stageOf(node, now)
      if (!where || found.has(next)) continue
      found.set(next, {
        malId: next,
        anilistId: numberOf(node.id) ?? 0,
        title: titleOf(node, `MAL ${next}`),
        format: String(node.format),
        stage: where.stage,
        startDate: startOf(node),
        nextEpisode: where.next,
        from: here,
        onPlanToWatch: status === 'plan_to_watch'
      })
    }
  }

  for (const [id, status] of Object.entries(statuses)) {
    if (status !== 'completed') continue
    follow(Number(id))
  }
  return [...found.values()].sort(compareSequels)
}

const ORDER: Record<SequelStage, number> = { airing: 0, scheduled: 1, announced: 2, released: 3 }

// Airing first, then what starts soonest; announced ones by their (partial) date, unknown dates last.
function compareSequels(a: Sequel, b: Sequel): number {
  if (a.stage !== b.stage) return ORDER[a.stage] - ORDER[b.stage]
  const key = (s: Sequel) => (s.nextEpisode ? s.nextEpisode.airingAt * 1000 : s.startDate.year ? Date.UTC(s.startDate.year, (s.startDate.month ?? 12) - 1, s.startDate.day ?? 28) : Infinity)
  const ka = key(a)
  const kb = key(b)
  return ka === kb ? a.title.localeCompare(b.title) : ka < kb ? -1 : 1
}

// How long a completed entry's cached AniList row stays fresh, by what its sequels are doing (#66): a scheduled
// or airing sequel is checked daily, an announced or released one weekly, and an entry with no sequel monthly
// (AniList adds the SEQUEL edge to the old entry when one is announced, so these are re-checked, slowly).
export function ttlFor(media: AniListMedia | null, now: number): number {
  const stages = sequelEdges(media).map(e => stageOf(e.node, now)?.stage)
  if (!stages.length) return 30 * DAY
  if (stages.some(s => s === 'scheduled' || s === 'airing')) return DAY
  return 7 * DAY
}
