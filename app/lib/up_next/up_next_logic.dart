// Up Next (#108, step 3.4): the pure logic behind the screen, ported from legacy `pages/index.vue`,
// `components/UpNextCards.vue` and `shared/utils/up-next-filter.ts`.
//
// Each source keeps its own progress (decisions #2, #10, #19). When the sources differ, every source's
// next episode is shown on its own; nothing here picks a winner or builds a cross-source next episode.

import '../api/tsuzuku_api.dart';
import 'format.dart';

typedef UpNext = GetUpNextResponse200;
typedef UpRow = GetUpNextResponse200RowsItem;
typedef SourceFetch = GetUpNextResponse200SourcesValue;

/// The list sources, in column order.
const listSources = ['trakt', 'simkl', 'mal'];

Cell? cellOf(UpRow row, String source) => switch (source) {
  'trakt' => row.cells.trakt,
  'simkl' => row.cells.simkl,
  'mal' => row.cells.mal,
  _ => null,
};

/// The row's cells in column order.
List<Cell> cellsOf(UpRow row) => [for (final s in listSources) ?cellOf(row, s)];

/// Cells whose source has the show on its list.
List<Cell> withEntry(UpRow row) =>
    cellsOf(row).where((c) => c.entry != null).toList();

String stateOf(Cell c) => c.state.toJson();

/// A differing row you have not accepted: flagged.
bool flaggedDiffers(UpRow row) => row.differs && !row.accepted;

// --- Sections ---------------------------------------------------------------------------------

class UpNextSections {
  UpNextSections(Iterable<UpRow> rows)
    : nextToWatch = rows.where((r) => r.section.toJson() == 'trakt').toList(),
      notOnTrakt = rows
          .where((r) => r.section.toJson() == 'other' && r.hasNext)
          .toList(),
      caughtUp = rows
          .where((r) => r.section.toJson() == 'other' && !r.hasNext)
          .toList();

  /// On Trakt's up next, in Trakt's order.
  final List<UpRow> nextToWatch;

  /// On Simkl or MAL with something to watch, by last activity (the server's order).
  final List<UpRow> notOnTrakt;

  /// On Simkl or MAL, nothing to watch now.
  final List<UpRow> caughtUp;
}

/// "2 shows differ between sources. 1 accepted difference."
String summary(List<UpRow> rows) {
  final differing = rows.where(flaggedDiffers).length;
  final accepted = rows.where((r) => r.accepted).length;
  final head = differing == 0
      ? 'All sources agree.'
      : '$differing ${differing == 1 ? 'show differs' : 'shows differ'} between sources.';
  if (accepted == 0) return head;
  return '$head $accepted accepted ${accepted == 1 ? 'difference' : 'differences'}.';
}

// --- What a card leads with --------------------------------------------------------------------

class LeadEpisode {
  const LeadEpisode({this.episode, this.name, this.airedAt});

  /// "S1E17"; null when caught up.
  final String? episode;
  final String? name;
  final String? airedAt;
}

/// The episode the card leads with: the one the agreeing sources share (in Trakt's numbering), or the
/// only source's. Null when the sources differ: then [perSourceNext] shows each one's.
LeadEpisode? lead(UpRow row) {
  final cells = withEntry(row);
  final List<Cell> shared;
  if (row.agrees) {
    shared = cells.where((c) => stateOf(c) == 'in_sync').toList();
  } else if (!row.differs && cells.length == 1) {
    shared = cells;
  } else {
    shared = const [];
  }
  if (shared.isEmpty) return null;
  final first = shared.first;
  final tn = first.traktNext;
  final next = first.entry!.next;
  final String? episode = tn != null
      ? episodeLabel(tn.season, tn.number)
      : next != null
      ? episodeLabel(next.season, next.number)
      : null;
  return LeadEpisode(
    episode: episode,
    name: shared
        .map((c) => c.entry!.next?.title)
        .firstWhere((t) => t != null && t.isNotEmpty, orElse: () => null),
    airedAt: shared
        .map((c) => c.entry!.next?.airedAt)
        .firstWhere((t) => t != null && t.isNotEmpty, orElse: () => null),
  );
}

class SourceNext {
  const SourceNext({
    required this.source,
    required this.label,
    required this.differs,
    this.traktLabel,
  });

  final String source;

  /// The source's own next episode in its own numbering, or "caught up".
  final String label;

  /// This source's cell is part of an unaccepted difference.
  final bool differs;

  /// The same episode in Trakt's numbering, when a confirmed placement gives it (anime).
  final String? traktLabel;
}

/// Every source's own next episode, never merged. Shown when [lead] is null.
List<SourceNext> perSourceNext(UpRow row) => [
  for (final c in withEntry(row))
    SourceNext(
      source: c.source.toJson(),
      label: c.entry!.next == null
          ? 'caught up'
          : episodeLabel(c.entry!.next!.season, c.entry!.next!.number),
      differs: stateOf(c) == 'differs' && !row.accepted,
      traktLabel: c.traktNext != null && c.source.toJson() != 'trakt'
          ? episodeLabel(c.traktNext!.season, c.traktNext!.number)
          : null,
    ),
];

// --- Flags and badges --------------------------------------------------------------------------

enum FlagKind { blocked, stale }

class SourceFlag {
  const SourceFlag(this.source, this.kind);
  final String source;
  final FlagKind kind;

  String get label => kind == FlagKind.blocked ? 'rate limited' : 'stale';
}

/// Per-source problems worth seeing without opening the card: rate limited, else stale.
List<SourceFlag> flags(UpRow row) => [
  for (final c in cellsOf(row))
    if (c.blocked)
      SourceFlag(c.source.toJson(), FlagKind.blocked)
    else if (c.stale)
      SourceFlag(c.source.toJson(), FlagKind.stale),
];

bool notPlaced(UpRow row) =>
    cellsOf(row).any((c) => stateOf(c) == 'not_placed');

/// The first source's side-story type (OVA, special, ...), for a badge.
String? sideStory(UpRow row) {
  for (final c in withEntry(row)) {
    if (isSideStory(c.entry!.format)) return c.entry!.format;
  }
  return null;
}

// --- Progress ----------------------------------------------------------------------------------

class Progress {
  const Progress(this.source, this.watched, this.episodes);
  final String source;
  final int watched;
  final int episodes;

  int get left => episodes - watched;
}

/// Progress under the card, from one named source: Simkl first (it counts a show's seasons together;
/// for anime, the entry's own episodes), else Trakt, else MAL.
Progress? progress(UpRow row) {
  for (final s in const ['simkl', 'trakt', 'mal']) {
    final e = cellOf(row, s)?.entry;
    final episodes = e?.episodes?.toInt();
    if (e != null && episodes != null && episodes > 0) {
      final watched = e.watched.toInt();
      return Progress(s, watched > episodes ? episodes : watched, episodes);
    }
  }
  return null;
}

/// The next episode is out (legacy "Aired vs upcoming"): the card's lead episode has an air date that
/// has passed. False while it is still to air, or when the sources differ (no shared next episode).
bool nextAired(UpRow row, DateTime now) {
  final at = lead(row)?.airedAt;
  return at != null && parseTime(at) != null && !isFuture(at, now);
}

/// When you last watched, once for the card while the sources agree: the newest time Trakt or Simkl
/// recorded (MAL only knows when its entry changed, so it counts only when it is the only one). Null
/// when they differ: then each source says its own.
({String at, bool updated})? lastWatched(UpRow row) {
  if (row.differs) return null;
  final cells = withEntry(row)
      .where((c) => parseTime(c.entry!.lastActivityAt) != null)
      .toList();
  final watched = cells.where((c) => c.source.toJson() != 'mal').toList();
  final pool = watched.isNotEmpty ? watched : cells;
  if (pool.isEmpty) return null;
  // Sources write times with different offsets, so they are compared as times, not as text.
  pool.sort(
    (a, b) =>
        parseTime(a.entry!.lastActivityAt)!
            .compareTo(parseTime(b.entry!.lastActivityAt)!),
  );
  return (at: pool.last.entry!.lastActivityAt!, updated: watched.isEmpty);
}

// --- Hooks for step 3.5 (writes) ---------------------------------------------------------------

/// "Mark watched" on the card: every source (null) when they agree, else the one source that can be
/// marked when it is alone. Returns false when the card has no button.
({bool show, String? source}) markAction(UpRow row) {
  if (row.agrees) return (show: true, source: null);
  if (row.differs) return (show: false, source: null);
  final markable = listSources.where((s) {
    final c = cellOf(row, s);
    return c?.entry?.next != null && !c!.blocked && !c.stale;
  }).toList();
  if (markable.length != 1) return (show: false, source: null);
  return (show: true, source: markable.first);
}

// --- Filter (#68) ------------------------------------------------------------------------------

enum UpNextChip { differs, unmapped, next }

class UpNextFilter {
  const UpNextFilter({this.q = '', this.kind, this.only = const {}});

  final String q;

  /// "anime" or "show"; null for both.
  final String? kind;
  final Set<UpNextChip> only;

  bool get active => q.trim().isNotEmpty || kind != null || only.isNotEmpty;

  UpNextFilter copyWith({
    String? q,
    String? Function()? kind,
    Set<UpNextChip>? only,
  }) => UpNextFilter(
    q: q ?? this.q,
    kind: kind != null ? kind() : this.kind,
    only: only ?? this.only,
  );
}

/// Every title the sources gave: the row's, each source's own (with MAL's alternatives), and the
/// linked title of a show that is not on that source's list.
List<String> rowTitles(UpRow row) => [
  row.title,
  for (final c in cellsOf(row)) ...[
    ?c.entry?.title,
    ...?c.entry?.altTitles,
    ?c.ref?.title,
  ],
];

bool matchesFilter(UpRow row, UpNextFilter f) {
  if (f.kind != null && row.kind.toJson() != f.kind) return false;
  // A difference you accepted is no longer flagged, so it does not count here either.
  if (f.only.contains(UpNextChip.differs) && !flaggedDiffers(row)) return false;
  if (f.only.contains(UpNextChip.unmapped) &&
      !cellsOf(row).any((c) => stateOf(c) == 'unmapped')) {
    return false;
  }
  if (f.only.contains(UpNextChip.next) && !row.hasNext) return false;
  final words = fold(f.q).split(RegExp(r'\s+')).where((w) => w.isNotEmpty);
  if (words.isEmpty) return true;
  final titles = rowTitles(row).map(fold).toList();
  return words.every((w) => titles.any((t) => t.contains(w)));
}

// --- Source fetch status -----------------------------------------------------------------------

class SourceHealth {
  const SourceHealth({
    required this.source,
    required this.status,
    required this.stale,
    this.fetchedAt,
    this.blockedUntil,
    this.error,
  });

  final String source;

  /// ok, rate_limited, auth_expired, error.
  final String status;
  final bool stale;
  final DateTime? fetchedAt;

  /// From `retryAfter`, counted from when the answer arrived.
  final DateTime? blockedUntil;
  final String? error;

  bool get ok => status == 'ok' && !stale;

  String get statusLabel => switch (status) {
    'ok' => 'OK',
    'rate_limited' => 'rate limited',
    'auth_expired' => 'auth expired',
    'error' => 'error',
    _ => status,
  };
}

/// Each list source's fetch, in column order, from the answer's `sources`.
List<SourceHealth> sourceHealth(UpNext data, DateTime receivedAt) => [
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

// --- Links to the sources (decision #24) -------------------------------------------------------

/// The source's own page for an entry; kind is the entry's (`anime` or `show`).
String? itemUrl(String source, String kind, EntryIds ids) => switch (source) {
  'trakt' =>
    ids.traktSlug != null ? 'https://trakt.tv/shows/${ids.traktSlug}' : null,
  'simkl' =>
    ids.simkl == null
        ? null
        : 'https://simkl.com/${kind == 'anime' ? 'anime' : 'tv'}/${ids.simkl!.toInt()}'
              '${ids.simklSlug != null ? '/${ids.simklSlug}' : ''}',
  'mal' =>
    ids.mal != null
        ? 'https://myanimelist.net/anime/${ids.mal!.toInt()}'
        : null,
  _ => null,
};

String? entryUrl(CellEntry e) =>
    itemUrl(e.source.toJson(), e.kind.toJson(), e.ids);

/// The source's own page for the entry's next episode.
String? episodeUrl(CellEntry e, EntryNext ep) {
  final item = entryUrl(e);
  if (item == null) return null;
  final n = ep.number.toInt();
  final season = ep.season?.toInt();
  switch (e.source.toJson()) {
    case 'trakt':
      return season != null ? '$item/seasons/$season/episodes/$n' : item;
    case 'simkl':
      if (e.ids.simklSlug == null) return item;
      if (e.kind.toJson() == 'anime') return '$item/episode-$n/';
      return season != null ? '$item/season-$season/episode-$n/' : item;
    case 'mal':
      return '$item/_/episode/$n';
  }
  return null;
}

/// A linked show that is not on this source's list: its page by the stored ID.
String? refUrl(Cell c, String rowKind) {
  final r = c.ref;
  if (r == null) return null;
  final source = c.source.toJson();
  final kind = source == 'mal' || rowKind == 'anime' ? 'anime' : 'show';
  return itemUrl(
    source,
    kind,
    EntryIds(traktSlug: r.traktSlug, simkl: r.simkl, mal: r.mal),
  );
}
