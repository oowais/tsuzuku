import { and, eq, isNull, or } from 'drizzle-orm'
import type { Db } from '../db'
import { mappings, mappingSeasons, rejectedCandidates } from '../db/schema'
import type { Entry, NextEpisode } from './entries'
import type { LinkGroup } from './mapping'
import { proposePlacement, scoreTraktShow, type ChainStep, type Placement } from './seasons'
import { USER_ID } from './user'

// Stored links (decision #14). Links proven by shared IDs are stored as `auto`; a season placement is
// stored only when you confirm it. Writes here touch the local database only, never a source.

type Mapping = typeof mappings.$inferSelect
type Season = typeof mappingSeasons.$inferSelect

// Below this a title match is not worth proposing.
export const MIN_PROPOSAL_SCORE = 0.5

export class MappingError extends Error {}

// A Trakt show to link to: one on your up-next list, or one Trakt returned for a lookup or search.
export interface TraktRef {
  trakt: number
  slug: string | null
  tmdb: number | null
  title: string
  year: number | null
  // Trakt's next episode for you; only known for shows on your up-next list.
  next: NextEpisode | null
  onList: boolean
}

export function traktRefFromEntry(e: Entry): TraktRef {
  return { trakt: e.ids.trakt!, slug: e.ids.traktSlug ?? null, tmdb: e.ids.tmdb ?? null, title: e.title, year: e.year, next: e.next, onList: true }
}

export function traktRefFromShow(show: { trakt: number, slug: string, tmdb: number | null, title: string, year: number | null }): TraktRef {
  return { trakt: show.trakt, slug: show.slug, tmdb: show.tmdb, title: show.title, year: show.year, next: null, onList: false }
}

export function createMappingStore(db: Db, userId = USER_ID) {
  const mine = eq(mappings.userId, userId)

  const mappingByTrakt = (traktId: number) =>
    db.select().from(mappings).where(and(mine, eq(mappings.traktId, traktId))).get()

  const seasonFor = (ids: { mal?: number, simkl?: number }) => {
    const match = [
      ids.mal !== undefined ? eq(mappingSeasons.malId, ids.mal) : undefined,
      ids.simkl !== undefined ? eq(mappingSeasons.simklId, ids.simkl) : undefined
    ].filter(c => c !== undefined)
    if (!match.length) return undefined
    return db.select().from(mappingSeasons).where(and(eq(mappingSeasons.userId, userId), or(...match))).get()
  }

  const mappingById = (id: number) => db.select().from(mappings).where(and(mine, eq(mappings.id, id))).get()

  function traktMapping(trakt: TraktRef, status: 'auto' | 'confirmed'): Mapping {
    const existing = mappingByTrakt(trakt.trakt)
    if (existing) {
      const set = {
        ...(status === 'confirmed' && existing.status !== 'confirmed' ? { status, kind: 'anime' as const } : {}),
        ...(existing.traktSlug === null && trakt.slug ? { traktSlug: trakt.slug } : {})
      }
      if (Object.keys(set).length) db.update(mappings).set(set).where(eq(mappings.id, existing.id)).run()
      return mappingById(existing.id)!
    }
    return db.insert(mappings).values({ userId, traktId: trakt.trakt, traktSlug: trakt.slug, tmdbId: trakt.tmdb, kind: 'anime', status }).returning().get()
  }

  // A non-anime show on Simkl linked to its Trakt show by a real ID (Simkl's traktslug, confirmed by Trakt).
  function linkShow(simkl: Entry, trakt: TraktRef) {
    db.transaction(() => {
      const existing = mappingByTrakt(trakt.trakt)
        ?? db.select().from(mappings).where(and(mine, eq(mappings.simklId, simkl.ids.simkl!))).get()
      if (!existing) {
        db.insert(mappings).values({ userId, kind: 'show', status: 'auto', traktId: trakt.trakt, traktSlug: trakt.slug, simklId: simkl.ids.simkl, tmdbId: trakt.tmdb ?? simkl.ids.tmdb }).run()
        return
      }
      const set = {
        ...(existing.traktId === null ? { traktId: trakt.trakt, traktSlug: trakt.slug } : {}),
        ...(existing.simklId === null ? { simklId: simkl.ids.simkl } : {})
      }
      if (Object.keys(set).length) db.update(mappings).set(set).where(eq(mappings.id, existing.id)).run()
    })
  }

  const mappingBySimkl = (simklId: number) => db.select().from(mappings).where(and(mine, eq(mappings.simklId, simklId))).get()

  // Moves a season row to another show; a show left with no Trakt ID and no seasons is removed.
  function moveSeason(season: Season, toMappingId: number, values: Partial<typeof mappingSeasons.$inferInsert> = {}) {
    db.update(mappingSeasons).set({ ...values, mappingId: toMappingId }).where(eq(mappingSeasons.id, season.id)).run()
    if (season.mappingId === toMappingId) return
    const old = mappingById(season.mappingId)
    const left = db.select().from(mappingSeasons).where(eq(mappingSeasons.mappingId, season.mappingId)).all()
    if (old && old.traktId === null && left.length === 0) db.delete(mappings).where(eq(mappings.id, old.id)).run()
  }

  // Stores every conflict-free ID group. Never overrides a confirmed choice or moves an entry between two Trakt shows.
  function syncAutoLinks(entries: Entry[], groups: LinkGroup[]) {
    const byKey = new Map(entries.map(e => [e.key, e]))
    for (const group of groups) {
      if (group.conflict) continue
      const members = group.keys.map(k => byKey.get(k)!).filter(Boolean)
      const trakt = members.find(m => m.source === 'trakt')
      const simkl = members.find(m => m.source === 'simkl')
      const mal = members.find(m => m.source === 'mal')
      const anime = simkl?.kind === 'anime' || !!mal

      db.transaction(() => {
        if (!anime) {
          if (!trakt || !simkl) return
          const existing = mappingByTrakt(trakt.ids.trakt!)
            ?? db.select().from(mappings).where(and(mine, eq(mappings.simklId, simkl.ids.simkl!))).get()
          if (existing) {
            if (existing.traktId === null) db.update(mappings).set({ traktId: trakt.ids.trakt, traktSlug: trakt.ids.traktSlug }).where(eq(mappings.id, existing.id)).run()
            if (existing.simklId === null) db.update(mappings).set({ simklId: simkl.ids.simkl }).where(eq(mappings.id, existing.id)).run()
            return
          }
          db.insert(mappings).values({ userId, kind: 'show', status: 'auto', traktId: trakt.ids.trakt, traktSlug: trakt.ids.traktSlug, simklId: simkl.ids.simkl, tmdbId: trakt.ids.tmdb ?? simkl.ids.tmdb }).run()
          return
        }

        const ids = { mal: mal?.ids.mal ?? simkl?.ids.mal, simkl: simkl?.ids.simkl, anilist: simkl?.ids.anilist }
        const season = seasonFor(ids)
        const fill = {
          ...(ids.mal !== undefined ? { malId: ids.mal } : {}),
          ...(ids.simkl !== undefined ? { simklId: ids.simkl } : {}),
          ...(ids.anilist !== undefined ? { anilistId: ids.anilist } : {}),
          ...(mal?.episodes ? { episodeCount: mal.episodes } : {})
        }

        if (trakt) {
          const target = traktMapping(traktRefFromEntry(trakt), 'auto')
          if (!season) {
            db.insert(mappingSeasons).values({ userId, mappingId: target.id, traktSeason: null, ...fill }).run()
            return
          }
          const owner = mappingById(season.mappingId)
          // Already placed under a different Trakt show: leave it, that was a choice.
          if (owner && owner.traktId !== null && owner.traktId !== trakt.ids.trakt) return
          moveSeason(season, target.id, fill)
          return
        }

        if (season) {
          db.update(mappingSeasons).set(fill).where(eq(mappingSeasons.id, season.id)).run()
          return
        }
        const created = db.insert(mappings).values({ userId, kind: 'anime', status: 'auto' }).returning().get()
        db.insert(mappingSeasons).values({ userId, mappingId: created.id, traktSeason: null, ...fill }).run()
      })
    }
  }

  function isRejected(traktId: number, malId: number) {
    return !!db.select().from(rejectedCandidates).where(and(
      eq(rejectedCandidates.userId, userId),
      eq(rejectedCandidates.source, 'mal'),
      eq(rejectedCandidates.sourceItemId, String(malId)),
      eq(rejectedCandidates.candidateSource, 'trakt'),
      eq(rejectedCandidates.candidateId, String(traktId))
    )).get()
  }

  // Places an anime entry in a Trakt season. The anime entry must be on your current lists, and the Trakt
  // show either on your up-next list or confirmed to exist by Trakt; callers check both.
  function confirm(trakt: TraktRef, anime: Entry, place: { traktSeason: number, episodeOffset: number }) {
    const ids = { mal: anime.ids.mal, simkl: anime.ids.simkl }
    db.transaction(() => {
      const target = traktMapping(trakt, 'confirmed')
      const season = seasonFor(ids)
      const values = {
        traktSeason: place.traktSeason,
        episodeOffset: place.episodeOffset,
        ...(anime.ids.mal !== undefined ? { malId: anime.ids.mal } : {}),
        ...(anime.ids.simkl !== undefined ? { simklId: anime.ids.simkl } : {}),
        ...(anime.ids.anilist !== undefined ? { anilistId: anime.ids.anilist } : {}),
        ...(anime.source === 'mal' && anime.episodes ? { episodeCount: anime.episodes } : {})
      }
      const clash = db.select().from(mappingSeasons).where(and(
        eq(mappingSeasons.mappingId, target.id),
        eq(mappingSeasons.traktSeason, place.traktSeason),
        eq(mappingSeasons.episodeOffset, place.episodeOffset)
      )).get()
      if (clash && clash.id !== season?.id) throw new MappingError(`Trakt season ${place.traktSeason} with offset ${place.episodeOffset} is already linked to another entry`)

      if (!season) {
        db.insert(mappingSeasons).values({ userId, mappingId: target.id, ...values }).run()
        return
      }
      const owner = mappingById(season.mappingId)
      if (owner && owner.traktId !== null && owner.traktId !== trakt.trakt) {
        throw new MappingError('This entry is already linked to another Trakt show')
      }
      moveSeason(season, target.id, values)
    })
  }

  function reject(traktId: number, malId: number) {
    db.insert(rejectedCandidates).values({
      userId,
      source: 'mal',
      sourceItemId: String(malId),
      candidateSource: 'trakt',
      candidateId: String(traktId)
    }).onConflictDoNothing().run()
  }

  function all() {
    const rows = db.select().from(mappings).where(mine).all()
    const seasons = db.select().from(mappingSeasons).where(eq(mappingSeasons.userId, userId)).all()
    return rows.map(m => ({ ...m, seasons: seasons.filter(s => s.mappingId === m.id) }))
  }

  const unplaced = () => db.select().from(mappingSeasons).where(and(eq(mappingSeasons.userId, userId), isNull(mappingSeasons.traktSeason))).all()

  return { syncAutoLinks, linkShow, confirm, reject, isRejected, all, unplaced, seasonFor, mappingById, mappingBySimkl }
}

export interface Proposal {
  // The anime entry to place, by its key on your lists (MAL entry when there is one, else Simkl).
  animeKey: string
  trakt: TraktRef
  // How the Trakt show was found.
  via: 'ids' | 'title'
  score: number
  placement: Placement
  // First season to this entry, as AniList knows it.
  chain: { malId: number, title: string, format: string | null, episodes: number | null }[]
}

// Trakt shows found by real IDs for entries that are not linked to a Trakt show yet:
// `byMal` from Simkl's traktslug or TMDB ID (looked up on Trakt), `byTrakt` for stored links whose show is
// no longer on your up-next list.
export interface TraktLookups {
  byMal: Map<number, TraktRef>
  byTrakt: Map<number, TraktRef>
}

// One proposal per anime entry not yet placed in a Trakt season: the show its IDs point to, else the best
// title match among the shows on your Trakt list. Rejected pairs are never proposed again.
export function buildProposals(
  entries: Entry[],
  chains: Record<number, ChainStep[]>,
  store: ReturnType<typeof createMappingStore>,
  lookups: TraktLookups = { byMal: new Map(), byTrakt: new Map() }
): Proposal[] {
  const traktShows = entries.filter(e => e.source === 'trakt')
  // One entry per anime: MAL's when present, since its MAL ID is what the chain is keyed on.
  const anime = new Map<number, Entry>()
  for (const e of entries) {
    const malId = e.ids.mal
    if (e.kind !== 'anime' || malId === undefined) continue
    if (!anime.has(malId) || e.source === 'mal') anime.set(malId, e)
  }

  const proposals: Proposal[] = []
  for (const [malId, entry] of anime) {
    const season = store.seasonFor({ mal: malId, simkl: entry.ids.simkl })
    if (season && season.traktSeason !== null) continue
    const chain = chains[malId] ?? []
    const owner = season ? store.mappingById(season.mappingId) : undefined

    let match: { show: TraktRef, via: 'ids' | 'title', score: number } | undefined
    if (owner?.traktId != null) {
      const listed = traktShows.find(s => s.ids.trakt === owner.traktId)
      const show = listed ? traktRefFromEntry(listed) : lookups.byTrakt.get(owner.traktId)
      if (show) match = { show, via: 'ids', score: 1 }
    } else {
      const byId = lookups.byMal.get(malId)
      if (byId && !store.isRejected(byId.trakt, malId)) {
        const listed = traktShows.find(s => s.ids.trakt === byId.trakt)
        match = { show: listed ? traktRefFromEntry(listed) : byId, via: 'ids', score: 1 }
      } else {
        const best = traktShows
          .filter(show => !store.isRejected(show.ids.trakt!, malId))
          .map(show => ({ show, score: scoreTraktShow(show, chain) }))
          .filter(c => c.score >= MIN_PROPOSAL_SCORE)
          .sort((a, b) => b.score - a.score)[0]
        if (best) match = { show: traktRefFromEntry(best.show), via: 'title', score: best.score }
      }
    }
    if (!match) continue

    const sameEntry = entries.filter(e => e.kind === 'anime' && e.ids.mal === malId)
    proposals.push({
      animeKey: entry.key,
      trakt: match.show,
      via: match.via,
      score: Math.round(match.score * 100) / 100,
      placement: proposePlacement(match.show, sameEntry, chain),
      chain: chain.map(s => ({ malId: s.malId, title: s.titles[0] ?? `MAL ${s.malId}`, format: s.format, episodes: s.episodes }))
    })
  }
  return proposals
}
