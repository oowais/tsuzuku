// What the Up Next "Why?" line can say about a differing row (#78). Built on the server
// (server/lib/diff-reasons.ts), rendered by the page.

type Source = 'trakt' | 'simkl' | 'mal'

export type DiffReason
  // The last mark reached some sources and not this one, which is one episode behind them.
  = | { kind: 'partial_mark', at: string, reached: Source[], behind: Source }
  // A different episode offset (one the season chain allows) would line this entry up with Trakt.
    | { kind: 'offset', source: Source, seasonId: number, traktSeason: number, current: number, suggested: number }
  // Trakt's episode lies outside the linked entry's episodes: the link may point at another season or cour.
    | { kind: 'link', source: Source, seasonId: number, traktEpisode: string, episodes: number }
  // Caught up on this source, while another lists the next episode, already aired.
    | { kind: 'not_listed_yet', source: Source, episode: string, listedBy: Source }
  // This source lists an episode that has not aired yet; another is caught up.
    | { kind: 'not_aired', source: Source, episode: string, airsAt: string }
  // Ahead by more than the marks logged here: watched (or marked) on the source itself.
    | { kind: 'outside', source: Source, by: number, than: Source }
