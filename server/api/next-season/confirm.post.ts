import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { useAdapters } from '../../adapters'
import type { WriteResult } from '../../adapters/common'
import { useDb } from '../../db'
import type { Entry } from '../../lib/entries'
import { createMappingStore, MappingError, traktRefFromEntry } from '../../lib/mapping-store'
import { planStart, StartError } from '../../lib/next-season-service'
import { loadUpNext } from '../../lib/up-next-service'
import { createWriteLog } from '../../lib/write-log'

const source = z.enum(['simkl', 'mal'])
const body = z.object({
  rowKey: z.string().min(1),
  malId: z.number().int().positive(),
  // The steps you confirmed, each with what the source showed in the preview.
  steps: z.array(z.object({ source, expected: z.string() })).min(1),
  // Today in your own time zone, for MAL's start date (the server's clock is UTC).
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})

// Starts the next season (#66): reads the lists and MAL's list status again, writes only the steps that still
// match the preview, logs each write, then links the entry to its Trakt season unless a link already does.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  const { rows } = await loadUpNext()
  let plan
  try {
    plan = await planStart(rows, input.rowKey, input.malId)
  } catch (err) {
    if (err instanceof StartError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
  const target = plan.target!
  const row = rows.find(r => r.key === input.rowKey)
  const { mal, simkl } = useAdapters()
  const log = createWriteLog(useDb())
  const markId = randomUUID()
  const outcomes: { source: 'simkl' | 'mal', ok: boolean, error?: string }[] = []

  for (const wanted of input.steps) {
    const step = plan.steps.find(s => s.source === wanted.source)
    if (!step || step.expected !== wanted.expected) {
      const skipped = plan.skipped.find(s => s.source === wanted.source)
      outcomes.push({ source: wanted.source, ok: false, error: skipped?.reason ?? 'Changed since the preview; reload and check' })
      continue
    }
    const startDate = step.setsStartDate && input.today ? input.today : null
    const res: WriteResult = step.source === 'mal' ? await mal.startWatching(target.malId, startDate) : await simkl.addToWatching(target.malId)
    const link = { target: { source: step.source, kind: 'anime' as const, ids: { mal: step.source === 'mal' ? target.malId : undefined } }, episode: { season: null, number: 1 } }
    log.add(step.source, 'start_watching', {
      rowKey: input.rowKey, title: target.title, episode: 'Watching', summary: startDate ? `${step.summary}, start date ${startDate}` : step.summary, expected: step.expected,
      write: { source: step.source, mal: target.malId, status: 'watching', ...(startDate ? { startDate } : {}) }, ...(step.source === 'mal' ? { link } : {}), listStatus: res.listStatus ?? null, markId, images: row?.images ?? []
    }, res.ok ? null : res.error ?? res.status)
    outcomes.push({ source: step.source, ok: res.ok, error: res.ok ? undefined : res.error ?? res.status })
  }

  // Link it to the Trakt season, so it shows on this row as soon as the lists are read again.
  let linkError: string | null = null
  const trakt = row?.cells.trakt?.entry
  if (outcomes.some(o => o.ok) && plan.placement && !plan.placement.linked && trakt) {
    const anime = { source: 'mal', kind: 'anime', ids: { mal: target.malId, ...(target.anilistId ? { anilist: target.anilistId } : {}) }, episodes: target.episodes } as Entry
    try {
      createMappingStore(useDb()).confirm(traktRefFromEntry(trakt), anime, { traktSeason: plan.placement.traktSeason, episodeOffset: plan.placement.episodeOffset })
    } catch (err) {
      if (!(err instanceof MappingError)) throw err
      linkError = err.message
    }
  }
  return { outcomes, linkError, placement: plan.placement }
})
