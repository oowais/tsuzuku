import type { AniListMedia } from '../adapters/anilist'
import { plausibleOffsets, seriesSequels, stepOf, type ChainStep } from './seasons'
import type { Row } from './up-next'

// Starting the next anime season (#66). Simkl and MAL file each season as its own entry, so once a season
// is completed it leaves the watching lists while Trakt moves on to the next one. This finds the entry
// to start (a stored link, or the sequel AniList names, or one you picked from a search), never more than
// one entry and never any progress: preview, confirm, then the source's own Watching list.

export type StartSource = 'simkl' | 'mal'

export interface StartTarget {
  malId: number
  anilistId: number | null
  title: string
  format: string | null
  episodes: number | null
  status: string | null
  year: number | null
}

// Where the started entry goes in the Trakt show; `linked` when a stored link already says so.
export interface StartPlacement {
  traktSeason: number
  episodeOffset: number
  linked: boolean
}

type MappingSeason = { malId: number | null, traktSeason: number | null, episodeOffset: number, episodeCount: number | null }

// Which of Simkl and MAL could start an entry on this row: a Trakt up-next anime the source has linked but
// has nothing on its watching list for. `search` when nothing links the Trakt show to an anime yet.
export function startable(row: Row): { sources: StartSource[], search: boolean } {
  const next = row.cells.trakt?.entry?.next
  if (row.section !== 'trakt' || !next || next.season === null) return { sources: [], search: false }
  if (row.kind === 'unknown') return { sources: [], search: true }
  if (row.kind !== 'anime') return { sources: [], search: false }
  const sources = (['mal', 'simkl'] as const).filter(s => row.cells[s]?.state === 'not_in_list')
  return { sources, search: false }
}

// The linked entry for Trakt's next episode, when one is stored and still covers it.
export function storedFor(seasons: MappingSeason[], next: { season: number, number: number }): MappingSeason | null {
  const inSeason = seasons
    .filter(s => s.malId !== null && s.traktSeason === next.season && s.episodeOffset < next.number)
    .sort((a, b) => b.episodeOffset - a.episodeOffset)[0]
  if (!inSeason) return null
  if (inSeason.episodeCount !== null && next.number - inSeason.episodeOffset > inSeason.episodeCount) return null
  return inSeason
}

// The last linked entry before Trakt's next episode, whose sequel comes next.
export function previousLinked(seasons: MappingSeason[], next: { season: number, number: number }): MappingSeason | null {
  return seasons
    .filter(s => s.malId !== null && s.traktSeason !== null
      && (s.traktSeason < next.season || (s.traktSeason === next.season && s.episodeOffset < next.number)))
    .sort((a, b) => b.traktSeason! - a.traktSeason! || b.episodeOffset - a.episodeOffset)[0] ?? null
}

export function targetOf(media: AniListMedia): StartTarget {
  const step = stepOf(media)
  const title = (media.title ?? {}) as { english?: string | null, romaji?: string | null }
  return {
    malId: step.malId,
    anilistId: step.anilistId,
    title: title.english || title.romaji || step.titles[0] || `MAL #${step.malId}`,
    format: step.format,
    episodes: step.episodes,
    status: typeof media.status === 'string' ? media.status : null,
    year: step.year
  }
}

export const sequelsOf = (media: AniListMedia | null | undefined): StartTarget[] => (media ? seriesSequels(media) : [])

// A new entry starts at its episode 1, so it lines up with Trakt's next episode at offset (next - 1) when the
// season chain allows that offset (Trakt counting earlier entries in the same season); else 0.
export function placementFor(next: { season: number, number: number }, chain: ChainStep[]): StartPlacement {
  const wanted = next.number - 1
  return { traktSeason: next.season, episodeOffset: wanted > 0 && plausibleOffsets(chain).includes(wanted) ? wanted : 0, linked: false }
}
