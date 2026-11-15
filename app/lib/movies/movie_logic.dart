import '../api/tsuzuku_api.dart';
import '../up_next/up_next_logic.dart' show SourceHealth, listSources;

// Movies (#108, step 3.6; legacy `pages/movies.vue`, decision #25): one row per movie, each source with its own
// title and state. Differences are shown, never resolved.

typedef Movies = GetMoviesResponse200;

/// Each source's own word for where the movie is (legacy `STATE_LABELS`).
const movieStateLabels = {
  'watchlist': 'Watchlist',
  'plantowatch': 'Plan to Watch',
  'plan_to_watch': 'Plan to Watch',
  'watching': 'Watching',
  'watched': 'Watched',
  'completed': 'Completed',
  'dropped': 'Dropped',
  'hold': 'On Hold',
  'on_hold': 'On Hold',
};

String movieStateLabel(MovieCellEntry e) =>
    movieStateLabels[e.listStatus] ?? e.listStatus;

enum MovieTone { primary, success, neutral }

MovieTone movieStateTone(MovieCellEntry e) => switch (e.state.toJson()) {
  'watchlist' || 'watching' => MovieTone.primary,
  'watched' => MovieTone.success,
  _ => MovieTone.neutral,
};

MovieCell movieCell(MovieRow row, String source) => switch (source) {
  'trakt' => row.cells.trakt,
  'simkl' => row.cells.simkl,
  _ => row.cells.mal,
};

String? absentOf(MovieCell c) => c.absent?.toJson();

String absentLabel(MovieCell c) => switch (absentOf(c)) {
  'not_listed' => 'not on your lists',
  'not_linked' => 'not linked',
  _ => '',
};

/// The sources shown on the opened card: MAL only for anime (legacy hides `not_anime`).
List<String> movieSources(MovieRow row) => [
  for (final s in listSources)
    if (absentOf(movieCell(row, s)) != 'not_anime') s,
];

/// A source's own page for a movie (legacy `itemUrl`; movies: `trakt.tv/movies/<slug>`, `simkl.com/movies/<id>/<slug>`,
/// anime movies are Simkl anime, MAL as any anime).
String? movieUrl(
  String source, {
  required bool anime,
  required MovieIds ids,
}) => switch (source) {
  'trakt' =>
    ids.traktSlug != null ? 'https://trakt.tv/movies/${ids.traktSlug}' : null,
  'simkl' =>
    ids.simkl == null
        ? null
        : 'https://simkl.com/${anime ? 'anime' : 'movies'}/${ids.simkl!.toInt()}'
              '${ids.simklSlug != null ? '/${ids.simklSlug}' : ''}',
  'mal' =>
    ids.mal != null
        ? 'https://myanimelist.net/anime/${ids.mal!.toInt()}'
        : null,
  _ => null,
};

/// The page of a source's own entry.
String? entryUrl(MovieCellEntry e) =>
    movieUrl(e.source.toJson(), anime: e.anime, ids: e.ids);

/// A source without the movie but known by an ID the row carries (from another source or your link): its page.
String? absentUrl(MovieRow row, String source) {
  if (absentOf(movieCell(row, source)) != 'not_listed') return null;
  return movieUrl(
    source,
    anime: source == 'mal' || (source == 'simkl' && row.anime),
    ids: MovieIds(traktSlug: row.ids.traktSlug, mal: row.ids.mal),
  );
}

/// Worth offering "Add to the other watchlists": a source lacks it while another has it to watch (legacy
/// `fillable`). A source nothing ties it to counts too: the preview lets you pick the movie there.
bool fillable(MovieRow row) =>
    listSources.any(
      (s) => const [
        'not_listed',
        'not_linked',
      ].contains(absentOf(movieCell(row, s))),
    ) &&
    listSources.any(
      (s) => const [
        'watchlist',
        'watching',
      ].contains(movieCell(row, s).entry?.state.toJson()),
    );

/// Each list source's fetch, from the answer's `sources`.
List<SourceHealth> movieHealth(Movies data, DateTime receivedAt) => [
  for (final s in listSources)
    if (data.sources[s] case final f?)
      SourceHealth(
        source: s,
        status: f.status.toJson(),
        stale: f.stale,
        fetchedAt: f.fetchedAt,
        blockedUntil: f.retryAfter == null
            ? null
            : receivedAt.add(Duration(seconds: f.retryAfter!.round())),
        error: f.error,
      ),
];

/// "9 Oct 2026" (legacy `toLocaleDateString('en-GB', …)`), local time.
String? movieDate(String? iso) {
  final t = iso == null ? null : DateTime.tryParse(iso)?.toLocal();
  if (t == null) return null;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return '${t.day} ${months[t.month - 1]} ${t.year}';
}
