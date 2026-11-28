import 'dart:async';

import 'package:flutter/material.dart';

import '../api/tsuzuku_api.dart';
import '../up_next/poster.dart';
import '../up_next/source_ui.dart';
import '../up_next/up_next_card.dart' show openUrl;
import 'write_flows.dart';
import 'write_sheets.dart';

// Add an anime on Shows (#108, step 3.6; legacy `AnimeAddModal.vue`): find it on AniList, choose Watching or Plan to
// Watch, preview what MAL and Simkl would do, then confirm per source. Nothing is written before the confirm. Trakt
// is not offered: an AniList pick carries no Trakt ID; Trakt's show gets linked through Mappings once it is there.
//
// Or add a show that is not anime (#105): find it on Trakt; Plan to Watch puts it on Trakt's watchlist and Simkl's
// Plan to Watch, Watching marks S1E1 watched on both. Same preview and confirm per source; MAL is not offered.
//
// Its own page, not a sheet: a list of results with posters needs the height, and the search field stays put above
// it while the results scroll.

const animeListLabels = {
  'watching': 'Watching',
  'plan_to_watch': 'Plan to Watch',
};

/// One source's step in either preview (anime or show).
typedef AddStep = ({String source, String summary, String expected});

/// A source the preview left out, with the reason.
typedef AddSkip = ({String source, String reason});

class AnimeAddFlow extends ChangeNotifier {
  AnimeAddFlow({required this.api});

  final TsuzukuApi api;

  /// anime (AniList, onto MAL and Simkl) or show (Trakt, onto Trakt and Simkl; #105).
  String kind = 'anime';

  List<TraktShow>? showResults;
  TraktShow? pickedShow;
  ShowAddPlan? showPlan;

  /// watching or plan_to_watch.
  String status = 'watching';
  String query = '';
  List<StartCandidate>? results;

  /// Anime movies the search found: they are added on Movies (decision #23), so left out here.
  int moviesLeftOut = 0;
  bool searching = false;
  String? error;

  // Counts searches, so an answer to an older one (typing went on, or the kind changed) is dropped.
  int _searchSeq = 0;

  StartCandidate? picked;
  StartPlan? plan;
  bool loading = false;
  Set<String> chosen = {};
  final outcomes = <String, WriteOutcome>{};
  bool saving = false;
  bool wrote = false;

  String get listLabel => animeListLabels[status] ?? status;

  bool get isShow => kind == 'show';
  bool get hasPick => isShow ? pickedShow != null : picked != null;
  bool get hasPlan => isShow ? showPlan != null : plan != null;

  List<AddStep> get steps => isShow
      ? [
          for (final s in showPlan?.steps ?? const <ShowAddStep>[])
            (
              source: s.source.toJson(),
              summary: s.summary,
              expected: s.expected,
            ),
        ]
      : [
          for (final s in plan?.steps ?? const <StartStep>[])
            (
              source: s.source.toJson(),
              summary: s.summary,
              expected: s.expected,
            ),
        ];

  List<AddSkip> get skipped => isShow
      ? [
          for (final s in showPlan?.skipped ?? const <ShowAddPlanSkippedItem>[])
            (source: s.source.toJson(), reason: s.reason),
        ]
      : [
          for (final s in plan?.skipped ?? const <StartPlanSkippedItem>[])
            (source: s.source.toJson(), reason: s.reason),
        ];

  /// Switching between anime and show starts the search over; the typed title stays.
  void setKind(String value) {
    if (kind == value || saving) return;
    kind = value;
    _searchSeq++;
    searching = false;
    results = null;
    showResults = null;
    moviesLeftOut = 0;
    picked = null;
    pickedShow = null;
    plan = null;
    showPlan = null;
    outcomes.clear();
    error = null;
    notifyListeners();
  }

  Future<void> search() async {
    final q = query.trim();
    if (q.length < 2) return;
    final seq = ++_searchSeq;
    searching = true;
    error = null;
    notifyListeners();
    try {
      if (isShow) {
        final res = await api.trakt.getTraktSearch(q: q);
        if (seq != _searchSeq) return;
        showResults = res.data;
        if (res.data.isEmpty &&
            res.status != GetTraktSearchResponse200Status.ok) {
          error = 'Could not search Trakt: ${res.error ?? res.status.toJson()}';
        }
        return;
      }
      final all = await api.anilist.getAnilistSearch(q: q);
      if (seq != _searchSeq) return;
      results = [
        for (final t in all)
          if (t.format != 'MOVIE') StartCandidate.of(t),
      ];
      moviesLeftOut = all.length - results!.length;
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
  Future<void> pick(StartCandidate t) {
    picked = t;
    return preview();
  }

  Future<void> pickShow(TraktShow s) {
    pickedShow = s;
    return preview();
  }

  void searchAgain() {
    if (saving || allDone) return;
    picked = null;
    pickedShow = null;
    plan = null;
    showPlan = null;
    outcomes.clear();
    error = null;
    notifyListeners();
  }

  /// The list changes what each source would do, so the preview is read again.
  Future<void> setStatus(String value) async {
    if (status == value || saving || allDone) return;
    status = value;
    notifyListeners();
    if (hasPick) await preview();
  }

  Future<void> preview() async {
    if (isShow) return _previewShow();
    final p = picked;
    if (p == null) return;
    loading = true;
    error = null;
    outcomes.clear();
    notifyListeners();
    try {
      final res = await api.anime.postAnimeAddPreview(
        body: PostAnimeAddPreviewRequest(
          malId: p.malId,
          status: PostAnimeAddPreviewRequestStatus.fromJson(status),
        ),
      );
      plan = res;
      chosen = {for (final s in res.steps) s.source.toJson()};
    } catch (e) {
      plan = null;
      error = writeErrorText(e);
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> _previewShow() async {
    final p = pickedShow;
    if (p == null) return;
    loading = true;
    error = null;
    outcomes.clear();
    notifyListeners();
    try {
      final res = await api.shows.postShowsAddPreview(
        body: PostShowsAddPreviewRequest(
          traktId: p.trakt.toInt(),
          status: PostShowsAddPreviewRequestStatus.fromJson(status),
        ),
      );
      showPlan = res;
      chosen = {for (final s in res.steps) s.source.toJson()};
    } catch (e) {
      showPlan = null;
      error = writeErrorText(e);
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  bool isDone(String source) => outcomes[source]?.ok ?? false;

  void toggle(String source, bool on) {
    if (saving || isDone(source)) return;
    on ? chosen.add(source) : chosen.remove(source);
    notifyListeners();
  }

  List<AddStep> get pending => [
    for (final s in steps)
      if (chosen.contains(s.source) && !isDone(s.source)) s,
  ];

  bool get anyFailed => outcomes.values.any((o) => !o.ok);
  bool get allDone => hasPlan && outcomes.isNotEmpty && pending.isEmpty;

  /// Writes the pending steps with their `expected`. Does nothing without a preview. True when every source took it.
  Future<bool> confirm() async {
    final todo = pending;
    if (!hasPick || !hasPlan || todo.isEmpty || saving || loading) {
      return false;
    }
    saving = true;
    notifyListeners();
    try {
      final List<({String source, bool ok, String? error})> results;
      if (isShow) {
        final res = await api.shows.postShowsAddConfirm(
          body: PostShowsAddConfirmRequest(
            traktId: pickedShow!.trakt.toInt(),
            status: PostShowsAddConfirmRequestStatus.fromJson(status),
            steps: [
              for (final s in todo)
                PostShowsAddConfirmRequestStepsItem(
                  source: PostShowsAddConfirmRequestStepsItemSource.fromJson(
                    s.source,
                  ),
                  expected: s.expected,
                ),
            ],
          ),
        );
        results = [
          for (final o in res.outcomes)
            (source: o.source.toJson(), ok: o.ok, error: o.error),
        ];
      } else {
        final res = await api.anime.postAnimeAddConfirm(
          body: PostAnimeAddConfirmRequest(
            malId: picked!.malId,
            status: PostAnimeAddConfirmRequestStatus.fromJson(status),
            steps: [
              for (final s in todo)
                PostAnimeAddConfirmRequestStepsItem(
                  source: PostAnimeAddConfirmRequestStepsItemSource.fromJson(
                    s.source,
                  ),
                  expected: s.expected,
                ),
            ],
          ),
        );
        results = [
          for (final o in res.outcomes)
            (source: o.source.toJson(), ok: o.ok, error: o.error),
        ];
      }
      for (final o in results) {
        outcomes[o.source] = WriteOutcome(ok: o.ok, error: o.error);
      }
      if (results.any((o) => o.ok)) wrote = true;
      return results.every((o) => o.ok);
    } catch (e) {
      final message = writeErrorText(e);
      for (final s in todo) {
        outcomes[s.source] = WriteOutcome(ok: false, error: message);
      }
      return false;
    } finally {
      saving = false;
      notifyListeners();
    }
  }
}

/// "Add an anime" (legacy `AnimeAddModal.vue`), or a show that is not anime (#105), as its own page.
class AnimeAddScreen extends StatefulWidget {
  const AnimeAddScreen({
    super.key,
    required this.flow,
    this.posters,
    this.onOpenMovies,
  });

  final AnimeAddFlow flow;
  final PosterSource? posters;

  /// Opens the Movies tab (anime movies are added there).
  final VoidCallback? onOpenMovies;

  @override
  State<AnimeAddScreen> createState() => _AnimeAddScreenState();
}

/// Poster size in the result list and in the preview.
const _resultPoster = Size(48, 72);
const _previewPoster = Size(64, 96);

class _AnimeAddScreenState extends State<AnimeAddScreen> {
  AnimeAddFlow get flow => widget.flow;
  late final _query = TextEditingController(text: flow.query);
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _query.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final close = await flow.confirm();
    if (close && mounted) Navigator.of(context).pop();
  }

  void _search() {
    _timer?.cancel();
    flow.query = _query.text;
    flow.search();
  }

  /// Searches once typing pauses, not on every key; Enter or the button searches at once.
  void _typed(String q) {
    flow.query = q;
    _timer?.cancel();
    _timer = Timer(searchDelay, _search);
  }

  /// The other kind searches the typed title again.
  void _setKind(String kind) {
    flow.setKind(kind);
    _search();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: flow,
    builder: (context, _) {
      final theme = Theme.of(context);
      final muted = theme.textTheme.bodySmall?.copyWith(
        color: theme.colorScheme.onSurfaceVariant,
      );
      final width = MediaQuery.sizeOf(context).width;
      final side = addPageSide(width);
      return PopScope(
        // A write in flight finishes first, so its outcome is seen.
        canPop: !flow.saving,
        child: Scaffold(
          appBar: AppBar(
            title: Text(flow.isShow ? 'Add a show' : 'Add an anime'),
          ),
          body: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: EdgeInsets.fromLTRB(side, 8, side, 0),
                child: _controls(context, muted),
              ),
              Expanded(
                child: flow.hasPick
                    ? SingleChildScrollView(
                        key: const ValueKey('add-preview'),
                        padding: EdgeInsets.fromLTRB(side, 8, side, 16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: _preview(context),
                        ),
                      )
                    : _results(context, muted, side),
              ),
            ],
          ),
          bottomNavigationBar: flow.hasPick ? _actions(context, side) : null,
        ),
      );
    },
  );

  /// Cancel / Close and the confirm, under the preview.
  Widget _actions(BuildContext context, double side) {
    final pending = flow.pending;
    final n = pending.length;
    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.fromLTRB(side, 8, side, 16),
        child: Wrap(
          alignment: WrapAlignment.end,
          spacing: 8,
          runSpacing: 8,
          children: [
            TextButton(
              key: const ValueKey('write-cancel'),
              onPressed: flow.saving ? null : () => Navigator.of(context).pop(),
              child: Text(flow.allDone ? 'Close' : 'Cancel'),
            ),
            if (flow.hasPlan && !flow.allDone)
              FilledButton.icon(
                key: const ValueKey('write-confirm'),
                onPressed: flow.loading || flow.saving || pending.isEmpty
                    ? null
                    : _confirm,
                icon: flow.saving
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(flow.anyFailed ? Icons.refresh : Icons.add),
                label: Text(
                  flow.anyFailed
                      ? 'Retry'
                      : flow.isShow && flow.status == 'watching'
                      ? 'Mark S1E1 watched on $n ${n == 1 ? 'source' : 'sources'}'
                      : 'Add to ${flow.listLabel} on $n ${n == 1 ? 'source' : 'sources'}',
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// Kind, list, and (before a pick) the search field: they stay put while the results scroll.
  Widget _controls(BuildContext context, TextStyle? muted) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (flow.error != null) SheetAlert(text: flow.error!, error: true),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          key: const ValueKey('add-kind'),
          segments: const [
            ButtonSegment(
              value: 'anime',
              icon: Icon(Icons.animation),
              label: Text('Anime'),
            ),
            ButtonSegment(
              value: 'show',
              icon: Icon(Icons.live_tv_outlined),
              label: Text('Show'),
            ),
          ],
          selected: {flow.kind},
          onSelectionChanged: flow.saving || flow.allDone
              ? null
              : (s) => _setKind(s.first),
        ),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          key: const ValueKey('anime-status'),
          segments: const [
            ButtonSegment(
              value: 'watching',
              icon: Icon(Icons.play_arrow_outlined),
              label: Text('Watching'),
            ),
            ButtonSegment(
              value: 'plan_to_watch',
              icon: Icon(Icons.bookmark_outline),
              label: Text('Plan to Watch'),
            ),
          ],
          selected: {flow.status},
          onSelectionChanged: flow.saving || flow.allDone
              ? null
              : (s) => flow.setStatus(s.first),
        ),
        if (flow.isShow)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              flow.status == 'watching'
                  ? 'Marks S1E1 watched on both, so the show is on Shows with S1E2 next.'
                  : "Puts it on Trakt's watchlist and Simkl's Plan to Watch; nothing is marked watched.",
              key: const ValueKey('show-status-note'),
              style: muted,
            ),
          ),
        const SizedBox(height: 8),
        if (!flow.hasPick) ..._find(context, muted),
      ],
    );
  }

  List<Widget> _find(BuildContext context, TextStyle? muted) {
    return [
      Text.rich(
        TextSpan(
          style: muted,
          children: [
            const TextSpan(text: 'From '),
            sourceSpan(flow.isShow ? 'trakt' : 'anilist', style: muted),
            const TextSpan(text: '; it goes on '),
            sourceSpan(flow.isShow ? 'trakt' : 'mal', style: muted),
            const TextSpan(text: ' and '),
            sourceSpan('simkl', style: muted),
            const TextSpan(text: '.'),
          ],
        ),
      ),
      const SizedBox(height: 8),
      Row(
        children: [
          Expanded(
            child: TextField(
              key: const ValueKey('anime-query'),
              controller: _query,
              autofocus: true,
              textInputAction: TextInputAction.search,
              onChanged: _typed,
              onSubmitted: (_) => _search(),
              decoration: const InputDecoration(
                hintText: 'Title',
                prefixIcon: Icon(Icons.search),
                isDense: true,
                border: OutlineInputBorder(),
              ),
            ),
          ),
          const SizedBox(width: 8),
          OutlinedButton(
            onPressed: flow.searching ? null : _search,
            child: flow.searching
                ? const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Search'),
          ),
        ],
      ),
    ];
  }

  /// The results, in their own scrolling list under the search field.
  Widget _results(BuildContext context, TextStyle? muted, double side) {
    final results = flow.results;
    final shows = flow.showResults;
    return ListView(
      key: const ValueKey('add-results'),
      padding: EdgeInsets.fromLTRB(
        side,
        8,
        side,
        16 + MediaQuery.paddingOf(context).bottom,
      ),
      children: [
        if (flow.isShow && shows != null) ...[
          if (shows.isEmpty) Text('No show found.', style: muted),
          for (final r in shows)
            _resultRow(
              key: ValueKey('show-result:${r.trakt}'),
              poster: _poster([?r.poster], _resultPoster),
              title: _link(r.title, _traktUrl(r)),
              detail: Text(_describeShow(r), style: muted),
              pick: FilledButton.tonal(
                key: ValueKey('show-pick:${r.trakt}'),
                onPressed: () => flow.pickShow(r),
                child: const Text('Pick'),
              ),
            ),
        ],
        if (!flow.isShow && results != null) ...[
          if (results.isEmpty) Text('No anime found.', style: muted),
          for (final r in results)
            _resultRow(
              key: ValueKey('anime-result:${r.malId}'),
              poster: _poster([?r.cover], _resultPoster),
              title: _link(r.title, r.malUrl),
              detail: Text(r.describe, style: muted),
              pick: FilledButton.tonal(
                key: ValueKey('anime-pick:${r.malId}'),
                onPressed: () => flow.pick(r),
                child: const Text('Pick'),
              ),
            ),
        ],
        if (!flow.isShow && flow.moviesLeftOut > 0)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  '${flow.moviesLeftOut} anime ${flow.moviesLeftOut == 1 ? 'movie' : 'movies'} left out: add those on ',
                  style: muted,
                ),
                InkWell(
                  key: const ValueKey('anime-open-movies'),
                  onTap: widget.onOpenMovies == null
                      ? null
                      : () {
                          Navigator.of(context).pop();
                          widget.onOpenMovies!();
                        },
                  child: Text(
                    'Movies',
                    style: muted?.copyWith(
                      decoration: TextDecoration.underline,
                    ),
                  ),
                ),
                Text('.', style: muted),
              ],
            ),
          ),
      ],
    );
  }

  Widget _resultRow({
    required Key key,
    required Widget poster,
    required Widget title,
    required Widget detail,
    required Widget pick,
  }) => Padding(
    key: key,
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(
      children: [
        poster,
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [title, detail],
          ),
        ),
        const SizedBox(width: 8),
        pick,
      ],
    ),
  );

  List<Widget> _preview(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final p = flow.picked;
    final show = flow.pickedShow;
    return [
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _poster(show != null ? [?show.poster] : [?p?.cover], _previewPoster),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (show != null) ...[
                  _link(
                    show.title,
                    _traktUrl(show),
                    style: theme.textTheme.titleMedium,
                  ),
                  Text(_describeShow(show), style: muted),
                ] else ...[
                  _link(p!.title, p.malUrl, style: theme.textTheme.titleMedium),
                  Text(p.describe, style: muted),
                ],
                if (!flow.saving && !flow.allDone)
                  TextButton(
                    key: const ValueKey('anime-search-again'),
                    style: TextButton.styleFrom(
                      padding: EdgeInsets.zero,
                      visualDensity: VisualDensity.compact,
                    ),
                    onPressed: flow.searchAgain,
                    child: const Text('Not this one? Search again'),
                  ),
              ],
            ),
          ),
        ],
      ),
      const SizedBox(height: 4),
      if (flow.loading)
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 24),
          child: Center(child: CircularProgressIndicator()),
        )
      else if (flow.hasPlan) ...[
        for (final s in flow.steps) _step(context, s),
        for (final s in flow.skipped) _note(context, s.source, s.reason),
        if (flow.isShow)
          _note(context, 'mal', 'not offered; it lists anime only.')
        else
          _note(
            context,
            'trakt',
            'not offered; link its show on Mappings once it is there.',
          ),
      ],
    ];
  }

  Widget _step(BuildContext context, AddStep s) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final source = s.source;
    final outcome = flow.outcomes[source];
    final done = outcome?.ok ?? false;
    final enabled = !flow.saving && !done;
    return InkWell(
      key: ValueKey('step:$source'),
      onTap: enabled
          ? () => flow.toggle(source, !flow.chosen.contains(source))
          : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Checkbox(
              key: ValueKey('pick:$source'),
              value: flow.chosen.contains(source),
              onChanged: enabled
                  ? (v) => flow.toggle(source, v ?? false)
                  : null,
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: 10, right: 8, bottom: 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SourceName(
                      source,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    Text(s.summary, style: muted),
                    if (outcome != null && !outcome.ok)
                      KeyedSubtree(
                        key: ValueKey('error:$source'),
                        child: errorLine(context, outcome.error ?? 'failed'),
                      ),
                  ],
                ),
              ),
            ),
            if (done)
              Padding(
                padding: const EdgeInsets.only(top: 10, right: 8),
                child: OutcomeMark(outcome!),
              ),
          ],
        ),
      ),
    );
  }

  Widget _note(BuildContext context, String source, String text) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Padding(
      key: ValueKey('note:$source'),
      padding: const EdgeInsets.fromLTRB(12, 6, 8, 6),
      child: Text.rich(
        TextSpan(
          style: muted,
          children: [
            sourceSpan(source, style: muted),
            TextSpan(text: ': $text'),
          ],
        ),
      ),
    );
  }

  String _traktUrl(TraktShow s) => 'https://trakt.tv/shows/${s.slug}';

  /// "2026 · 16 eps"
  String _describeShow(TraktShow s) => [
    if (s.year != null) '${s.year!.toInt()}',
    if (s.airedEpisodes != null && s.airedEpisodes != 0)
      '${s.airedEpisodes!.toInt()} eps',
  ].join(' · ');

  Widget _poster(List<String> images, Size size) => Poster(
    images: images,
    source: widget.posters,
    width: size.width,
    height: size.height,
  );

  Widget _link(String text, String url, {TextStyle? style}) => InkWell(
    onTap: () => openUrl(url),
    child: Text(
      text,
      style: (style ?? const TextStyle()).copyWith(
        fontWeight: FontWeight.w600,
        decoration: TextDecoration.underline,
        decorationStyle: TextDecorationStyle.dotted,
      ),
    ),
  );
}
