// The Trakt card's history figures (#61), in the browser's time zone: plays since Monday 00:00 and since the
// 1st of the month (from the last 32 days' watch times; null when they could not be read), and the weekly
// average since your first play.
export function historyFigures(h: { total: number | null, first: string | null, recent: string[] | null }, now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7).getTime()
  const times = (h.recent ?? []).map(t => Date.parse(t)).filter(t => !Number.isNaN(t))
  const first = h.first ? Date.parse(h.first) : Number.NaN
  const weeks = Math.max(1, (now.getTime() - first) / (7 * 24 * 60 * 60 * 1000))
  return {
    week: h.recent ? times.filter(t => t >= weekStart).length : null,
    month: h.recent ? times.filter(t => t >= monthStart).length : null,
    weeklyAverage: h.total !== null && !Number.isNaN(first) ? h.total / weeks : null
  }
}
