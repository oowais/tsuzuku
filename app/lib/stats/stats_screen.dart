import 'package:flutter/material.dart';

import '../api/tsuzuku_api.dart';
import '../up_next/format.dart' show relativeTo, sidePadding;
import '../up_next/source_ui.dart';
import '../up_next/up_next_card.dart' show Tag, TagTone;
import '../up_next/up_next_screen.dart' show ErrorState, Notice;
import '../server/connection.dart';
import '../snapshot/snapshot.dart';
import '../snapshot/snapshot_notice.dart';
import '../theme/status_colors.dart';
import 'stats_logic.dart';
import '../theme/solid_glass.dart';
import '../screens/app_title.dart';

// Stats (#108, step 3.6; legacy `pages/stats.vue`, `StatusBar.vue`, `RatingsChart.vue`, `MarksChart.vue`): each
// source's own numbers side by side, never added up. Source stats are kept on the server for 12 hours; Refresh asks
// the sources again.

/// Content width from which the cards sit three across.
const statsWideWidth = 1000.0;

class StatsScreen extends StatefulWidget {
  const StatsScreen({
    super.key,
    required this.api,
    this.clock = DateTime.now,
    this.snapshots,
    this.offline = false,
  });

  final TsuzukuApi api;
  final DateTime Function() clock;

  /// The saved stats, shown until the live ones arrive (#108, 3.7).
  final SnapshotCache? snapshots;

  /// The server cannot be reached.
  final bool offline;

  @override
  State<StatsScreen> createState() => _StatsScreenState();
}

class _StatsScreenState extends State<StatsScreen> {
  GetStatsResponse200? _data;
  Object? _error;
  bool _loading = false;

  /// The fetch time of the shown stats while they are the saved ones; null once the live ones are in.
  DateTime? _savedAt;

  @override
  void initState() {
    super.initState();
    _showSaved();
    _load(refresh: false);
  }

  /// Shows the saved stats at once, unless the live ones are already in.
  Future<void> _showSaved() async {
    final saved = await widget.snapshots?.read(SnapshotKey.stats);
    if (saved == null || !mounted || _data != null) return;
    try {
      final data = GetStatsResponse200.fromJson(saved.json);
      setState(() {
        _data = data;
        _savedAt = saved.fetchedAt;
      });
    } catch (_) {
      // Unreadable: wait for the live stats.
    }
  }

  Future<void> _load({required bool refresh}) async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      final d = await widget.api.stats.getStats(
        refresh: refresh ? GetStatsRefresh.fromJson('1') : null,
      );
      if (mounted) {
        setState(() {
          _data = d;
          _savedAt = null;
          _error = null;
        });
        widget.snapshots?.write(SnapshotKey.stats, d.toJson(), widget.clock());
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const AppTitle('Stats'),
      actions: [
        IconButton(
          key: const ValueKey('stats-refresh'),
          onPressed: _loading ? null : () => _load(refresh: true),
          icon: const Icon(Icons.refresh),
          tooltip: 'Refresh',
        ),
      ],
    ),
    body: LayoutBuilder(
      builder: (context, box) => _body(context, box.maxWidth),
    ),
  );

  Widget _body(BuildContext context, double width) {
    final d = _data;
    if (d == null) {
      if (_error != null) {
        return ErrorState(error: _error!, onRetry: () => _load(refresh: false));
      }
      return const Center(child: CircularProgressIndicator());
    }
    final theme = Theme.of(context);
    final wide = width >= statsWideWidth;
    final pad = EdgeInsets.symmetric(
      horizontal: sidePadding(width, wide: wide),
    );
    final now = widget.clock();
    Widget grid(List<Widget> cards) {
      if (!wide) {
        return Column(
          children: [
            for (final c in cards)
              Padding(padding: const EdgeInsets.only(bottom: 12), child: c),
          ],
        );
      }
      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final (i, c) in cards.indexed) ...[
            if (i > 0) const SizedBox(width: 12),
            Expanded(child: c),
          ],
        ],
      );
    }

    return RefreshIndicator(
      onRefresh: () => _load(refresh: true),
      child: ListView(
        key: const PageStorageKey('stats'),
        padding: pad.copyWith(
          bottom: 32 + MediaQuery.paddingOf(context).bottom,
        ),
        children: [
          SizedBox(
            height: 2,
            child: _loading
                ? const LinearProgressIndicator(minHeight: 2)
                : null,
          ),
          const SizedBox(height: 8),
          Text(
            "Each source's own numbers. They count differently, so they are never added up.",
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          if (SnapshotNotice.shows(savedAt: _savedAt, offline: widget.offline))
            SnapshotNotice(
              savedAt: _savedAt,
              offline: widget.offline,
              now: now,
              error: _error,
            )
          else if (_error != null)
            Notice(
              icon: Icons.cloud_off,
              warning: true,
              text: 'Could not refresh: ${describeError(_error!)}.',
            ),
          const SizedBox(height: 12),
          grid([for (final s in d.sources) _SourceCard(stats: s, now: now)]),
          Padding(
            padding: const EdgeInsets.only(top: 12, bottom: 8),
            child: Text(
              'Marked from Tsuzuku',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          grid([for (final w in d.writes) _MarksCard(writes: w, now: now)]),
        ],
      ),
    );
  }
}

class _Frame extends StatelessWidget {
  const _Frame({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => PaneCard(
    padding: const EdgeInsets.all(14),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    ),
  );
}

/// Small figure tiles in a wrapping grid.
class _Tiles extends StatelessWidget {
  const _Tiles({required this.items, this.big = true});

  final List<({String label, String value, String? hint})> items;
  final bool big;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return LayoutBuilder(
      builder: (context, box) {
        const minWidth = 112.0;
        final perRow = (box.maxWidth / (minWidth + 8)).floor().clamp(
          1,
          items.length,
        );
        final w = (box.maxWidth - 8 * (perRow - 1)) / perRow;
        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final f in items)
              Container(
                width: w,
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest.withValues(
                    alpha: 0.5,
                  ),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      f.label,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(
                        f.value,
                        style:
                            (big
                                    ? theme.textTheme.titleLarge
                                    : theme.textTheme.titleMedium)
                                ?.copyWith(
                                  fontWeight: FontWeight.w700,
                                  fontFeatures: const [
                                    FontFeature.tabularFigures(),
                                  ],
                                ),
                      ),
                    ),
                    if (f.hint != null)
                      Text(
                        f.hint!,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                  ],
                ),
              ),
          ],
        );
      },
    );
  }
}

Widget _subhead(BuildContext context, String text, {String? trailing}) {
  final theme = Theme.of(context);
  return Padding(
    padding: const EdgeInsets.only(top: 14, bottom: 6),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Text(
            text,
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        if (trailing != null)
          Text(
            trailing,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
      ],
    ),
  );
}

class _SourceCard extends StatelessWidget {
  const _SourceCard({required this.stats, required this.now});

  final SourceStats stats;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final s = stats;
    final source = s.source.toJson();
    final history = historyFigures(s.history?.recent, now);
    return _Frame(
      key: ValueKey('stats:$source'),
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 8,
          runSpacing: 4,
          children: [
            SourceName(
              source,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (s.stale) ...[
                  const Tag('stale', tone: TagTone.outline),
                  const SizedBox(width: 6),
                ],
                if (s.fetchedAt != null)
                  Text(
                    'updated ${relativeTo(s.fetchedAt!, now)}',
                    style: muted,
                  ),
              ],
            ),
          ],
        ),
        if (s.note != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(s.note!, style: muted),
          ),
        if (s.error != null)
          Notice(
            icon: Icons.error_outline,
            warning: s.headline.isEmpty,
            text: s.headline.isNotEmpty
                ? 'Showing earlier numbers: ${s.error}'
                : s.error,
          )
        else if (s.headline.isEmpty && s.breakdowns.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'No figures in the answer.',
              style: theme.textTheme.bodyMedium,
            ),
          ),
        if (s.headline.isNotEmpty) ...[
          const SizedBox(height: 12),
          _Tiles(
            items: [
              for (final f in s.headline)
                (label: f.label, value: showFigure(f), hint: null),
            ],
          ),
        ],
        for (final b in s.breakdowns) ...[
          _subhead(
            context,
            b.title,
            trailing: '${formatNumber(breakdownTotal(b))} on your lists',
          ),
          StatusBar(parts: b.parts),
        ],
        if (history != null) ...[
          _subhead(context, 'Your history'),
          _Tiles(
            big: false,
            items: [
              (
                label: 'This week',
                value: formatNumber(history.week),
                hint: null,
              ),
              (
                label: 'This month',
                value: formatNumber(history.month),
                hint: null,
              ),
              (
                label: 'Weekly average',
                value: formatNumber(history.weeklyAverage),
                hint: 'Over the last 4 weeks',
              ),
            ],
          ),
        ],
        if (s.ratings != null) ...[
          _subhead(context, 'Your ratings'),
          RatingsChart(counts: s.ratings!),
        ],
        if (s.more.isNotEmpty) ...[
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 10),
          LayoutBuilder(
            builder: (context, box) => Wrap(
              runSpacing: 8,
              children: [
                for (final f in s.more)
                  SizedBox(
                    width: box.maxWidth / 2,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(f.label, style: muted),
                        Text(
                          showFigure(f),
                          style: theme.textTheme.bodyMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// How a list splits by status: one stacked bar, and a legend with each status and its count (legacy `StatusBar`).
class StatusBar extends StatelessWidget {
  const StatusBar({super.key, required this.parts});

  final List<BreakdownPartsItem> parts;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = StatusColors.of(context);
    final total = parts.fold<num>(0, (n, p) => n + p.value);
    final shown = [
      for (final p in parts)
        if (p.value > 0) p,
    ];
    String pct(num v) => total == 0 ? '0' : '${(v / total * 100).round()}';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (total > 0)
          Semantics(
            label: shown.map((p) => '${p.label} ${p.value.toInt()}').join(', '),
            excludeSemantics: true,
            child: SizedBox(
              height: 12,
              child: Row(
                children: [
                  for (final (i, p) in shown.indexed) ...[
                    if (i > 0) const SizedBox(width: 2),
                    Expanded(
                      flex: (p.value * 1000 ~/ total).clamp(1, 1000),
                      child: Tooltip(
                        message:
                            '${p.value.toInt()} ${p.label.toLowerCase()} · ${pct(p.value)}%',
                        triggerMode: TooltipTriggerMode.tap,
                        child: Container(
                          decoration: BoxDecoration(
                            color: colors.forKey(p.key.toJson()),
                            borderRadius: BorderRadius.horizontal(
                              left: Radius.circular(i == 0 ? 4 : 0),
                              right: Radius.circular(
                                i == shown.length - 1 ? 4 : 0,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 12,
          runSpacing: 4,
          children: [
            for (final p in parts)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      color: colors.forKey(p.key.toJson()),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  const SizedBox(width: 5),
                  Text(
                    p.label,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    formatNumber(p.value),
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
          ],
        ),
      ],
    );
  }
}

/// Columns of one hue: each value as a share of the largest, a tap shows its text.
class _Columns extends StatelessWidget {
  const _Columns({
    required this.values,
    required this.tips,
    required this.height,
    this.minFraction = 0.04,
    this.topLabel,
  });

  final List<num> values;
  final List<String> tips;
  final double height;
  final double minFraction;

  /// The column to label with its value (the busiest score).
  final int? topLabel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = StatusColors.of(context).chart;
    final max = values.fold<num>(1, (m, v) => v > m ? v : m);
    return SizedBox(
      height: height,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          for (final (i, v) in values.indexed) ...[
            if (i > 0) const SizedBox(width: 2),
            Expanded(
              child: Tooltip(
                message: tips[i],
                triggerMode: TooltipTriggerMode.tap,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    if (i == topLabel && v > 0)
                      Text(
                        formatNumber(v),
                        style: theme.textTheme.labelSmall?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    Container(
                      height: v == 0
                          ? 0
                          : (height - 16) * (v / max).clamp(minFraction, 1.0),
                      decoration: BoxDecoration(
                        color: color,
                        borderRadius: const BorderRadius.vertical(
                          top: Radius.circular(3),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Ratings of 1 to 10 you gave (legacy `RatingsChart`).
class RatingsChart extends StatelessWidget {
  const RatingsChart({super.key, required this.counts});

  final List<num> counts;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final max = counts.fold<num>(0, (m, v) => v > m ? v : m);
    final top = counts.indexOf(max);
    return Semantics(
      label: [for (final (i, c) in counts.indexed) '${i + 1}: ${c.toInt()}']
          .join(', '),
      excludeSemantics: true,
      child: Column(
        children: [
          _Columns(
            values: counts,
            tips: [
              for (final (i, c) in counts.indexed)
                '${c.toInt()} rated ${i + 1}',
            ],
            height: 112,
            topLabel: top,
          ),
          const Divider(height: 1),
          const SizedBox(height: 3),
          Row(
            children: [
              for (var i = 0; i < counts.length; i++)
                Expanded(
                  child: Text(
                    '${i + 1}',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MarksCard extends StatelessWidget {
  const _MarksCard({required this.writes, required this.now});

  final GetStatsResponse200WritesItem writes;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final w = writes;
    final source = w.source.toJson();
    final days = marksByDay(w.recent, now);
    String describe(int i) {
      final d = days[i];
      return '${daysAgo(i)}: ${d.ok} ${d.ok == 1 ? 'mark' : 'marks'}'
          '${d.failed > 0 ? ', ${d.failed} failed' : ''}';
    }

    return _Frame(
      key: ValueKey('marks:$source'),
      children: [
        Row(
          children: [
            Expanded(child: SourceName(source)),
            if (w.failed > 0)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.error_outline,
                    size: 14,
                    color: theme.colorScheme.error,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    '${w.failed.toInt()} failed',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.error,
                    ),
                  ),
                ],
              )
            else
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.check_circle_outline,
                    size: 14,
                    color: muted?.color,
                  ),
                  const SizedBox(width: 4),
                  Text('No failures', style: muted),
                ],
              ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${w.month.toInt()}',
                    style: theme.textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      height: 1,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text('marks in 30 days', style: muted),
                ],
              ),
            ),
            for (final (label, v) in [('7 days', w.week), ('Year', w.year)])
              Padding(
                padding: const EdgeInsets.only(left: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(label, style: muted),
                    Text(
                      '${v.toInt()}',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
        const SizedBox(height: 12),
        if (w.year > 0)
          Semantics(
            label: [for (var i = 0; i < days.length; i++) describe(i)]
                .join('; '),
            excludeSemantics: true,
            child: Column(
              children: [
                _Columns(
                  values: [for (final d in days) d.ok],
                  tips: [for (var i = 0; i < days.length; i++) describe(i)],
                  height: 64,
                  minFraction: 0.08,
                ),
                const Divider(height: 1),
                // A day with a failed mark gets a dot under its column.
                SizedBox(
                  height: 12,
                  child: Row(
                    children: [
                      for (var i = 0; i < days.length; i++) ...[
                        if (i > 0) const SizedBox(width: 2),
                        Expanded(
                          child: Center(
                            child: days[i].failed > 0
                                ? Container(
                                    key: ValueKey('failed-dot:$source:$i'),
                                    width: 6,
                                    height: 6,
                                    decoration: BoxDecoration(
                                      color: theme.colorScheme.error,
                                      shape: BoxShape.circle,
                                    ),
                                  )
                                : null,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('30 days ago', style: muted),
                    Text('today', style: muted),
                  ],
                ),
              ],
            ),
          )
        else
          Text('No marks from Tsuzuku yet.', style: theme.textTheme.bodyMedium),
      ],
    );
  }
}
