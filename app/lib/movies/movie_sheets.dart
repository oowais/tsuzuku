import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../api/tsuzuku_api.dart';
import '../up_next/source_ui.dart';
import '../up_next/up_next_card.dart' show openUrl;
import '../writes/write_flows.dart' show WriteOutcome;
import '../writes/write_sheets.dart';
import 'movie_flows.dart';

// The movie sheets (#108, step 3.6; legacy `MovieMarkModal.vue`, `MovieAddModal.vue`): a bottom sheet on phones, a
// dialog on wide screens (`showWriteSheet`). Nothing is written until the confirm button.

Widget _loading() => const Padding(
  padding: EdgeInsets.symmetric(vertical: 24),
  child: Center(child: CircularProgressIndicator()),
);

Widget _spinnerOr(bool busy, IconData icon) => busy
    ? const SizedBox.square(
        dimension: 16,
        child: CircularProgressIndicator(strokeWidth: 2),
      )
    : Icon(icon);

String _sources(int n) => '$n ${n == 1 ? 'source' : 'sources'}';

/// A step's row: checkbox, the source with its logo, what it would do, its outcome.
class _StepRow extends StatelessWidget {
  const _StepRow({
    required this.source,
    required this.picked,
    required this.enabled,
    required this.onToggle,
    required this.children,
    this.outcome,
  });

  final String source;
  final bool picked;
  final bool enabled;
  final ValueChanged<bool> onToggle;
  final List<Widget> children;
  final WriteOutcome? outcome;

  @override
  Widget build(BuildContext context) {
    final o = outcome;
    return InkWell(
      key: ValueKey('step:$source'),
      onTap: enabled ? () => onToggle(!picked) : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Checkbox(
              key: ValueKey('pick:$source'),
              value: picked,
              onChanged: enabled ? (v) => onToggle(v ?? false) : null,
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: 10, right: 8, bottom: 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: children,
                ),
              ),
            ),
            if (o != null && o.ok)
              Padding(
                padding: const EdgeInsets.only(top: 10, right: 8),
                child: OutcomeMark(o),
              ),
          ],
        ),
      ),
    );
  }
}

Widget _skipped(BuildContext context, String source, String reason) {
  final theme = Theme.of(context);
  final muted = theme.textTheme.bodyMedium?.copyWith(
    color: theme.colorScheme.onSurfaceVariant,
  );
  return Padding(
    key: ValueKey('skipped:$source'),
    padding: const EdgeInsets.fromLTRB(12, 6, 8, 6),
    child: Text.rich(
      TextSpan(
        style: muted,
        children: [
          sourceSpan(source, style: muted),
          TextSpan(text: ': $reason'),
        ],
      ),
    ),
  );
}

/// "Mark watched" for a movie (legacy `MovieMarkModal.vue`).
class MovieMarkSheet extends StatefulWidget {
  const MovieMarkSheet({super.key, required this.flow, required this.title});

  final MovieMarkFlow flow;
  final String title;

  @override
  State<MovieMarkSheet> createState() => _MovieMarkSheetState();
}

class _MovieMarkSheetState extends State<MovieMarkSheet> {
  MovieMarkFlow get flow => widget.flow;

  @override
  void initState() {
    super.initState();
    if (flow.plan == null && !flow.loading) flow.preview();
  }

  Future<void> _confirm() async {
    final close = await flow.confirm();
    if (close && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: flow,
    builder: (context, _) {
      final plan = flow.plan;
      final pending = flow.pending;
      return SheetFrame(
        title: 'Mark watched',
        subtitle: widget.title,
        body: _body(context),
        actions: [
          TextButton(
            key: const ValueKey('write-cancel'),
            onPressed: () => Navigator.of(context).pop(),
            child: Text(flow.allDone ? 'Close' : 'Cancel'),
          ),
          if (plan != null && plan.steps.isNotEmpty && !flow.allDone)
            FilledButton.icon(
              key: const ValueKey('write-confirm'),
              onPressed: flow.loading || flow.saving || pending.isEmpty
                  ? null
                  : _confirm,
              icon: _spinnerOr(
                flow.saving,
                flow.anyFailed ? Icons.refresh : Icons.done_all,
              ),
              label: Text(
                flow.anyFailed
                    ? 'Retry'
                    : 'Mark on ${_sources(pending.length)}',
              ),
            ),
        ],
      );
    },
  );

  Widget _body(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    if (flow.loadError != null) {
      return SheetAlert(text: flow.loadError!, error: true);
    }
    final plan = flow.plan;
    if (flow.loading || plan == null) return _loading();
    final current = flow.currentScores;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (plan.steps.isNotEmpty)
          Wrap(
            spacing: 12,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('Your rating', style: muted),
              ScoreMenu(
                key: const ValueKey('movie-score'),
                value: flow.score,
                enabled: !flow.saving,
                onChanged: flow.setScore,
              ),
              if (current.isNotEmpty)
                Text.rich(
                  TextSpan(
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    children: [
                      const TextSpan(text: 'now '),
                      for (final (i, s) in current.indexed) ...[
                        if (i > 0) const TextSpan(text: ', '),
                        sourceSpan(s.source.toJson()),
                        TextSpan(text: ' ${s.currentRating!.toInt()}'),
                      ],
                    ],
                  ),
                ),
            ],
          ),
        const SizedBox(height: 4),
        for (final s in plan.steps) _step(context, s),
        for (final s in plan.skipped)
          _skipped(context, s.source.toJson(), s.reason),
        if (plan.steps.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'Nothing to mark: every source has it watched or set aside.',
              style: muted,
            ),
          ),
      ],
    );
  }

  Widget _step(BuildContext context, MovieMarkStep s) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final source = s.source.toJson();
    final outcome = flow.outcomes[source];
    final done = outcome?.ok ?? false;
    return _StepRow(
      source: source,
      picked: flow.picked.contains(source),
      enabled: !flow.saving && !done,
      onToggle: (on) => flow.toggle(source, on),
      outcome: outcome,
      children: [
        Wrap(
          spacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            SourceName(
              source,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            if (s.title != widget.title)
              Text(
                s.title,
                style: muted,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
          ],
        ),
        Text(s.summary, style: muted),
        if (source == 'mal')
          Text(
            'Start and finish date today, unless MAL has them',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        if (outcome != null && !outcome.ok)
          KeyedSubtree(
            key: ValueKey('error:$source'),
            child: errorLine(context, outcome.error ?? 'failed'),
          ),
        if (outcome?.ratingError != null)
          errorLine(
            context,
            'Marked, but the rating failed: ${outcome!.ratingError}',
          ),
      ],
    );
  }
}

/// "Add a movie", or with a row "Add to the other watchlists" (legacy `MovieAddModal.vue`).
class MovieAddSheet extends StatefulWidget {
  const MovieAddSheet({super.key, required this.flow});

  final MovieAddFlow flow;

  @override
  State<MovieAddSheet> createState() => _MovieAddSheetState();
}

class _MovieAddSheetState extends State<MovieAddSheet> {
  MovieAddFlow get flow => widget.flow;
  late final _query = TextEditingController(text: flow.query);
  final _sideQuery = {
    'trakt': TextEditingController(),
    'mal': TextEditingController(),
  };
  Timer? _timer;
  final _sideTimers = <String, Timer>{};

  @override
  void initState() {
    super.initState();
    if (flow.rowKey != null && flow.plan == null && !flow.planning) {
      flow.preview();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    for (final t in _sideTimers.values) {
      t.cancel();
    }
    _query.dispose();
    for (final c in _sideQuery.values) {
      c.dispose();
    }
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

  void _searchSide(String side) {
    _sideTimers.remove(side)?.cancel();
    flow.setSideQuery(side, _sideQuery[side]!.text);
    flow.searchSide(side);
  }

  void _typedSide(String side, String q) {
    flow.setSideQuery(side, q);
    _sideTimers.remove(side)?.cancel();
    _sideTimers[side] = Timer(searchDelay, () => _searchSide(side));
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: flow,
    builder: (context, _) {
      final plan = flow.plan;
      final pending = flow.pending;
      // Keep the side search fields in step with what the flow filled in (a title chip, the first title).
      for (final e in _sideQuery.entries) {
        final q = flow.sides[e.key]!.query;
        if (e.value.text != q) e.value.text = q;
      }
      return SheetFrame(
        title: flow.rowKey != null
            ? 'Add to the other watchlists'
            : 'Add a movie',
        subtitle: flow.rowKey != null ? flow.title : null,
        body: flow.previewing ? _preview(context) : _find(context),
        actions: [
          TextButton(
            key: const ValueKey('write-cancel'),
            onPressed: () => Navigator.of(context).pop(),
            child: Text(flow.allDone ? 'Close' : 'Cancel'),
          ),
          if (flow.previewing &&
              plan != null &&
              plan.steps.isNotEmpty &&
              !flow.allDone)
            FilledButton.icon(
              key: const ValueKey('write-confirm'),
              onPressed: flow.planning || flow.saving || pending.isEmpty
                  ? null
                  : _confirm,
              icon: _spinnerOr(
                flow.saving,
                flow.anyFailed ? Icons.refresh : Icons.add,
              ),
              label: Text(
                flow.anyFailed ? 'Retry' : 'Add on ${_sources(pending.length)}',
              ),
            ),
        ],
      );
    },
  );

  Widget _find(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final results = flow.results;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (flow.error != null) SheetAlert(text: flow.error!, error: true),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          key: const ValueKey('movie-from'),
          segments: const [
            ButtonSegment(
              value: 'tmdb',
              icon: Icon(Icons.movie_outlined),
              label: Text('Any movie'),
            ),
            ButtonSegment(
              value: 'anilist',
              icon: Icon(Icons.auto_awesome_outlined),
              label: Text('Anime movie'),
            ),
          ],
          selected: {flow.from},
          onSelectionChanged: (s) {
            _timer?.cancel();
            flow.query = _query.text;
            flow.setFrom(s.first);
          },
        ),
        const SizedBox(height: 8),
        Text.rich(
          TextSpan(
            style: muted,
            children: flow.from == 'tmdb'
                ? [
                    const TextSpan(text: 'Any movie, from '),
                    sourceSpan('tmdb', style: muted),
                    const TextSpan(text: '.'),
                  ]
                : [
                    const TextSpan(text: 'Anime movies, from '),
                    sourceSpan('anilist', style: muted),
                    const TextSpan(text: '; they can go on '),
                    sourceSpan('mal', style: muted),
                    const TextSpan(text: ' too.'),
                  ],
          ),
        ),
        const SizedBox(height: 8),
        _searchField(
          key: const ValueKey('movie-query'),
          controller: _query,
          hint: 'Title',
          busy: flow.searching,
          onSearch: _search,
          onTyped: _typed,
          autofocus: true,
        ),
        if (results != null) ...[
          const SizedBox(height: 8),
          if (results.isEmpty)
            Text('Nothing found.', style: muted)
          else
            for (final r in results) _resultRow(context, r),
        ],
      ],
    );
  }

  Widget _searchField({
    required Key key,
    required TextEditingController controller,
    required String hint,
    required bool busy,
    required VoidCallback onSearch,
    required ValueChanged<String> onTyped,
    bool autofocus = false,
  }) => Row(
    children: [
      Expanded(
        child: TextField(
          key: key,
          controller: controller,
          autofocus: autofocus,
          textInputAction: TextInputAction.search,
          onChanged: onTyped,
          onSubmitted: (_) => onSearch(),
          decoration: InputDecoration(
            hintText: hint,
            prefixIcon: const Icon(Icons.search),
            isDense: true,
            border: const OutlineInputBorder(),
          ),
        ),
      ),
      const SizedBox(width: 8),
      OutlinedButton(
        onPressed: busy ? null : onSearch,
        child: busy
            ? const SizedBox.square(
                dimension: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Text('Search'),
      ),
    ],
  );

  Widget _resultRow(BuildContext context, MovieChoice r) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final frame = Container(
      width: 40,
      height: 60,
      color: theme.colorScheme.surfaceContainerHighest,
    );
    return Padding(
      key: ValueKey('result:${r.id}'),
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            // Search posters are on TMDB / AniList: loaded without any headers.
            child: r.poster == null
                ? frame
                : CachedNetworkImage(
                    imageUrl: r.poster!,
                    width: 40,
                    height: 60,
                    fit: BoxFit.cover,
                    placeholder: (_, _) => frame,
                    errorWidget: (_, _, _) => frame,
                  ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _link(context, r.title, r.url),
                Wrap(
                  spacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (r.year != null) Text('${r.year}', style: muted),
                    if (r.detail != null) Text(r.detail!, style: muted),
                    if (r.listedOn.isNotEmpty)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('on ', style: muted),
                          for (final s in r.listedOn)
                            Padding(
                              padding: const EdgeInsets.only(right: 3),
                              child: Tooltip(
                                message: sourceLabel(s),
                                child: SourceIcon(s, size: 14),
                              ),
                            ),
                        ],
                      ),
                  ],
                ),
              ],
            ),
          ),
          FilledButton.tonal(
            key: ValueKey('pick:${r.id}'),
            onPressed: () => flow.pick(r),
            child: const Text('Pick'),
          ),
        ],
      ),
    );
  }

  Widget _link(BuildContext context, String text, String url) => InkWell(
    onTap: () => openUrl(url),
    child: Text(
      text,
      style: const TextStyle(
        fontWeight: FontWeight.w600,
        decoration: TextDecoration.underline,
        decorationStyle: TextDecorationStyle.dotted,
      ),
    ),
  );

  Widget _preview(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final plan = flow.plan;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (flow.rowKey == null)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              key: const ValueKey('movie-back'),
              onPressed: flow.saving ? null : flow.back,
              icon: const Icon(Icons.arrow_back, size: 16),
              label: const Text('Back to the results'),
            ),
          ),
        if (flow.error != null) SheetAlert(text: flow.error!, error: true),
        if (flow.planning)
          _loading()
        else if (plan != null) ...[
          const SizedBox(height: 4),
          Text(plan.title, style: theme.textTheme.titleMedium),
          if (plan.year != null || plan.anime)
            Text(
              [
                if (plan.year != null) '${plan.year!.toInt()}',
                if (plan.anime) 'Anime',
              ].join(' · '),
              style: muted,
            ),
          const SizedBox(height: 4),
          for (final s in plan.steps) _step(context, s),
          for (final s in plan.skipped)
            _skipped(context, s.source.toJson(), s.reason),
          if (plan.steps.isEmpty && !plan.traktSearch && !plan.malSearch)
            Text('Every source already has it.', style: muted),
          if (plan.traktSearch) _side(context, 'trakt'),
          if (plan.malSearch) _side(context, 'mal'),
        ],
      ],
    );
  }

  Widget _step(BuildContext context, MovieAddStep s) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final source = s.source.toJson();
    final outcome = flow.outcomes[source];
    return _StepRow(
      source: source,
      picked: flow.chosen.contains(source),
      enabled: !flow.saving && !(outcome?.ok ?? false),
      onToggle: (on) => flow.toggle(source, on),
      outcome: outcome,
      children: [
        SourceName(source, style: const TextStyle(fontWeight: FontWeight.w600)),
        Text(s.summary, style: muted),
        if (outcome != null && !outcome.ok)
          KeyedSubtree(
            key: ValueKey('error:$source'),
            child: errorLine(context, outcome.error ?? 'failed'),
          ),
      ],
    );
  }

  /// The Trakt movie or MAL entry, where none of your lists ties the movie to that source.
  Widget _side(BuildContext context, String side) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final s = flow.sides[side]!;
    if (!s.open) {
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            if (side == 'mal') Text('An anime movie?', style: muted),
            TextButton(
              key: ValueKey('side-open:$side'),
              onPressed: () => flow.openSide(side),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [const Text('Find it on '), SourceName(side)],
              ),
            ),
          ],
        ),
      );
    }
    final results = s.results;
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text.rich(
            TextSpan(
              style: muted,
              children: [
                const TextSpan(text: 'Which '),
                sourceSpan(side, style: muted),
                TextSpan(
                  text:
                      ' ${side == 'trakt' ? 'movie' : 'entry'} is it? Optional; it keeps the sources on one card.',
                ),
              ],
            ),
          ),
          if (flow.titles.length > 1)
            Wrap(
              spacing: 4,
              children: [
                for (final t in flow.titles)
                  ChoiceChip(
                    label: Text(t),
                    selected: t == s.query,
                    onSelected: (_) {
                      _sideTimers.remove(side)?.cancel();
                      flow.setSideQuery(side, t);
                      flow.searchSide(side);
                    },
                  ),
              ],
            ),
          const SizedBox(height: 8),
          _searchField(
            key: ValueKey('side-query:$side'),
            controller: _sideQuery[side]!,
            hint: side == 'trakt' ? 'Search Trakt' : 'Search AniList',
            busy: s.searching,
            onSearch: () => _searchSide(side),
            onTyped: (q) => _typedSide(side, q),
          ),
          if (results != null) ...[
            const SizedBox(height: 4),
            if (results.isEmpty)
              Text('Nothing found.', style: muted)
            else
              for (final c in results)
                Padding(
                  key: ValueKey('side-result:$side:${c.id}'),
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Wrap(
                          spacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            _link(context, c.title, c.url),
                            if (c.year != null)
                              Text(
                                '${c.year}',
                                style: theme.textTheme.bodySmall,
                              ),
                            if (c.onList)
                              Chip(
                                label: const Text('on your list'),
                                visualDensity: VisualDensity.compact,
                                labelStyle: theme.textTheme.labelSmall,
                              ),
                          ],
                        ),
                      ),
                      FilledButton.tonal(
                        key: ValueKey('side-pick:$side:${c.id}'),
                        onPressed: () => flow.pickSide(side, c),
                        child: const Text('Pick'),
                      ),
                    ],
                  ),
                ),
          ],
        ],
      ),
    );
  }
}
