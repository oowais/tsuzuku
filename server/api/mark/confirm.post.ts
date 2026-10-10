import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { useAdapters } from '../../adapters'
import type { WriteResult } from '../../adapters/common'
import { useDb } from '../../db'
import { MarkError, planMark, withAfter, withRating, type MarkStep } from '../../lib/mark-watched'
import { loadUpNext } from '../../lib/up-next-service'
import { createWriteLog } from '../../lib/write-log'

const source = z.enum(['trakt', 'simkl', 'mal'])
const body = z.object({
  rowKey: z.string().min(1),
  // The source clicked, for a row whose sources differ.
  source: source.optional(),
  // The steps you confirmed in the preview, each with what the source showed then, and the list status
  // picked for a last episode (null: leave it to the source; left out: the preview's suggestion), and the
  // score (1-10) when you ticked one for that source (#65).
  steps: z.array(z.object({ source, expected: z.string(), status: z.enum(['completed', 'hold', 'dropped']).nullable().optional(), rating: z.number().int().min(1).max(10).nullable().optional() })).min(1),
  // Today in your own time zone, for MAL's finish date when the mark completes the entry.
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})

export interface MarkOutcome {
  source: z.infer<typeof source>
  ok: boolean
  error?: string
  retryAfter?: number | null
  // Where the source says the item is now (Simkl, MAL), e.g. completed.
  listStatus?: string | null
  // Trakt and Simkl take the score in a call of their own, after the mark: it can fail while the mark stood.
  ratingError?: string
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
    const withStatus = planned && wanted.status !== undefined ? withAfter(planned, wanted.status) : planned
    const step = withStatus && typeof withStatus !== 'string' && wanted.rating ? withRating(withStatus, wanted.rating) : withStatus
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
    else {
      // The first episode sets MAL's start date and Completed its finish date, unless the entry already has one
      // (a rewatch keeps its first). The list status is read only when one of them is due.
      const first = w.watched === 1
      const completes = w.status === 'completed'
      const has = input.today && (first || completes) ? await mal.listStatus(w.mal) : null
      const startDate = first && has && !has.error && !has.startDate ? input.today! : null
      const finishDate = completes && has && !has.error && !has.finishDate ? input.today! : null
      res = await mal.setWatched(w.mal, w.watched, w.status === 'hold' ? 'on_hold' : w.status, { start: startDate, finish: finishDate }, w.rating ?? null)
      if (startDate) step.summary = `${step.summary}, start date ${startDate}`
      if (finishDate) step.summary = `${step.summary}, finish date ${finishDate}`
    }

    log.add(step.source, 'mark_watched', { rowKey: input.rowKey, title: step.title, episode: step.episode, summary: step.summary, expected: step.expected, write: w, link: step.link, listStatus: res.listStatus ?? null, markId, images: row?.images ?? [] }, res.ok ? null : res.error ?? res.status)
    const outcome: MarkOutcome = { source: step.source, ok: res.ok, error: res.ok ? undefined : res.error ?? res.status, retryAfter: res.retryAfter, listStatus: res.listStatus ?? null }
    outcomes.push(outcome)

    // The score for Trakt and Simkl, after their mark went through; a failure is logged and shown, the mark stands.
    if (res.ok && w.rating && w.source !== 'mal') {
      const rated = w.source === 'trakt' ? await trakt.rateShow(w.show, w.rating, now) : await simkl.rate(w.kind, w.simkl, w.rating, now)
      log.add(step.source, 'rate', { rowKey: input.rowKey, title: step.title, episode: step.episode, summary: `Rated ${w.rating}/10`, expected: step.expected, write: { rating: w.rating }, link: step.link, markId, images: row?.images ?? [] }, rated.ok ? null : rated.error ?? rated.status)
      if (!rated.ok) outcome.ratingError = rated.error ?? rated.status
    }
  }
  return { outcomes }
})
