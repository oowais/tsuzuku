import { useAdapters } from '../adapters'
import { useDb } from '../db'
import { episodeLabel } from '../../shared/utils/source-links'
import { createMappingStore } from './mapping-store'
import { placementFor, previousLinked, sequelsOf, startable, storedFor, targetOf, type StartPlacement, type StartSource, type StartTarget } from './next-season'
import { seasonChains } from './seasons'
import type { Row } from './up-next'

export interface StartStep {
  source: StartSource
  summary: string
  // MAL: the entry has no start date, so today's is set with it; the date it keeps otherwise.
  setsStartDate?: boolean
  keepsStartDate?: string | null
  // What the source showed when planned; the confirm refuses the write if it has moved since.
  expected: string
}

export interface StartPlan {
  rowKey: string
  title: string
  // Trakt's next episode, e.g. S2E1.
  traktNext: string
  target: StartTarget | null
  // Several sequels to choose from, when AniList names more than one.
  choices: StartTarget[]
  placement: StartPlacement | null
  steps: StartStep[]
  skipped: { source: StartSource, reason: string }[]
  // Nothing links the show to an anime, or no sequel is known: pick one from a search.
  needsSearch: boolean
}

export class StartError extends Error {}

const MAL_STATUS: Record<string, string> = { completed: 'Completed', on_hold: 'On Hold', dropped: 'Dropped', watching: 'Watching', plan_to_watch: 'Plan to Watch' }

// The plan for one row: which entry, where it goes, and what each source would do. `malId` is the entry you
// picked (from the sequels offered or a search); without it, the stored link or AniList's sequel.
export async function planStart(rows: Row[], rowKey: string, malId?: number): Promise<StartPlan> {
  const row = rows.find(r => r.key === rowKey)
  if (!row) throw new StartError('This show is no longer on Up Next')
  const next = row.cells.trakt?.entry?.next
  const can = startable(row)
  if (!next || next.season === null || (!can.search && !can.sources.length)) throw new StartError('Nothing to start for this show')
  const at = { season: next.season, number: next.number }
  const { anilist } = useAdapters()
  const lookup = async (ids: number[]) => (await anilist.byMalIds(ids)).media

  const mapping = row.key.startsWith('m:') ? createMappingStore(useDb()).all().find(m => `m:${m.id}` === row.key) : undefined
  const seasons = mapping?.seasons ?? []
  const plan: StartPlan = { rowKey, title: row.title, traktNext: episodeLabel(next), target: null, choices: [], placement: null, steps: [], skipped: [], needsSearch: false }

  if (malId !== undefined) {
    const media = (await lookup([malId]))[malId]
    if (!media) throw new StartError('AniList does not know this MAL entry')
    plan.target = targetOf(media)
  } else {
    const stored = storedFor(seasons, at)
    if (stored) {
      const media = (await lookup([stored.malId!]))[stored.malId!]
      plan.target = media ? targetOf(media) : { malId: stored.malId!, anilistId: null, title: `MAL #${stored.malId}`, format: null, episodes: stored.episodeCount, status: null, year: null }
    } else {
      const prev = previousLinked(seasons, at)
      const sequels = prev ? sequelsOf((await lookup([prev.malId!]))[prev.malId!]) : []
      if (sequels.length === 1) plan.target = sequels[0]!
      else plan.choices = sequels
      plan.needsSearch = !sequels.length
    }
  }
  if (!plan.target) return plan

  // Where it goes: a stored link as it is; else lined up with Trakt's next episode.
  const link = seasons.find(s => s.malId === plan.target!.malId)
  if (link && link.traktSeason !== null) plan.placement = { traktSeason: link.traktSeason, episodeOffset: link.episodeOffset, linked: true }
  else plan.placement = placementFor(at, (await seasonChains([plan.target.malId], lookup))[plan.target.malId] ?? [])

  // Without a link, both sources are offered; with one, the sources that have nothing listed for it.
  const sources: StartSource[] = can.search ? ['mal', 'simkl'] : can.sources
  for (const source of sources) {
    if (source === 'mal') {
      const ls = await useAdapters().mal.listStatus(plan.target.malId)
      if (ls.error) plan.skipped.push({ source, reason: `could not read MAL: ${ls.error}` })
      else if (ls.status && ls.status !== 'plan_to_watch') plan.skipped.push({ source, reason: `already on your MAL list as ${MAL_STATUS[ls.status] ?? ls.status}${ls.watched !== null ? ` (${ls.watched} watched)` : ''}; change it on MAL` })
      else plan.steps.push({ source, summary: ls.status ? 'Move from Plan to Watch to Watching' : 'Add to Watching, 0 episodes watched', expected: ls.status ?? 'none', setsStartDate: !ls.startDate, keepsStartDate: ls.startDate })
      continue
    }
    const listed = rows.some(r => r.cells.simkl?.entry?.ids.mal === plan.target!.malId)
    if (listed) plan.skipped.push({ source, reason: 'already on your Simkl Watching list' })
    else plan.steps.push({ source, summary: 'Add to Watching (found by its MAL ID); moves it there if it is on another list', expected: 'not_watching' })
  }
  return plan
}
