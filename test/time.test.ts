import { describe, expect, it } from 'vitest'
import { isFuture, relativeTime, shortDate } from '../app/utils/time'

describe('time', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')

  it('shows a midnight date as the calendar date the source wrote', () => {
    expect(shortDate('2026-09-06T00:00:00+09:00', new Date(now))).toBe('6 Sept')
    expect(shortDate('2026-10-10', new Date(now))).toBe('10 Oct')
    expect(shortDate('2025-01-02', new Date(now))).toBe('2 Jan 2025')
    expect(shortDate('nope')).toBeNull()
  })

  it('says how long ago or until', () => {
    expect(relativeTime('2026-10-06T12:00:00Z', now)).toBe('3 days ago')
    expect(relativeTime('2026-10-11T12:00:00Z', now)).toBe('in 2 days')
    expect(relativeTime(null, now)).toBeNull()
    expect(isFuture('2026-10-11T12:00:00Z', now)).toBe(true)
  })
})
