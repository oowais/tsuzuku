// Dates for display: "3 days ago", "in 2 days", "10 Aug" (with the year when it is not this year).
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536e6], ['month', 2592e6], ['day', 864e5], ['hour', 36e5], ['minute', 6e4]]

export function relativeTime(iso: string | null | undefined, now = Date.now()): string | null {
  const t = iso ? Date.parse(iso) : Number.NaN
  if (Number.isNaN(t)) return null
  const diff = t - now
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit)
  }
  return 'just now'
}

// A midnight timestamp is a calendar date in the source's timezone (Simkl sends `2026-09-06T00:00:00+09:00`
// for an episode airing on 6 Sept in Japan); it is shown as written, not moved into the local timezone.
const CALENDAR_DATE = /^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

export function shortDate(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null
  const calendar = CALENDAR_DATE.exec(iso)
  const d = new Date(calendar ? `${calendar[1]}T12:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(calendar ? { timeZone: 'UTC' } : {}),
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {})
  })
}

export const isFuture = (iso: string | null | undefined, now = Date.now()) => !!iso && Date.parse(iso) > now
