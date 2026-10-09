import { describe, expect, it } from 'vitest'
import { groupLog, type LogEntry } from '../shared/utils/log-groups'

const T = Date.UTC(2026, 9, 9, 20)
const MIN = 60 * 1000
let id = 0
const entry = (minutesAgo: number, source: string, extra: Partial<LogEntry> = {}): LogEntry => ({
  id: ++id, at: new Date(T - minutesAgo * MIN).toISOString(), source, rowKey: 'm:1', markId: null, title: `${source} title`,
  episode: 'E1', summary: 's', listStatus: null, result: 'ok', error: null, ...extra
})

describe('log grouping', () => {
  it('starts a new session after a gap of 3 hours or more', () => {
    const sessions = groupLog([entry(0, 'trakt'), entry(179, 'trakt'), entry(359, 'trakt'), entry(540, 'trakt')])
    expect(sessions.map(s => s.marks.length)).toEqual([2, 1, 1])
    expect(sessions[0]!.end.getTime()).toBe(T)
    expect(sessions[0]!.start.getTime()).toBe(T - 179 * MIN)
  })

  it('makes one mark of the writes of one confirm, in Trakt, Simkl, MAL order, titled by the first', () => {
    const [s] = groupLog([
      entry(0, 'mal', { markId: 'a', title: 'Getsuraku Gakuen Part 2' }),
      entry(0, 'trakt', { markId: 'a', title: 'Moonfall Academy' }),
      entry(0, 'simkl', { markId: 'a', result: 'error', error: 'HTTP 503' }),
      entry(5, 'trakt', { markId: 'b', rowKey: 'm:2' })
    ])
    expect(s!.marks).toHaveLength(2)
    expect(s!.marks[0]).toMatchObject({ title: 'Moonfall Academy', ok: false })
    expect(s!.marks[0]!.entries.map(e => e.source)).toEqual(['trakt', 'simkl', 'mal'])
    expect(s!.shows).toBe(2)
  })

  it('keeps two marks of the same show apart, and joins older entries without a markId by time and source', () => {
    const [s] = groupLog([
      entry(0, 'trakt', { markId: 'x' }),
      entry(2, 'trakt', { markId: 'y' }),
      entry(30, 'trakt'),
      entry(30.5, 'mal'),
      entry(40, 'trakt')
    ])
    expect(s!.marks.map(m => m.entries.length)).toEqual([1, 1, 2, 1])
  })

  it('handles an empty log', () => {
    expect(groupLog([])).toEqual([])
  })
})
