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

const animeListLabels = {
  'watching': 'Watching',
  'plan_to_watch': 'Plan to Watch',
};

class AnimeAddFlow extends ChangeNotifier {
  AnimeAddFlow({required this.api});

  final TsuzukuApi api;

  /// watching or plan_to_watch.
  String status = 'watching';
  String query = '';
  List<StartCandidate>? results;

  /// Anime movies the search found: they are added on Movies (decision #23), so left out here.
  int moviesLeftOut = 0;
  bool searching = false;
  String? error;

  StartCandidate? picked;
  StartPlan? plan;
  bool loading = false;
  Set<String> chosen = {};
  final outcomes = <String, WriteOutcome>{};
  bool saving = false;
  bool wrote = false;

  String get listLabel => animeListLabels[status] ?? status;

  Future<void> search() async {
    final q = query.trim();
    if (q.length < 2) return;
    searching = true;
    error = null;
    notifyListeners();
    try {
      final all = await api.anilist.getAnilistSearch(q: q);
      results = [
        for (final t in all)
          if (t.format != 'MOVIE') StartCandidate.of(t),
      ];
      moviesLeftOut = all.length - results!.length;
    } catch (e) {
      error = writeErrorText(e);
    } finally {
      searching = false;
      notifyListeners();
    }
  }

  /// Picking a result previews it: nothing is written yet.
  Future<void> pick(StartCandidate t) {
    picked = t;
    return preview();
  }

  void searchAgain() {
    if (saving || allDone) return;
    picked = null;
    plan = null;
    outcomes.clear();
    error = null;
    notifyListeners();
  }

  /// The list changes what each source would do, so the preview is read again.
  Future<void> setStatus(String value) async {
    if (status == value || saving || allDone) return;
    status = value;
    notifyListeners();
    if (picked != null) await preview();
  }

  Future<void> preview() async {
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

  bool isDone(String source) => outcomes[source]?.ok ?? false;

  void toggle(String source, bool on) {
    if (saving || isDone(source)) return;
    on ? chosen.add(source) : chosen.remove(source);
    notifyListeners();
  }

  List<StartStep> get pending => [
    for (final s in plan?.steps ?? const <StartStep>[])
      if (chosen.contains(s.source.toJson()) && !isDone(s.source.toJson())) s,
  ];

  bool get anyFailed => outcomes.values.any((o) => !o.ok);
  bool get allDone => plan != null && outcomes.isNotEmpty && pending.isEmpty;

  /// Writes the pending steps with their `expected`. Does nothing without a preview. True when every source took it.
  Future<bool> confirm() async {
    final p = picked;
    final steps = pending;
    if (p == null || plan == null || steps.isEmpty || saving || loading) {
      return false;
    }
    saving = true;
    notifyListeners();
    try {
      final res = await api.anime.postAnimeAddConfirm(
        body: PostAnimeAddConfirmRequest(
          malId: p.malId,
          status: PostAnimeAddConfirmRequestStatus.fromJson(status),
          steps: [
            for (final s in steps)
              PostAnimeAddConfirmRequestStepsItem(
                source: PostAnimeAddConfirmRequestStepsItemSource.fromJson(
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

/// "Add an anime" (legacy `AnimeAddModal.vue`).
class AnimeAddSheet extends StatefulWidget {
  const AnimeAddSheet({
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
  State<AnimeAddSheet> createState() => _AnimeAddSheetState();
}

class _AnimeAddSheetState extends State<AnimeAddSheet> {
  AnimeAddFlow get flow => widget.flow;
  late final _query = TextEditingController(text: flow.query);

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final close = await flow.confirm();
    if (close && mounted) Navigator.of(context).pop();
  }

  void _search() {
    flow.query = _query.text;
    flow.search();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: flow,
    builder: (context, _) {
      final pending = flow.pending;
      final n = pending.length;
      return SheetFrame(
        title: 'Add an anime',
        body: _body(context),
        actions: [
          TextButton(
            key: const ValueKey('write-cancel'),
            onPressed: () => Navigator.of(context).pop(),
            child: Text(flow.allDone ? 'Close' : 'Cancel'),
          ),
          if (flow.plan != null && !flow.allDone)
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
                    : 'Add to ${flow.listLabel} on $n ${n == 1 ? 'source' : 'sources'}',
              ),
            ),
        ],
      );
    },
  );

  Widget _body(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (flow.error != null) SheetAlert(text: flow.error!, error: true),
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
        const SizedBox(height: 8),
        if (flow.picked == null)
          ..._find(context, muted)
        else
          ..._preview(context),
      ],
    );
  }

  List<Widget> _find(BuildContext context, TextStyle? muted) {
    final results = flow.results;
    return [
      Text.rich(
        TextSpan(
          style: muted,
          children: [
            const TextSpan(text: 'From '),
            sourceSpan('anilist', style: muted),
            const TextSpan(text: '; it goes on '),
            sourceSpan('mal', style: muted),
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
      if (results != null) ...[
        const SizedBox(height: 8),
        if (results.isEmpty) Text('No anime found.', style: muted),
        for (final r in results)
          Padding(
            key: ValueKey('anime-result:${r.malId}'),
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                _cover(r, 40, 60),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _link(r.title, r.malUrl),
                      Text(r.describe, style: muted),
                    ],
                  ),
                ),
                FilledButton.tonal(
                  key: ValueKey('anime-pick:${r.malId}'),
                  onPressed: () => flow.pick(r),
                  child: const Text('Pick'),
                ),
              ],
            ),
          ),
      ],
      if (flow.moviesLeftOut > 0)
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
                  style: muted?.copyWith(decoration: TextDecoration.underline),
                ),
              ),
              Text('.', style: muted),
            ],
          ),
        ),
    ];
  }

  List<Widget> _preview(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final p = flow.picked!;
    final plan = flow.plan;
    return [
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _cover(p, 56, 84),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _link(p.title, p.malUrl, style: theme.textTheme.titleMedium),
                Text(p.describe, style: muted),
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
      else if (plan != null) ...[
        for (final s in plan.steps) _step(context, s),
        for (final s in plan.skipped)
          _note(context, s.source.toJson(), s.reason),
        _note(
          context,
          'trakt',
          'not offered; link its show on Mappings once it is there.',
        ),
      ],
    ];
  }

  Widget _step(BuildContext context, StartStep s) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final source = s.source.toJson();
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

  Widget _cover(StartCandidate c, double w, double h) =>
      Poster(images: [?c.cover], source: widget.posters, width: w, height: h);

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
