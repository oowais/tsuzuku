import { isDemo } from '../../demo'

// A generated poster for demo mode: a colour from the row and the title's initials. Not found otherwise.
export default defineEventHandler((event) => {
  if (!isDemo()) throw createError({ statusCode: 404 })
  const { key = '', title = '' } = getQuery(event) as { key?: string, title?: string }
  let hash = 0
  for (const c of `${key}${title}`) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  // Golden-angle steps, so neighbouring rows get clearly different colours.
  const hue = Math.round((hash * 137.508) % 360)
  const initials = String(title).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')
    .replace(/[^\p{L}\p{N}]/gu, '')
  setHeader(event, 'content-type', 'image/svg+xml')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="hsl(${hue} 45% 35%)"/><rect x="12" y="12" width="176" height="276" rx="10" fill="none" stroke="hsl(${hue} 60% 70%)" stroke-width="3"/><text x="100" y="170" text-anchor="middle" font-family="sans-serif" font-size="72" font-weight="700" fill="hsl(${hue} 70% 88%)">${initials}</text></svg>`
})
