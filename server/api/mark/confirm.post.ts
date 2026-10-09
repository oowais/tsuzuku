import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { useAdapters } from '../../adapters'
import type { WriteResult } from '../../adapters/common'
import { useDb } from '../../db'
import { MarkError, planMark, withAfter, type MarkStep } from '../../lib/mark-watched'
import { loadUpNext } from '../../lib/up-next-service'
import { createWriteLog } from '../../lib/write-log'

const source = z.enum(['trakt', 'simkl', 'mal'])
const body = z.object({
  rowKey: z.string().min(1),
  // The source clicked, for a row whose sources differ.
  source: source.optional(),
  // The steps you confirmed in the preview, each with what the source showed then, and the list status
  // picked for a last episode (null: leave it to the source; left out: the preview's suggestion).
  steps: z.array(z.object({ source, expected: z.string(), status: z.enum(['completed', 'hold', 'dropped']).nullable().optional() })).min(1)
})

export interface MarkOutcome {
  source: z.infer<typeof source>
  ok: boolean
  error?: string
  retryAfter?: number | null
  // Where the source says the item is now (Simkl, MAL), e.g. completed.
  listStatus?: string | null
}

// Writes the confirmed steps, one source after another. Each source is read again first and only written
// when it still shows what the preview showed, so a retry after a lost answer cannot mark an episode twice.
export default defineEventHandler(async (event) => {
  const input = body.parse(await readBody(event))
  const { trakt, simkl, mal } = useAdapters()
  const log = createWriteLog(useDb())

  const { rows } = await loadUpNext()
  const row = rows.find(r => r.key === input.rowKey)
  let fresh: MarkStep[] = []
  let planError: string | null = row ? null : 'This show is no longer on Up Next'
  if (row) {
    try {
      fresh = planMark(row, input.source).steps
    } catch (err) {
      if (!(err instanceof MarkError)) throw err
      planError = err.message
    }
  }

  const outcomes: MarkOutcome[] = []
  const markId = randomUUID()
  for (const wanted of input.steps) {
    const planned = fresh.find(s => s.source === wanted.source)
    const step = planned && wanted.status !== undefined ? withAfter(planned, wanted.status) : planned
    if (typeof step === 'string') {
      outcomes.push({ source: wanted.source, ok: false, error: step })
      continue
    }
    if (!step || step.expected !== wanted.expected) {
      // Not written, so not logged: the source moved since the preview, or cannot be read right now.
      outcomes.push({ source: wanted.source, ok: false, error: planError ?? 'Changed since the preview; reload and check' })
      continue
    }
    const done = log.recentSuccess(step.source, input.rowKey, step.expected)
    if (done) {
      outcomes.push({ source: step.source, ok: false, error: `Already marked at ${done.at.toISOString().slice(0, 16).replace('T', ' ')} UTC; the source has not caught up yet` })
      continue
    }
    const w = step.write
    const now = new Date()
    let res: WriteResult
    if (w.source === 'trakt') res = await trakt.markWatched(w.show, { season: w.season, number: w.number }, now)
    else if (w.source === 'simkl') res = await simkl.markWatched(w.kind, w.simkl, { season: w.season, number: w.number }, now, w.status)
    else res = await mal.setWatched(w.mal, w.watched, w.status === 'hold' ? 'on_hold' : w.status)

    log.add(step.source, 'mark_watched', { rowKey: input.rowKey, title: step.title, episode: step.episode, summary: step.summary, expected: step.expected, write: w, listStatus: res.listStatus ?? null, markId }, res.ok ? null : res.error ?? res.status)
    outcomes.push({ source: step.source, ok: res.ok, error: res.ok ? undefined : res.error ?? res.status, retryAfter: res.retryAfter, listStatus: res.listStatus ?? null })
  }
  return { outcomes }
})
