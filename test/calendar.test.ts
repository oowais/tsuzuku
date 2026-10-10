import { describe, expect, it } from 'vitest'
import type { AniListMedia } from '../server/adapters/anilist'
import { buildCalendar } from '../server/lib/calendar'
import type { Entry } from '../server/lib/entries'
import type { Cell, Row } from '../server/lib/up-next'

const now = Date.UTC(2026, 9, 10, 12)
const DAY = 24 * 60 * 60 * 1000
const from = new Date(Date.UTC(2026, 9, 1))
const to = new Date(Date.UTC(2026, 10, 1))

const entry = (source: Entry['source'], extra: Partial<Entry>): Entry => ({
  source, key: `${source}:1`, kind: 'show', format: null, title: 'T', altTitles: [], year: null, ids: {}, watched: 0,
  episodes: null, next: null, lastActivityAt: null, airing: null, image: null, ...extra
})
const cell = (e: Entry): Cell => ({ source: e.source, state: 'in_sync', entry: e, ref: null, traktNext: null, stale: false, blocked: false, retryAfter: null })
const row = (key: string, entries: Entry[]): Row => ({
  key, section: 'trakt', kind: 'show', title: key, cells: Object.fromEntries(entries.map(e => [e.source, cell(e)])),
  differs: false, signature: '', accepted: false, agrees: false, hasNext: true, lastActivityAt: null, images: []
})
const traktItem = (trakt: number, slug: string, season: number, number: number, at: number) =>
  ({ first_aired: new Date(at).toISOString(), episode: { season, number, title: `Ep ${number}` }, show: { title: `Show ${trakt}`, ids: { trakt, slug } } })

describe('calendar', () => {
  it('keeps every Trakt calendar show, groups it with its Up Next row, and fades what you watched', () => {
    const harbor = row('trakt:1', [entry('trakt', { ids: { trakt: 1, traktSlug: 'harbor' }, next: { season: 2, number: 5, title: null } })])
    const items = buildCalendar({
      rows: [harbor],
      trakt: [
        traktItem(1, 'harbor', 2, 4, now - 8 * DAY),
        traktItem(1, 'harbor', 2, 5, now - 5 * DAY),
        traktItem(2, 'ferry', 3, 3, now + DAY),
        // Outside the range: left out.
        traktItem(2, 'ferry', 3, 7, to.getTime() + DAY)
      ],
      anilist: {}, airing: [], from, to, now
    })
    expect(items.map(i => [i.group, i.episode, i.watched, i.onUpNext])).toEqual([
      ['trakt:1', 'S2E4', true, true],
      ['trakt:1', 'S2E5', false, true],
      ['trakt:2', 'S3E3', false, false]
    ])
    expect(items[0]!.url).toBe('https://trakt.tv/shows/harbor/seasons/2/episodes/4')
  })

  it('lists AniList episodes for the anime on Up Next with AniList\'s own title, watched by your MAL count', () => {
    const anime = row('mal:50', [
      entry('mal', { kind: 'anime', ids: { mal: 50 }, watched: 5 }),
      entry('simkl', { kind: 'anime', ids: { mal: 50, simkl: 7 }, watched: 4, next: { season: null, number: 5, title: 'Five', airedAt: '2026-10-08T00:00:00+09:00' } })
    ])
    const media = { 50: { id: 500, idMal: 50, title: { english: 'Starling Tide', romaji: 'Mukudori' } } as AniListMedia }
    const items = buildCalendar({
      rows: [anime],
      trakt: [],
      anilist: media,
      airing: [{ mediaId: 500, episode: 5, airingAt: (now - 2 * DAY) / 1000 }, { mediaId: 500, episode: 6, airingAt: (now + 5 * DAY) / 1000 }, { mediaId: 999, episode: 1, airingAt: now / 1000 }],
      from, to, now
    })
    expect(items.map(i => [i.source, i.title, i.episode, i.watched, i.dateOnly])).toEqual([
      // Simkl's date as written, its own count (4) not watched E5.
      ['simkl', 'T', 'E5', false, true],
      ['anilist', 'Starling Tide', 'E5', true, false],
      ['anilist', 'Starling Tide', 'E6', false, false]
    ])
    expect(items[0]!.airsAt).toBe('2026-10-08')
    expect(items[1]!.url).toBe('https://anilist.co/anime/500')
  })

  it('treats aired episodes of a show caught up on Trakt as watched', () => {
    const caughtUp = row('trakt:3', [entry('trakt', { ids: { trakt: 3, traktSlug: 'orbit' }, next: null })])
    const items = buildCalendar({ rows: [caughtUp], trakt: [traktItem(3, 'orbit', 1, 6, now - DAY), traktItem(3, 'orbit', 1, 7, now + DAY)], anilist: {}, airing: [], from, to, now })
    expect(items.map(i => i.watched)).toEqual([true, false])
  })
})
