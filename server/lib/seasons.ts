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
  // True when worked out from both sides' next episode; false means a default you should check.
  fromProgress: boolean
}

// Where the anime entry sits in the Trakt show, from where you are on each side:
// Trakt next S3E6 and the entry's next E6 give season 3, offset 0 (Trakt episode N = entry episode N - offset).
export function proposePlacement(trakt: Entry, anime: Entry): Placement {
  if (trakt.next && trakt.next.season !== null && anime.next) {
    return { traktSeason: trakt.next.season, episodeOffset: trakt.next.number - anime.next.number, fromProgress: true }
  }
  return { traktSeason: trakt.next?.season ?? null, episodeOffset: 0, fromProgress: false }
}
