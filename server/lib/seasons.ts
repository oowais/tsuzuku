import type { AniListMedia } from '../adapters/anilist'
import type { Entry } from './entries'

// Anime season chains (decision #15). Simkl and MAL list each season or cour as its own entry, Trakt has one
// show with seasons. AniList PREQUEL relations lead from a season entry back to the first season; the first
// season's titles are what a Trakt show is usually called. Everything here only proposes; you confirm.

export interface ChainStep {
  malId: number
  anilistId: number
  format: string | null
  episodes: number | null
  year: number | null
  titles: string[]
}

type Edge = { relationType?: string, node?: { type?: string, format?: string, idMal?: number | null, episodes?: number | null } }

// Series formats a season chain may pass through. Movies, specials and OVAs are side stories, not seasons.
const SERIES_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA'])
// A "prequel" this short is a one-off (One Piece's prequel on AniList is a 1-episode ONA), not a season.
const MIN_SEASON_EPISODES = 4
const MAX_CHAIN = 20

function relationsOf(media: AniListMedia): Edge[] {
  const relations = media.relations as { edges?: Edge[] } | undefined
  return Array.isArray(relations?.edges) ? relations.edges : []
}

// The one series prequel of an entry, or null when there is none or more than one (then the chain stops).
export function seriesPrequel(media: AniListMedia): number | null {
  const prequels = relationsOf(media).filter(e =>
    e.relationType === 'PREQUEL'
    && e.node?.type === 'ANIME'
    && SERIES_FORMATS.has(e.node.format ?? '')
    && typeof e.node.idMal === 'number'
    && (e.node.episodes == null || e.node.episodes >= MIN_SEASON_EPISODES))
  return prequels.length === 1 ? prequels[0]!.node!.idMal! : null
}

// The series sequels of an entry (#66): SEQUEL edges to a TV / ONA entry with a MAL ID, leaving out side
// stories, recaps and one-off specials. Usually one; several when AniList lists more than one next entry.
export function seriesSequels(media: AniListMedia): { malId: number, anilistId: number | null, title: string, format: string | null, episodes: number | null, status: string | null, year: number | null }[] {
  return relationsOf(media)
    .filter(e => e.relationType === 'SEQUEL' && e.node?.type === 'ANIME' && SERIES_FORMATS.has(e.node.format ?? '')
      && typeof e.node.idMal === 'number' && (e.node.episodes == null || e.node.episodes >= MIN_SEASON_EPISODES))
    .map((e) => {
      const n = e.node as NonNullable<Edge['node']> & { id?: number, status?: string, title?: { romaji?: string, english?: string }, startDate?: { year?: number | null } }
      return { malId: n.idMal!, anilistId: n.id ?? null, title: n.title?.english || n.title?.romaji || `MAL #${n.idMal}`, format: n.format ?? null, episodes: n.episodes ?? null, status: n.status ?? null, year: n.startDate?.year ?? null }
    })
}

export function stepOf(media: AniListMedia): ChainStep {
  const title = (media.title ?? {}) as Record<string, unknown>
  const synonyms = Array.isArray(media.synonyms) ? media.synonyms : []
  const titles = [title.english, title.romaji, title.native, ...synonyms].filter((t): t is string => typeof t === 'string' && t !== '')
  const start = (media.startDate ?? {}) as { year?: number | null }
  return {
    malId: media.idMal!,
    anilistId: media.id,
    format: typeof media.format === 'string' ? media.format : null,
    episodes: typeof media.episodes === 'number' ? media.episodes : null,
    year: typeof start.year === 'number' ? start.year : null,
    titles: [...new Set(titles)]
  }
}

export type MediaLookup = (malIds: number[]) => Promise<Record<number, AniListMedia | null>>

// For each MAL ID, the chain from the first season to that entry, walking one hop per round so every
// round is one batched AniList lookup. A chain stops early where AniList has no data (not found, or the
// lookup was blocked); what was walked so far is still returned.
export async function seasonChains(malIds: number[], lookup: MediaLookup): Promise<Record<number, ChainStep[]>> {
  const known: Record<number, AniListMedia | null> = {}
  const chains: Record<number, ChainStep[]> = {}
  const tips = new Map<number, number>()
  for (const id of new Set(malIds)) tips.set(id, id)

  for (let round = 0; round < MAX_CHAIN && tips.size; round++) {
    const needed = [...new Set(tips.values())].filter(id => !(id in known))
    if (needed.length) Object.assign(known, await lookup(needed))

    for (const [start, tip] of [...tips]) {
      const media = known[tip]
      if (!media || typeof media.idMal !== 'number') {
        tips.delete(start)
        continue
      }
      const chain = chains[start] ?? []
      chain.unshift(stepOf(media))
      chains[start] = chain
      const prev = seriesPrequel(media)
      if (prev === null || chain.some(step => step.malId === prev)) tips.delete(start)
      else tips.set(start, prev)
    }
  }
  return chains
}

// Lowercase words without punctuation, for comparing titles across languages and sources.
export function titleWords(title: string): string[] {
  return title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean)
}

// 0 to 1: shared words over all words of the two titles. 1 means the same words.
export function titleSimilarity(a: string, b: string): number {
  const wa = new Set(titleWords(a))
  const wb = new Set(titleWords(b))
  if (!wa.size || !wb.size) return 0
  const shared = [...wa].filter(w => wb.has(w)).length
  return shared / new Set([...wa, ...wb]).size
}

// How well a Trakt show matches an anime chain: the best title match against the first season, else any
// season. A year match with the first season adds a little; the score is a ranking hint, not proof.
export function scoreTraktShow(show: Entry, chain: ChainStep[]): number {
  const root = chain[0]
  if (!root) return 0
  const traktTitles = [show.title, ...show.altTitles]
  const best = (titles: string[]) => Math.max(0, ...traktTitles.flatMap(t => titles.map(c => titleSimilarity(t, c))))
  const score = Math.max(best(root.titles), 0.8 * best(chain.flatMap(s => s.titles)))
  const yearBonus = show.year !== null && root.year !== null && Math.abs(show.year - root.year) <= 1 ? 0.1 : 0
  return Math.min(1, score + yearBonus)
}

export interface Placement {
  traktSeason: number | null
  episodeOffset: number
  // True when a source's progress lines up exactly with a plausible offset; false means check it.
  fromProgress: boolean
}

// Offsets that make sense for an entry: 0 (the entry starts its Trakt season), or the episodes of the
// seasons right before it in the chain (Trakt counted them in the same season, e.g. one long season 1).
export function plausibleOffsets(chain: ChainStep[]): number[] {
  const offsets = [0]
  let sum = 0
  for (let i = chain.length - 2; i >= 0; i--) {
    const episodes = chain[i]!.episodes
    if (episodes === null) break
    sum += episodes
    offsets.push(sum)
  }
  return offsets
}

// Where the anime entry sits in the Trakt show (Trakt episode N of the season = entry episode N - offset).
// The season is Trakt's current one. The offset is the plausible one that your sources' next episodes
// agree with; sources can disagree on progress, so progress alone never sets an odd offset.
// Example: Trakt next S3E6, Simkl next E6, MAL next E5 (MAL is behind): offset 0, not 1.
export function proposePlacement(trakt: { next: Entry['next'] }, anime: Entry[], chain: ChainStep[]): Placement {
  const traktSeason = trakt.next?.season ?? null
  if (!trakt.next || traktSeason === null) return { traktSeason, episodeOffset: 0, fromProgress: false }
  const observed = anime.filter(a => a.next).map(a => trakt.next!.number - a.next!.number)
  const plausible = plausibleOffsets(chain)
  const votes = plausible.map(o => ({ offset: o, votes: observed.filter(d => d === o).length }))
  const best = votes.sort((a, b) => b.votes - a.votes)[0]!
  if (best.votes > 0) return { traktSeason, episodeOffset: best.offset, fromProgress: true }
  return { traktSeason, episodeOffset: observed[0] ?? 0, fromProgress: false }
}
