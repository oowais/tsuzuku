// The Trakt card's history figures (#61), in the browser's time zone, from the last 32 days' watch times (null
// when they could not be read): plays since Monday 00:00, since the 1st of the month, and per week over the
// last 4 weeks.
export function historyFigures(recent: string[] | null, now = new Date()) {
  if (!recent) return null
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7).getTime()
  const fourWeeks = now.getTime() - 28 * 24 * 60 * 60 * 1000
  const times = recent.map(t => Date.parse(t)).filter(t => !Number.isNaN(t))
  return {
    week: times.filter(t => t >= weekStart).length,
    month: times.filter(t => t >= monthStart).length,
    weeklyAverage: times.filter(t => t >= fourWeeks).length / 4
  }
}
