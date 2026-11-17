import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/tsuzuku_api.dart';
import '../writes/write_flows.dart' show WriteOutcome, localDay, writeErrorText;

// The movie writes (#108, step 3.6; legacy `MovieMarkModal.vue`, `MovieAddModal.vue`). As every write: a preview
// per source first, then only the confirm button writes, for the sources left ticked. A failed source shows its
// own error and a Retry for just that source; nothing is queued or retried by itself.

/// "Mark watched" for a movie. Sources with it on a list are ticked; one with it on no list is offered unticked.
/// A score is left out unless picked, and then goes to every source marked.
class MovieMarkFlow extends ChangeNotifier {
  MovieMarkFlow({
    required this.api,
    required this.rowKey,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final TsuzukuApi api;
  final String rowKey;
  final DateTime Function() _clock;

  MovieMarkPlan? plan;
  String? loadError;
  bool loading = false;
  bool saving = false;
  Set<String> picked = {};
  final outcomes = <String, WriteOutcome>{};

  /// 0 = don't rate.
  int score = 0;
  bool wrote = false;

  Future<void> preview() async {
    loading = true;
    loadError = null;
    outcomes.clear();
    score = 0;
    notifyListeners();
    try {
      final p = await api.movies.postMoviesMarkPreview(
        body: PostMoviesMarkPreviewRequest(rowKey: rowKey),
      );
      plan = p;
      picked = {
        for (final s in p.steps)
          if (!s.optional) s.source.toJson(),
      };
    } catch (e) {
      plan = null;
      loadError = writeErrorText(e);
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  bool isDone(String source) => outcomes[source]?.ok ?? false;

  void toggle(String source, bool on) {
    if (saving || isDone(source)) return;
    on ? picked.add(source) : picked.remove(source);
    notifyListeners();
  }

  void setScore(int v) {
    score = v;
    notifyListeners();
  }

  List<MovieMarkStep> get pending => [
    for (final s in plan?.steps ?? const <MovieMarkStep>[])
      if (picked.contains(s.source.toJson()) && !isDone(s.source.toJson())) s,
  ];

  bool get anyFailed => outcomes.values.any((o) => !o.ok);
  bool get allDone => plan != null && outcomes.isNotEmpty && pending.isEmpty;

  /// The scores the sources have now.
  List<MovieMarkStep> get currentScores => [
    for (final s in plan?.steps ?? const <MovieMarkStep>[])
      if (s.currentRating != null) s,
  ];

  /// Writes the pending steps. Does nothing without a preview. True when every source took it (and the rating).
  Future<bool> confirm() async {
    final p = plan;
    final steps = pending;
    if (p == null || steps.isEmpty || saving) return false;
    saving = true;
    notifyListeners();
    try {
      final res = await api.movies.postMoviesMarkConfirm(
        body: PostMoviesMarkConfirmRequest(
          rowKey: p.rowKey,
          steps: [
            for (final s in steps)
              PostMoviesMarkConfirmRequestStepsItem(
                source: PostMoviesMarkConfirmRequestStepsItemSource.fromJson(
                  s.source.toJson(),
                ),
                expected: s.expected,
              ),
          ],
          rating: score == 0 ? null : score,
          today: localDay(_clock()),
        ),
      );
      for (final o in res.outcomes) {
        outcomes[o.source.toJson()] = WriteOutcome(
          ok: o.ok,
          error: o.error,
          listStatus: o.listStatus,
          ratingError: o.ratingError,
        );
      }
      if (res.outcomes.any((o) => o.ok)) wrote = true;
      return res.outcomes.every((o) => o.ok && o.ratingError == null);
    } catch (e) {
      final message = writeErrorText(e);
      for (final s in steps) {
        outcomes[s.source.toJson()] = WriteOutcome(ok: false, error: message);
      }
      return false;
    } finally {
      saving = false;
      notifyListeners();
    }
  }
}

/// A search result to add, or a Trakt movie / MAL entry to pick for a source nothing ties the movie to.
class MovieChoice {
  const MovieChoice({
    required this.id,
    required this.title,
    required this.url,
    this.year,
    this.detail,
    this.poster,
    this.listedOn = const [],
    this.onList = false,
  });

  factory MovieChoice.ofSearch(GetMoviesSearchResponse200Item r) => MovieChoice(
    id: r.id.toInt(),
    title: r.title,
    url: r.url,
    year: r.year?.toInt(),
    detail: r.detail,
    poster: r.poster,
    listedOn: [for (final s in r.listedOn) s.toJson()],
  );

  factory MovieChoice.ofCandidate(MovieCandidate c) => MovieChoice(
    id: c.id.toInt(),
    title: c.title,
    url: c.url,
    year: c.year?.toInt(),
    detail: c.detail,
    onList: c.onList,
  );

  final int id;
  final String title;
  final String url;
  final int? year;
  final String? detail;
  final String? poster;

  /// Sources that already list it (search results).
  final List<String> listedOn;

  /// On your list at that source (picks).
  final bool onList;
}

/// The search for a Trakt movie or MAL entry, where none of your lists ties the movie to that source.
class SideSearch {
  String query = '';
  List<MovieChoice>? results;
  bool searching = false;
  bool open = false;

  // Counts searches, so an answer to an older one (typing went on) is dropped.
  int seq = 0;
}

/// "Add a movie" (search TMDB or AniList, pick, preview, confirm), or, with [rowKey], "Add to the other
/// watchlists" for a movie already on the page (opens on its preview). A source that already lists it is skipped
/// and never moved. Where nothing ties it to Trakt or MAL, it can be picked there among real search results.
class MovieAddFlow extends ChangeNotifier {
  MovieAddFlow({required this.api, this.rowKey, this.title});

  final TsuzukuApi api;
  final String? rowKey;
  final String? title;

  /// tmdb (any movie) or anilist (anime movies).
  String from = 'tmdb';
  String query = '';
  List<MovieChoice>? results;
  bool searching = false;
  String? error;

  // Counts searches, so an answer to an older one (typing went on, or the source changed) is dropped.
  int _searchSeq = 0;

  /// The picked search result (none with [rowKey]).
  MovieChoice? picked;
  int? traktId;
  int? malId;
  MovieAddPlan? plan;
  bool planning = false;
  Set<String> chosen = {};
  final outcomes = <String, WriteOutcome>{};
  bool saving = false;
  bool wrote = false;

  final sides = {'trakt': SideSearch(), 'mal': SideSearch()};

  /// Titles to search with for a movie on the page: AniList's English title first for an anime movie.
  List<String> titles = [];

  /// On the preview step (a row, or a picked result).
  bool get previewing => rowKey != null || picked != null;

  void setFrom(String value) {
    if (from == value) return;
    from = value;
    results = null;
    _searchSeq++;
    searching = false;
    notifyListeners();
    if (query.trim().length >= 2) unawaited(search());
  }

  Future<void> search() async {
    final q = query.trim();
    if (q.length < 2) return;
    final seq = ++_searchSeq;
    searching = true;
    error = null;
    notifyListeners();
    try {
      final found = await api.movies.getMoviesSearch(
        from: GetMoviesSearchFrom.fromJson(from),
        q: q,
      );
      if (seq != _searchSeq) return;
      results = [for (final r in found) MovieChoice.ofSearch(r)];
    } catch (e) {
      if (seq == _searchSeq) error = writeErrorText(e);
    } finally {
      if (seq == _searchSeq) {
        searching = false;
        notifyListeners();
      }
    }
  }

  /// Picking a result previews it: nothing is written yet.
  Future<void> pick(MovieChoice r) {
    picked = r;
    traktId = null;
    malId = null;
    for (final s in sides.values) {
      s
        ..results = null
        ..open = false
        ..query = '';
    }
    return preview();
  }

  void back() {
    picked = null;
    plan = null;
    error = null;
    outcomes.clear();
    notifyListeners();
  }

  Future<void> preview() async {
    if (!previewing) return;
    planning = true;
    error = null;
    outcomes.clear();
    notifyListeners();
    try {
      final p = await api.movies.postMoviesAddPreview(
        body: PostMoviesAddPreviewRequest(
          rowKey: rowKey,
          from: rowKey == null
              ? PostMoviesAddPreviewRequestFrom.fromJson(from)
              : null,
          id: rowKey == null ? picked!.id : null,
          traktId: traktId,
          malId: malId,
        ),
      );
      plan = p;
      chosen = {for (final s in p.steps) s.source.toJson()};
      if (rowKey != null && titles.isEmpty) {
        try {
          titles = (await api.movies.getMoviesLinkTitles(rowKey: rowKey!))
              .titles;
        } catch (_) {
          titles = [];
        }
      }
      // An anime movie Trakt cannot be told: its search opens at once. MAL's only on asking, unless it is anime.
      if (p.traktSearch && sides['trakt']!.results == null) {
        unawaited(openSide('trakt'));
      }
      if (p.malSearch && p.anime && sides['mal']!.results == null) {
        unawaited(openSide('mal'));
      }
    } catch (e) {
      plan = null;
      error = writeErrorText(e);
    } finally {
      planning = false;
      notifyListeners();
    }
  }

  Future<void> openSide(String side) {
    final s = sides[side]!;
    s.open = true;
    if (s.query.isEmpty) {
      s.query = titles.firstOrNull ?? plan?.title ?? '';
    }
    notifyListeners();
    return searchSide(side);
  }

  void setSideQuery(String side, String q) {
    sides[side]!.query = q;
    notifyListeners();
  }

  Future<void> searchSide(String side) async {
    final s = sides[side]!;
    final q = s.query.trim();
    if (q.length < 2) return;
    final seq = ++s.seq;
    s.searching = true;
    notifyListeners();
    try {
      final found = side == 'trakt'
          ? [
              for (final c in await api.movies.getMoviesLinkSearch(
                target: GetMoviesLinkSearchTarget.fromJson('trakt'),
                q: q,
                year: plan?.year?.toInt(),
              ))
                MovieChoice.ofCandidate(c),
            ]
          : [
              for (final r in await api.movies.getMoviesSearch(
                from: GetMoviesSearchFrom.fromJson('anilist'),
                q: q,
              ))
                MovieChoice(
                  id: r.id.toInt(),
                  title: r.title,
                  url: r.url,
                  year: r.year?.toInt(),
                  detail: r.detail,
                  onList: r.listedOn.any((s) => s.toJson() == 'mal'),
                ),
            ];
      if (seq != s.seq) return;
      s.results = found;
    } catch (e) {
      if (seq == s.seq) error = writeErrorText(e);
    } finally {
      if (seq == s.seq) {
        s.searching = false;
        notifyListeners();
      }
    }
  }

  /// Picking the Trakt movie or MAL entry previews again: nothing is written yet.
  Future<void> pickSide(String side, MovieChoice c) {
    if (side == 'trakt') {
      traktId = c.id;
    } else {
      malId = c.id;
    }
    sides[side]!
      ..results = null
      ..open = false;
    return preview();
  }

  bool isDone(String source) => outcomes[source]?.ok ?? false;

  void toggle(String source, bool on) {
    if (saving || isDone(source)) return;
    on ? chosen.add(source) : chosen.remove(source);
    notifyListeners();
  }

  List<MovieAddStep> get pending => [
    for (final s in plan?.steps ?? const <MovieAddStep>[])
      if (chosen.contains(s.source.toJson()) && !isDone(s.source.toJson())) s,
  ];

  bool get anyFailed => outcomes.values.any((o) => !o.ok);
  bool get allDone => plan != null && outcomes.isNotEmpty && pending.isEmpty;

  /// Writes the pending steps. Does nothing without a preview. True when every source took it.
  Future<bool> confirm() async {
    final steps = pending;
    if (plan == null || !previewing || steps.isEmpty || saving || planning) {
      return false;
    }
    saving = true;
    notifyListeners();
    try {
      final res = await api.movies.postMoviesAddConfirm(
        body: PostMoviesAddConfirmRequest(
          rowKey: rowKey,
          from: rowKey == null
              ? PostMoviesAddConfirmRequestFrom.fromJson(from)
              : null,
          id: rowKey == null ? picked!.id : null,
          traktId: traktId,
          malId: malId,
          steps: [
            for (final s in steps)
              PostMoviesAddConfirmRequestStepsItem(
                source: PostMoviesAddConfirmRequestStepsItemSource.fromJson(
                  s.source.toJson(),
                ),
              ),
          ],
        ),
      );
      for (final o in res.outcomes) {
        outcomes[o.source.toJson()] = WriteOutcome(ok: o.ok, error: o.error);
      }
      if (res.outcomes.any((o) => o.ok)) wrote = true;
      return res.outcomes.every((o) => o.ok);
    } catch (e) {
      final message = writeErrorText(e);
      for (final s in steps) {
        outcomes[s.source.toJson()] = WriteOutcome(ok: false, error: message);
      }
      return false;
    } finally {
      saving = false;
      notifyListeners();
    }
  }
}
