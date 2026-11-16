import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../api/tsuzuku_api.dart';
import '../server/connection.dart';
import '../snapshot/snapshot.dart';
import '../snapshot/snapshot_notice.dart';
import '../writes/coming_back.dart';
import '../writes/write_flows.dart';
import '../writes/write_sheets.dart';
import 'format.dart';
import 'poster.dart';
import 'source_ui.dart';
import 'up_next_card.dart';
import 'up_next_logic.dart';
import '../theme/solid_glass.dart';

/// Up Next (#108, step 3.4): every show you are watching, each source with its own progress.
/// Differences are flagged and left for you; no source is treated as correct. A failing or blocked
/// source only marks its own chip and cells: the rest of the screen stays.
class UpNextView extends StatefulWidget {
  const UpNextView({
    super.key,
    required this.load,
    this.posters,
    this.actions = const UpNextActions(),
    this.clock = DateTime.now,
    this.searchOpen = false,
    this.api,
    this.onOpenMappings,
    this.snapshots,
    this.offline = false,
  });

  /// The saved Up Next, shown until the live one arrives (#108, 3.7); none when null.
  final SnapshotCache? snapshots;

  /// The server cannot be reached: read-only.
  final bool offline;

  /// Opens Mappings (the "links wait for your confirm" notice).
  final VoidCallback? onOpenMappings;

  /// The server's API for the writes (step 3.5). Null: read-only, [actions] as given.
  final TsuzukuApi? api;

  /// Fetches `/api/up-next`.
  final Future<UpNext> Function() load;
  final PosterSource? posters;
  final UpNextActions actions;
  final DateTime Function() clock;

  /// The filter bar is open (the app bar's Search button).
  final bool searchOpen;

  @override
  State<UpNextView> createState() => UpNextViewState();
}

class UpNextViewState extends State<UpNextView> {
  UpNext? _data;
  DateTime? _receivedAt;

  /// The fetch time of the shown list while it is the saved one; null once the live list is in.
  DateTime? _savedAt;
  Object? _error;
  bool _loading = false;
  UpNextFilter _filter = const UpNextFilter();
  bool? _showCaughtUp;
  final _expanded = <String>{};
  late DateTime _now = widget.clock();
  Timer? _tick;
  ComingBackController? _comingBack;

  @override
  void initState() {
    super.initState();
    final api = widget.api;
    if (api != null) {
      _comingBack = ComingBackController(api)..addListener(_changed);
    }
    // Relative times and rate-limit countdowns stay current.
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      final now = widget.clock();
      final countdown = _health.any(
        (h) => h.blockedUntil?.isAfter(now) ?? false,
      );
      if (countdown || now.minute != _now.minute) setState(() => _now = now);
    });
    _showSaved();
    reload();
  }

  /// Shows the saved list at once, unless the live one is already in.
  Future<void> _showSaved() async {
    final saved = await widget.snapshots?.read(SnapshotKey.upNext);
    if (saved == null || !mounted || _data != null) return;
    try {
      final data = UpNext.fromJson(saved.json);
      setState(() {
        _data = data;
        _receivedAt = saved.fetchedAt;
        _savedAt = saved.fetchedAt;
      });
    } catch (_) {
      // Unreadable: wait for the live list.
    }
  }

  /// Writes need the live list and the server.
  bool get _readOnly => widget.offline || _savedAt != null;

  @override
  void didUpdateWidget(UpNextView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.searchOpen && !widget.searchOpen) {
      _filter = const UpNextFilter();
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    _comingBack
      ?..removeListener(_changed)
      ..dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  UpNextActions get _actions {
    if (widget.api == null) return widget.actions;
    if (_readOnly) return const UpNextActions();
    return UpNextActions(
      mark: _mark,
      setAccepted: _setAccepted,
      startSeason: (row, search) =>
          _start(rowKey: row.key, title: row.title, search: search),
      startSequel: (row, malId) =>
          _start(rowKey: row.key, title: row.title, search: true, malId: malId),
      sequelsFor: (row) => row.start.search && _comingBack != null
          ? sequelsForShow(row.title, _comingBack!.shown)
          : const [],
    );
  }

  /// "Mark watched": the preview sheet; the list reloads when something was written or the
  /// preview found the row had moved.
  Future<void> _mark(UpRow row, String? source) async {
    final flow = MarkFlow(
      api: widget.api!,
      rowKey: row.key,
      source: source,
      signature: row.signature,
      clock: widget.clock,
    );
    await showWriteSheet(
      context,
      MarkSheet(flow: flow, title: row.title, clock: widget.clock),
    );
    if (flow.wrote || flow.stale) await reload();
    flow.dispose();
  }

  /// "Start next season", from a card or a Coming back sequel.
  Future<void> _start({
    required String rowKey,
    required String title,
    required bool search,
    int? malId,
  }) async {
    final flow = StartFlow(
      api: widget.api!,
      rowKey: rowKey,
      title: title,
      search: search,
      malId: malId,
    );
    await showWriteSheet(context, StartSeasonSheet(flow: flow));
    if (flow.wrote) {
      await reload();
      if (_comingBack?.data != null) await _comingBack!.load();
    }
    flow.dispose();
  }

  /// "Accept this difference" / undo: stored on the server only, no source is written. The row is
  /// updated here instead of fetching every source again (as legacy does).
  Future<void> _setAccepted(UpRow row, bool accepted) async {
    final api = widget.api!;
    try {
      if (accepted) {
        await api.upNext.postUpNextAccept(
          body: PostUpNextAcceptRequest(
            rowKey: row.key,
            signature: row.signature,
          ),
        );
      } else {
        await api.upNext.postUpNextUndoAccept(
          body: PostUpNextUndoAcceptRequest(rowKey: row.key),
        );
      }
      final data = _data;
      if (!mounted || data == null) return;
      final json = data.toJson();
      for (final r in json['rows'] as List) {
        if (r is Map && r['key'] == row.key) r['accepted'] = accepted;
      }
      setState(() => _data = UpNext.fromJson(jsonRoundTrip(json)));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        SnackBar(content: Text('Could not save: ${writeErrorText(e)}')),
      );
    }
  }

  bool get loading => _loading;

  /// Loads the list again; the last one stays on screen meanwhile.
  Future<void> reload() async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      final data = await widget.load();
      if (!mounted) return;
      final receivedAt = widget.clock();
      setState(() {
        _data = data;
        _receivedAt = receivedAt;
        _savedAt = null;
        _now = receivedAt;
        _error = null;
      });
      widget.snapshots?.write(SnapshotKey.upNext, data.toJson(), receivedAt);
      // Cards for a show nothing links offer its Coming back sequel: asked only when such a row exists.
      if (data.rows.any((r) => r.start.search)) _comingBack?.ensure();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<SourceHealth> get _health =>
      _data == null ? const [] : sourceHealth(_data!, _receivedAt ?? _now);

  void _toggle(String key) => setState(
    () => _expanded.contains(key) ? _expanded.remove(key) : _expanded.add(key),
  );

  @override
  Widget build(BuildContext context) {
    final data = _data;
    if (data == null) {
      if (_error != null) {
        return ErrorState(error: _error!, onRetry: reload);
      }
      return const Center(child: CircularProgressIndicator());
    }
    final width = MediaQuery.sizeOf(context).width;
    final columns = width >= 1400
        ? 3
        : width >= 840
        ? 2
        : 1;
    final wide = columns > 1;
    final all = data.rows;
    final rows = all.where((r) => matchesFilter(r, _filter)).toList();
    final sections = UpNextSections(rows);
    final allSections = UpNextSections(all);
    final caughtUpOpen =
        _showCaughtUp ??
        (_filter.q.trim().isNotEmpty && sections.caughtUp.isNotEmpty);
    final pad = EdgeInsets.symmetric(
      horizontal: sidePadding(width, wide: wide),
    );
    final health = _health;
    final problems = [
      for (final h in health)
        if (!h.ok) h,
    ];
    final healthy = [
      for (final h in health)
        if (h.ok) h,
    ];

    String? emptyText(int total) => _filter.active && total > 0
        ? 'No matches · $total hidden by the filter.'
        : null;

    List<Widget> section(
      String title,
      String hint,
      List<UpRow> list,
      int total,
    ) => [
      SliverPadding(
        padding: pad.copyWith(top: 20, bottom: 8),
        sliver: SliverToBoxAdapter(
          child: _SectionTitle(title: title, hint: hint),
        ),
      ),
      _cards(list, columns, wide, pad, emptyText(total)),
    ];

    return RefreshIndicator(
      onRefresh: reload,
      child: CustomScrollView(
        key: const PageStorageKey('up-next'),
        slivers: [
          SliverToBoxAdapter(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 150),
              child: _loading
                  ? const LinearProgressIndicator(minHeight: 2)
                  : const SizedBox(height: 2),
            ),
          ),
          SliverPadding(
            padding: pad.copyWith(top: 8),
            sliver: SliverList.list(
              children: [
                // Only sources that need attention stay on top (legacy #94); the rest are at the bottom.
                if (problems.isNotEmpty)
                  SourceStrip(health: problems, now: _now),
                if (SnapshotNotice.shows(
                  savedAt: _savedAt,
                  offline: widget.offline,
                ))
                  SnapshotNotice(
                    savedAt: _savedAt,
                    offline: widget.offline,
                    now: _now,
                    error: _error,
                  )
                else if (_error != null)
                  Notice(
                    icon: Icons.cloud_off,
                    text:
                        'Could not refresh: ${describeError(_error!)}. '
                        'Showing the last list.',
                    warning: true,
                  ),
                if (data.errors.isNotEmpty)
                  Notice(
                    icon: Icons.error_outline,
                    warning: true,
                    title: 'Some list items could not be read',
                    spans: [
                      for (final (i, e) in data.errors.indexed) ...[
                        if (i > 0) const TextSpan(text: ' · '),
                        sourceSpan(e.source.toJson()),
                        TextSpan(text: ': ${e.error}'),
                      ],
                    ],
                  ),
                if (data.proposals > 0)
                  InkWell(
                    onTap: widget.onOpenMappings,
                    child: Notice(
                      key: const ValueKey('proposals'),
                      icon: Icons.link,
                      title:
                          '${data.proposals.toInt()} ${data.proposals == 1 ? 'link waits' : 'links wait'} for your confirm',
                      text: 'on Mappings',
                    ),
                  ),
                if (widget.searchOpen)
                  FilterBar(
                    filter: _filter,
                    shown: rows.length,
                    total: all.length,
                    onChanged: (f) => setState(() {
                      if (f.q != _filter.q && _showCaughtUp == false) {
                        _showCaughtUp = null;
                      }
                      _filter = f;
                    }),
                  ),
              ],
            ),
          ),
          ...section(
            'Next to watch',
            "In Trakt's order.",
            sections.nextToWatch,
            allSections.nextToWatch.length,
          ),
          ...section(
            'Not in Trakt up next',
            'On Simkl or MAL with something to watch, by last activity.',
            sections.notOnTrakt,
            allSections.notOnTrakt.length,
          ),
          if (_comingBack != null)
            SliverPadding(
              padding: pad.copyWith(top: 16),
              sliver: SliverToBoxAdapter(
                child: ComingBackSection(
                  controller: _comingBack!,
                  now: _now,
                  posters: widget.posters,
                  wide: wide,
                  onStart: (q) => _start(
                    rowKey: 'coming:${q.malId.toInt()}',
                    title: q.title,
                    search: false,
                    malId: q.malId.toInt(),
                  ),
                ),
              ),
            ),
          if (allSections.caughtUp.isNotEmpty) ...[
            SliverPadding(
              padding: pad.copyWith(top: 16, bottom: 8),
              sliver: SliverToBoxAdapter(
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    key: const ValueKey('caught-up-toggle'),
                    onPressed: () =>
                        setState(() => _showCaughtUp = !caughtUpOpen),
                    icon: Icon(
                      caughtUpOpen ? Icons.expand_more : Icons.chevron_right,
                    ),
                    label: Text(
                      '${caughtUpOpen ? 'Hide' : 'Show'} caught up '
                      '(${_filter.active ? '${sections.caughtUp.length} of ${allSections.caughtUp.length}' : sections.caughtUp.length})',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                ),
              ),
            ),
            if (caughtUpOpen)
              _cards(
                sections.caughtUp,
                columns,
                wide,
                pad,
                emptyText(allSections.caughtUp.length),
              ),
          ],
          SliverPadding(
            padding: pad.copyWith(
              top: 24,
              bottom: 32 + MediaQuery.paddingOf(context).bottom,
            ),
            sliver: SliverList.list(
              children: [
                Text(
                  summary(all),
                  key: const ValueKey('summary'),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
                if (healthy.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  SourceStrip(health: healthy, now: _now),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// One lazy list per section on phones; on wide screens, [columns] masonry columns.
  Widget _cards(
    List<UpRow> rows,
    int columns,
    bool wide,
    EdgeInsets pad,
    String? empty,
  ) {
    if (rows.isEmpty) {
      return SliverPadding(
        padding: pad,
        sliver: SliverToBoxAdapter(
          child: Notice(
            icon: Icons.inbox_outlined,
            text: empty ?? 'Nothing here.',
          ),
        ),
      );
    }
    Widget card(UpRow r) => UpNextCard(
      row: r,
      now: _now,
      expanded: _expanded.contains(r.key),
      onToggle: () => _toggle(r.key),
      posters: widget.posters,
      actions: _actions,
      wide: wide,
    );
    if (columns == 1) {
      return SliverPadding(
        padding: pad,
        sliver: SliverList.builder(
          itemCount: rows.length,
          itemBuilder: (context, i) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: card(rows[i]),
          ),
        ),
      );
    }
    // Masonry (legacy `MasonryGrid`): cards dealt round-robin (1, 2, 3 across, then 4, 5, 6) into
    // columns that stack on their own, so opening a card pushes down only the cards under it in its
    // column, and a card never moves to another column.
    return SliverPadding(
      padding: pad,
      sliver: SliverToBoxAdapter(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var c = 0; c < columns; c++) ...[
              if (c > 0) const SizedBox(width: 12),
              Expanded(
                child: Column(
                  children: [
                    for (var i = c; i < rows.length; i += columns)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: card(rows[i]),
                      ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, required this.hint});

  final String title;
  final String hint;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // One paragraph, so title and hint share a baseline and wrap together.
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: title,
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const TextSpan(text: '  '),
          TextSpan(
            text: hint,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

/// Each source's fetch: status, stale, when it was fetched, and the rate-limit countdown.
class SourceStrip extends StatelessWidget {
  const SourceStrip({super.key, required this.health, required this.now});

  final List<SourceHealth> health;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Wrap(
      spacing: 8,
      runSpacing: 6,
      children: [
        for (final h in health)
          Builder(
            builder: (context) {
              final blockedFor = h.blockedUntil?.difference(now);
              final parts = [
                if (h.status == 'rate_limited' &&
                    blockedFor != null &&
                    !blockedFor.isNegative)
                  'rate limited ${countdown(blockedFor)}'
                else if (!h.ok || h.status != 'ok')
                  h.statusLabel,
                if (h.stale) 'stale',
                if (h.fetchedAt != null)
                  'fetched ${relativeTo(h.fetchedAt!, now)}'
                else
                  'never fetched',
              ];
              final problem = h.status != 'ok';
              final color = problem
                  ? (h.status == 'rate_limited'
                        ? Glass.of(context).warning
                        : theme.colorScheme.error)
                  : h.stale
                  ? theme.colorScheme.onSurfaceVariant
                  : theme.colorScheme.onSurfaceVariant;
              return Tooltip(
                message: [
                  if (h.fetchedAt != null) 'Fetched ${h.fetchedAt!.toLocal()}',
                  ?h.error,
                ].join(' · '),
                child: Container(
                  key: ValueKey('health:${h.source}'),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: problem ? color : theme.colorScheme.outlineVariant,
                    ),
                  ),
                  child: DefaultTextStyle.merge(
                    style: TextStyle(fontSize: 12, color: color),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SourceName(
                          h.source,
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: theme.colorScheme.onSurface,
                          ),
                        ),
                        if (h.ok) ...[
                          const SizedBox(width: 4),
                          Icon(
                            Icons.check_circle,
                            size: 13,
                            color: Glass.of(context).success,
                          ),
                        ],
                        const SizedBox(width: 6),
                        Flexible(child: Text(parts.join(' · '))),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
      ],
    );
  }
}

/// The filter bar (#68): title search over every source's titles, chips, anime or shows.
class FilterBar extends StatefulWidget {
  const FilterBar({
    super.key,
    required this.filter,
    required this.shown,
    required this.total,
    required this.onChanged,
  });

  final UpNextFilter filter;
  final int shown;
  final int total;
  final ValueChanged<UpNextFilter> onChanged;

  @override
  State<FilterBar> createState() => _FilterBarState();
}

class _FilterBarState extends State<FilterBar> {
  late final _text = TextEditingController(text: widget.filter.q);

  @override
  void didUpdateWidget(FilterBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.filter.q != _text.text) _text.text = widget.filter.q;
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  static const _chips = {
    UpNextChip.differs: 'Differs',
    UpNextChip.unmapped: 'Unmapped',
    UpNextChip.next: 'Has next episode',
  };

  @override
  Widget build(BuildContext context) {
    final f = widget.filter;
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            key: const ValueKey('filter-q'),
            controller: _text,
            autofocus: true,
            decoration: InputDecoration(
              isDense: true,
              prefixIcon: const Icon(Icons.search),
              hintText: 'Search titles',
              border: const OutlineInputBorder(),
              suffixIcon: f.q.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Clear search',
                      icon: const Icon(Icons.close),
                      onPressed: () => widget.onChanged(f.copyWith(q: '')),
                    ),
            ),
            onChanged: (q) => widget.onChanged(f.copyWith(q: q)),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final MapEntry(key: chip, value: label) in _chips.entries)
                FilterChipButton(
                  label: label,
                  selected: f.only.contains(chip),
                  onSelected: (on) => widget.onChanged(
                    f.copyWith(
                      only: on
                          ? {...f.only, chip}
                          : ({...f.only}..remove(chip)),
                    ),
                  ),
                ),
              for (final (kind, label) in const [
                ('anime', 'Anime'),
                ('show', 'Shows'),
              ])
                FilterChipButton(
                  label: label,
                  selected: f.kind == kind,
                  onSelected: (on) => widget.onChanged(
                    f.copyWith(kind: () => on ? kind : null),
                  ),
                ),
            ],
          ),
          if (f.active)
            Row(
              children: [
                Text(
                  'Showing ${widget.shown} of ${widget.total}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                TextButton(
                  onPressed: () => widget.onChanged(const UpNextFilter()),
                  child: const Text('Clear filters'),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

/// A toggle chip in the filter bar.
class FilterChipButton extends StatelessWidget {
  const FilterChipButton({
    super.key,
    required this.label,
    required this.selected,
    required this.onSelected,
  });

  final String label;
  final bool selected;
  final ValueChanged<bool> onSelected;

  @override
  Widget build(BuildContext context) => ChoiceChip(
    label: Text(label),
    selected: selected,
    onSelected: onSelected,
    visualDensity: VisualDensity.compact,
  );
}

class Notice extends StatelessWidget {
  const Notice({
    super.key,
    required this.icon,
    this.title,
    this.text,
    this.spans,
    this.warning = false,
  });

  final IconData icon;
  final String? title;
  final String? text;
  final List<InlineSpan>? spans;
  final bool warning;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final tint = warning ? Glass.of(context).warning : scheme.primary;
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: tint.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: tint),
          const SizedBox(width: 10),
          Expanded(
            child: Text.rich(
              TextSpan(
                style: theme.textTheme.bodyMedium,
                children: [
                  if (title != null)
                    TextSpan(
                      text: title,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  if (title != null && (text != null || spans != null))
                    const TextSpan(text: ' '),
                  if (text != null)
                    TextSpan(
                      text: text,
                      style: TextStyle(color: scheme.onSurfaceVariant),
                    ),
                  ...?spans,
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(describeError(error), textAlign: TextAlign.center),
          const SizedBox(height: 12),
          FilledButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    ),
  );
}

/// A model's JSON as plain maps and lists, to change a field and decode it again.
Map<String, Object?> jsonRoundTrip(Map<String, Object?> json) =>
    (jsonDecode(jsonEncode(json)) as Map).cast<String, Object?>();
