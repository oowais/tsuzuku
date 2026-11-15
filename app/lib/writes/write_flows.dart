import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../api/tsuzuku_api.dart';
import '../server/connection.dart';

// The writes (#108, step 3.5), ported from legacy `MarkWatchedModal.vue` and `StartSeasonModal.vue`.
// Every write to Trakt, Simkl or MAL goes preview first, then an explicit confirm: the confirm sends only
// steps the server's preview planned, for the sources you left ticked, with the preview's `expected`. A
// failed source shows its own error; there is no queue and no automatic retry (decisions #3, #13).

/// The message of a failed call: the server's `statusMessage` when it sent one (legacy h3 errors,
/// e.g. "This show is no longer on Shows; reload the page"), else [describeError]. Never headers.
String writeErrorText(Object e) {
  if (e is DioException && e.error is! AccessRejected) {
    final data = e.response?.data;
    if (data is Map) {
      final message = data['statusMessage'] ?? data['message'];
      if (message is String && message.isNotEmpty) return message;
    }
  }
  return describeError(e);
}

/// The local calendar day of a time, e.g. 2026-10-09 (legacy `localDay`).
String localDay(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// One source's result after a confirm.
class WriteOutcome {
  const WriteOutcome({
    required this.ok,
    this.error,
    this.listStatus,
    this.ratingError,
  });

  final bool ok;
  final String? error;
  final String? listStatus;
  final String? ratingError;
}

typedef MarkPlan = PostMarkPreviewResponse200;

/// The list status to set with a source's last episode (#52), or [leave] to leave it to the source.
const leave = 'leave';

/// "Mark next watched": preview per source, pick sources, confirm.
class MarkFlow extends ChangeNotifier {
  MarkFlow({
    required this.api,
    required this.rowKey,
    this.source,
    this.signature,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final TsuzukuApi api;
  final String rowKey;

  /// Mark on this source only (the sources disagree); null marks every source.
  final String? source;
  final String? signature;
  final DateTime Function() _clock;

  MarkPlan? plan;
  String? loadError;
  bool loading = false;
  bool saving = false;

  /// Sources ticked for the confirm.
  Set<String> picked = {};
  final outcomes = <String, WriteOutcome>{};

  /// Per source with `after`: a status from its options, or [leave].
  final after = <String, String>{};

  /// A score with the last episode (#65): 0 = don't rate; one for every source, or per source.
  int sharedScore = 0;
  bool splitRating = false;
  final rateValue = <String, int>{};

  /// Something was written: the list behind needs a reload.
  bool wrote = false;

  /// The preview says the row moved since the list loaded: the list behind needs a reload.
  bool stale = false;

  bool get oneSource => plan?.mode.toJson() == 'one';

  Future<void> preview() async {
    loading = true;
    loadError = null;
    outcomes.clear();
    notifyListeners();
    try {
      final p = await api.mark.postMarkPreview(
        body: PostMarkPreviewRequest(
          rowKey: rowKey,
          source: source == null
              ? null
              : PostMarkPreviewRequestSource.fromJson(source),
          signature: signature,
        ),
      );
      plan = p;
      if (p.changed != null) stale = true;
      picked = {for (final s in p.steps) s.source.toJson()};
      after
        ..clear()
        ..addAll({
          for (final s in p.steps)
            if (s.after != null)
              s.source.toJson(): s.after!.suggested?.toJson() ?? leave,
        });
      splitRating = false;
      setShared(0);
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

  void setAfter(String source, String value) {
    after[source] = value;
    notifyListeners();
  }

  /// Steps still to write: ticked, and not already written in this preview.
  List<MarkStep> get pending => [
    for (final s in plan?.steps ?? const <MarkStep>[])
      if (picked.contains(s.source.toJson()) && !isDone(s.source.toJson())) s,
  ];

  bool get anyFailed => outcomes.values.any((o) => !o.ok);
  bool get allDone => plan != null && outcomes.isNotEmpty && pending.isEmpty;

  List<MarkStep> get ratable => [
    for (final s in plan?.steps ?? const <MarkStep>[])
      if (s.rating != null && !isDone(s.source.toJson())) s,
  ];

  void setShared(int v) {
    sharedScore = v;
    rateValue
      ..clear()
      ..addAll({for (final s in ratable) s.source.toJson(): v});
    notifyListeners();
  }

  void setSplit(bool on) {
    splitRating = on;
    if (on) {
      rateValue
        ..clear()
        ..addAll({for (final s in ratable) s.source.toJson(): sharedScore});
    }
    notifyListeners();
  }

  void setRate(String source, int v) {
    rateValue[source] = v;
    notifyListeners();
  }

  /// The score a source gets, or null to leave its rating alone.
  int? ratingFor(MarkStep s) {
    if (s.rating == null) return null;
    final v = splitRating ? (rateValue[s.source.toJson()] ?? 0) : sharedScore;
    return v == 0 ? null : v;
  }

  /// The future air date one source gives, warned about once (#43).
  MarkStepAirsAt? get future {
    for (final s in plan?.steps ?? const <MarkStep>[]) {
      if (s.airsAt != null) return s.airsAt;
    }
    return null;
  }

  /// Writes the pending steps. Does nothing without a preview. True when every source took it (and
  /// any rating): the sheet closes; otherwise it stays open with each source's error.
  Future<bool> confirm() async {
    final p = plan;
    final steps = pending;
    if (p == null || steps.isEmpty || saving) return false;
    saving = true;
    notifyListeners();
    try {
      final res = await api.mark.postMarkConfirm(
        body: PostMarkConfirmRequest(
          rowKey: p.rowKey,
          source: source == null
              ? null
              : PostMarkConfirmRequestSource.fromJson(source),
          today: localDay(_clock()),
          steps: [
            for (final s in steps)
              _ConfirmStep(
                sendStatus: s.after != null,
                source: PostMarkConfirmRequestStepsItemSource.fromJson(
                  s.source.toJson(),
                ),
                expected: s.expected,
                status: s.after == null || after[s.source.toJson()] == leave
                    ? null
                    : PostMarkConfirmRequestStepsItemStatus.fromJson(
                        after[s.source.toJson()],
                      ),
                rating: ratingFor(s),
              ),
          ],
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
      // A failed rating keeps the sheet open so its error is read.
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

/// A confirm step that sends `status` even when null. The server tells them apart: null leaves the
/// list status to the source ("Keep watching"), a missing `status` keeps the preview's suggestion. The
/// generated `toJson` drops nulls, so a step with `after` always sends it, as legacy does.
class _ConfirmStep extends PostMarkConfirmRequestStepsItem {
  const _ConfirmStep({
    required this.sendStatus,
    required super.source,
    required super.expected,
    super.status,
    super.rating,
  });

  final bool sendStatus;

  @override
  Map<String, Object?> toJson() => {
    ...super.toJson(),
    if (sendStatus) 'status': status?.toJson(),
  };
}

/// An anime entry to start: the plan's target, a choice, or a search result.
class StartCandidate {
  const StartCandidate({
    required this.malId,
    required this.title,
    this.format,
    this.episodes,
    this.status,
    this.year,
  });

  factory StartCandidate.of(StartTarget t) => StartCandidate(
    malId: t.malId.toInt(),
    title: t.title,
    format: t.format,
    episodes: t.episodes,
    status: t.status,
    year: t.year,
  );

  factory StartCandidate.ofPlan(StartPlanTarget t) => StartCandidate(
    malId: t.malId.toInt(),
    title: t.title,
    format: t.format,
    episodes: t.episodes,
    status: t.status,
    year: t.year,
  );

  final int malId;
  final String title;
  final String? format;
  final num? episodes;
  final String? status;
  final num? year;

  String get malUrl => 'https://myanimelist.net/anime/$malId';

  /// "TV · 12 eps · 2026 · releasing"
  String get describe => [
    ?format,
    if (episodes != null && episodes != 0) '${episodes!.toInt()} eps',
    if (year != null) '${year!.toInt()}',
    if (status != null) status!.toLowerCase().replaceAll('_', ' '),
  ].join(' · ');
}

/// "Start next season" (#66): find the entry (the link, AniList's sequel, or a search), preview each
/// source's step, confirm. Puts it on Watching with 0 episodes, then links it to Trakt's season.
class StartFlow extends ChangeNotifier {
  StartFlow({
    required this.api,
    required this.rowKey,
    required this.title,
    this.search = false,
    this.malId,
  }) : query = title;

  final TsuzukuApi api;
  final String rowKey;
  final String title;

  /// Nothing links the show to an anime yet.
  final bool search;

  /// An entry picked before opening (a Coming back sequel); still only a preview.
  final int? malId;

  StartPlan? plan;
  bool loading = false;
  String? loadError;
  Set<String> picked = {};
  final outcomes = <String, WriteOutcome>{};
  String? linkError;
  bool saving = false;
  bool wrote = false;

  bool searching = false;
  String query;
  List<StartCandidate>? results;
  bool searchLoading = false;

  StartCandidate? get target =>
      plan?.target == null ? null : StartCandidate.ofPlan(plan!.target!);

  Future<void> preview([int? pickedMalId]) async {
    loading = true;
    loadError = null;
    outcomes.clear();
    linkError = null;
    notifyListeners();
    try {
      final p = await api.nextSeason.postNextSeasonPreview(
        body: PostNextSeasonPreviewRequest(
          rowKey: rowKey,
          malId: pickedMalId ?? malId,
        ),
      );
      plan = p;
      picked = {for (final s in p.steps) s.source.toJson()};
      searching = p.target == null && p.needsSearch;
      if (searching) unawaited(runSearch());
    } catch (e) {
      plan = null;
      loadError = writeErrorText(e);
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> runSearch() async {
    final q = query.trim();
    if (q.length < 2) return;
    searchLoading = true;
    loadError = null;
    notifyListeners();
    try {
      results = [
        for (final t in await api.anilist.getAnilistSearch(q: q))
          StartCandidate.of(t),
      ];
    } catch (e) {
      loadError = writeErrorText(e);
    } finally {
      searchLoading = false;
      notifyListeners();
    }
  }

  void openSearch() {
    searching = true;
    notifyListeners();
    unawaited(runSearch());
  }

  /// Picking a result or a choice previews it: nothing is written yet.
  Future<void> pick(StartCandidate c) {
    searching = false;
    return preview(c.malId);
  }

  bool isDone(String source) => outcomes[source]?.ok ?? false;

  void toggle(String source, bool on) {
    if (saving || isDone(source)) return;
    on ? picked.add(source) : picked.remove(source);
    notifyListeners();
  }

  List<StartStep> get pending => [
    for (final s in plan?.steps ?? const <StartStep>[])
      if (picked.contains(s.source.toJson()) && !isDone(s.source.toJson())) s,
  ];

  bool get anyFailed => outcomes.values.any((o) => !o.ok);
  bool get allDone => plan != null && outcomes.isNotEmpty && pending.isEmpty;

  /// Writes the pending steps. Does nothing without a previewed target. True when every source took
  /// it and the link stood.
  Future<bool> confirm() async {
    final p = plan;
    final t = p?.target;
    final steps = pending;
    if (p == null || t == null || steps.isEmpty || saving || searching) {
      return false;
    }
    saving = true;
    notifyListeners();
    try {
      final res = await api.nextSeason.postNextSeasonConfirm(
        body: PostNextSeasonConfirmRequest(
          rowKey: p.rowKey,
          malId: t.malId.toInt(),
          steps: [
            for (final s in steps)
              PostNextSeasonConfirmRequestStepsItem(
                source: PostNextSeasonConfirmRequestStepsItemSource.fromJson(
                  s.source.toJson(),
                ),
                expected: s.expected,
              ),
          ],
        ),
      );
      for (final o in res.outcomes) {
        outcomes[o.source.toJson()] = WriteOutcome(ok: o.ok, error: o.error);
      }
      linkError = res.linkError;
      if (res.outcomes.any((o) => o.ok)) wrote = true;
      return res.outcomes.every((o) => o.ok) && res.linkError == null;
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
