import 'package:flutter/material.dart';

import '../api/tsuzuku_api.dart';
import '../server/connection.dart';
import '../snapshot/snapshot.dart';
import '../snapshot/snapshot_notice.dart';
import '../up_next/format.dart';
import '../up_next/source_ui.dart';
import '../up_next/up_next_card.dart' show openUrl;
import '../up_next/up_next_screen.dart' show Notice;
import 'calendar_logic.dart';
import '../screens/app_title.dart';

// Calendar (#108, step 3.6; legacy `pages/calendar.vue`): last month, this month and next. A month grid on wide
// screens, an agenda of the days with episodes on narrow ones. Read-only: every item opens its source's page.

/// Width of the content from which the month shows as a grid.
const calendarGridWidth = 1000.0;

class CalendarScreen extends StatefulWidget {
  const CalendarScreen({
    super.key,
    required this.api,
    this.clock = DateTime.now,
    this.snapshots,
    this.offline = false,
  });

  final TsuzukuApi api;
  final DateTime Function() clock;

  /// The saved month shown on open (this month), until the live one arrives (#108, 3.7).
  final SnapshotCache? snapshots;

  /// The server cannot be reached.
  final bool offline;

  @override
  State<CalendarScreen> createState() => CalendarScreenState();
}

class CalendarScreenState extends State<CalendarScreen> {
  int _offset = 0;
  GetCalendarResponse200? _data;
  int? _dataOffset;

  /// The fetch time of the shown month while it is the saved one; null once the live month is in.
  DateTime? _savedAt;
  Object? _error;
  bool _loading = false;
  bool _showEarlier = false;
  late final DateTime _today = widget.clock();

  @override
  void initState() {
    super.initState();
    _showSaved();
    reload();
  }

  /// Only the month shown on open (this month) is saved; its range is the snapshot's scope, so a
  /// month saved before the turn of the month is not shown as this one.
  String get _savedScope => monthQuery(_today, 0).from;

  /// Shows the saved month at once, unless the live one is already in.
  Future<void> _showSaved() async {
    final saved = await widget.snapshots?.read(
      SnapshotKey.calendar,
      scope: _savedScope,
    );
    if (saved == null || !mounted || _dataOffset != null || _offset != 0) {
      return;
    }
    try {
      final data = GetCalendarResponse200.fromJson(saved.json);
      setState(() {
        _data = data;
        _dataOffset = 0;
        _savedAt = saved.fetchedAt;
      });
    } catch (_) {
      // Unreadable: wait for the live month.
    }
  }

  Future<void> reload() async {
    final offset = _offset;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final q = monthQuery(_today, offset);
      final data = await widget.api.calendar.getCalendar(
        from: q.from,
        to: q.to,
      );
      if (!mounted || offset != _offset) return;
      setState(() {
        _data = data;
        _dataOffset = offset;
        _savedAt = null;
      });
      if (offset == 0) {
        widget.snapshots?.write(
          SnapshotKey.calendar,
          data.toJson(),
          widget.clock(),
          scope: q.from,
        );
      }
    } catch (e) {
      if (mounted && offset == _offset) setState(() => _error = e);
    } finally {
      if (mounted && offset == _offset) setState(() => _loading = false);
    }
  }

  void _go(int offset) {
    setState(() {
      _offset = offset;
      _showEarlier = false;
      _savedAt = null;
    });
    reload();
  }

  @override
  Widget build(BuildContext context) {
    final first = monthStart(_today, _offset);
    return Scaffold(
      appBar: AppBar(
        title: const AppTitle('Calendar'),
        actions: [
          IconButton(
            onPressed: reload,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: LayoutBuilder(
        builder: (context, box) => _body(context, box.maxWidth, first),
      ),
    );
  }

  Widget _body(BuildContext context, double width, DateTime first) {
    final data = _dataOffset == _offset ? _data : null;
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    if (data == null) {
      if (_error != null) {
        return Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Could not load the calendar: ${describeError(_error!)}',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                FilledButton(onPressed: reload, child: const Text('Retry')),
              ],
            ),
          ),
        );
      }
      return const Center(child: CircularProgressIndicator());
    }
    final grid = width >= calendarGridWidth;
    final pad = EdgeInsets.symmetric(
      horizontal: sidePadding(width, wide: grid),
    );
    final days = byDay(data.items);
    final todayKey = dayKey(_today);
    final problems = [
      (
        'trakt',
        sourceProblem(
          status: data.sources.trakt.status,
          stale: data.sources.trakt.stale,
          error: data.sources.trakt.error,
          retryAfter: data.sources.trakt.retryAfter,
        ),
      ),
      (
        'anilist',
        sourceProblem(
          status: data.sources.anilist.status,
          stale: data.sources.anilist.stale,
          error: data.sources.anilist.error,
          retryAfter: data.sources.anilist.retryAfter,
        ),
      ),
    ];
    return RefreshIndicator(
      onRefresh: reload,
      child: ListView(
        key: const PageStorageKey('calendar'),
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
          _monthBar(context, first),
          Text(
            'What airs, as each source dates it. When sources disagree, both show.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          for (final (source, text) in problems)
            if (text != null)
              Notice(
                key: ValueKey('cal-problem:$source'),
                icon: Icons.warning_amber,
                warning: true,
                spans: [
                  sourceSpan(source),
                  TextSpan(text: ' $text'),
                ],
              ),
          if (SnapshotNotice.shows(
            savedAt: _savedAt,
            offline: widget.offline,
            loading: _loading,
          ))
            SnapshotNotice(
              savedAt: _savedAt,
              offline: widget.offline,
              now: widget.clock(),
              error: _error,
            )
          else if (_error != null)
            Notice(
              icon: Icons.cloud_off,
              warning: true,
              text: 'Could not refresh: ${describeError(_error!)}.',
            ),
          const SizedBox(height: 12),
          if (grid)
            _Grid(first: first, days: days, todayKey: todayKey)
          else
            ..._agenda(context, days, first, todayKey),
          const SizedBox(height: 16),
          _Legend(style: muted),
        ],
      ),
    );
  }

  /// ‹ October 2026 › and Today when on another month.
  Widget _monthBar(BuildContext context, DateTime first) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        IconButton(
          key: const ValueKey('cal-prev'),
          onPressed: _offset <= minMonthOffset ? null : () => _go(_offset - 1),
          icon: const Icon(Icons.chevron_left),
          tooltip: 'Previous month',
        ),
        Text(
          monthLabel(first),
          key: const ValueKey('cal-month'),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        IconButton(
          key: const ValueKey('cal-next'),
          onPressed: _offset >= maxMonthOffset ? null : () => _go(_offset + 1),
          icon: const Icon(Icons.chevron_right),
          tooltip: 'Next month',
        ),
        if (_offset != 0)
          TextButton(onPressed: () => _go(0), child: const Text('Today')),
      ],
    ),
  );

  List<Widget> _agenda(
    BuildContext context,
    Map<String, List<List<CalendarItem>>> days,
    DateTime first,
    String todayKey,
  ) {
    final theme = Theme.of(context);
    final month = monthDays(days, first);
    final earlier = earlierDays(month, todayKey, thisMonth: _offset == 0);
    final shown = _showEarlier ? month : month.sublist(earlier);
    return [
      if (earlier > 0 && !_showEarlier)
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            key: const ValueKey('cal-earlier'),
            onPressed: () => setState(() => _showEarlier = true),
            icon: const Icon(Icons.keyboard_double_arrow_up),
            label: Text(
              'Show $earlier earlier ${earlier == 1 ? 'day' : 'days'}',
            ),
          ),
        ),
      if (shown.isEmpty)
        Text(
          'Nothing airs this month${earlier > 0 ? ' from today' : ''}.',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      for (final e in shown) ...[
        Padding(
          key: ValueKey('cal-day:${e.key}'),
          padding: const EdgeInsets.only(top: 12, bottom: 6),
          child: Row(
            children: [
              Text(
                agendaLabel(e.key),
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: e.key.compareTo(todayKey) < 0
                      ? theme.colorScheme.onSurfaceVariant
                      : null,
                ),
              ),
              if (e.key == todayKey) ...[
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 7,
                    vertical: 1,
                  ),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    'Today',
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.onPrimaryContainer,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        Container(
          decoration: BoxDecoration(
            border: Border.all(color: theme.colorScheme.outlineVariant),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            children: [
              for (final (i, g) in e.value.indexed) ...[
                if (i > 0) const Divider(height: 1),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Column(
                    children: [for (final item in g) _AgendaItem(item: item)],
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    ];
  }
}

class _AgendaItem extends StatelessWidget {
  const _AgendaItem({required this.item});

  final CalendarItem item;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final source = item.source.toJson();
    final url = item.url;
    return Semantics(
      label: itemLabel(item, sourceLabel(source)),
      excludeSemantics: true,
      child: InkWell(
        key: ValueKey('cal-item:${item.group}:$source:${item.episode}'),
        onTap: url == null ? null : () => openUrl(url),
        child: Opacity(
          opacity: item.watched ? 0.5 : 1,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: SourceIcon(source),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: item.title,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        TextSpan(
                          text:
                              ' · ${item.episode}${item.episodeTitle != null ? ' “${item.episodeTitle}”' : ''}',
                          style: muted,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  itemTime(item) ?? 'date only',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Grid extends StatelessWidget {
  const _Grid({
    required this.first,
    required this.days,
    required this.todayKey,
  });

  final DateTime first;
  final Map<String, List<List<CalendarItem>>> days;
  final String todayKey;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final cells = monthCells(first);
    final line = BorderSide(color: scheme.outlineVariant);
    Widget cell(({String key, int day})? c) {
      if (c == null) {
        return Container(color: scheme.surfaceContainerLow);
      }
      final isToday = c.key == todayKey;
      final past = c.key.compareTo(todayKey) < 0;
      return Padding(
        key: ValueKey('cal-cell:${c.key}'),
        padding: const EdgeInsets.all(5),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 22,
              height: 22,
              alignment: Alignment.center,
              decoration: isToday
                  ? BoxDecoration(color: scheme.primary, shape: BoxShape.circle)
                  : null,
              child: Text(
                '${c.day}',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontWeight: isToday ? FontWeight.w700 : null,
                  color: isToday
                      ? scheme.onPrimary
                      : past
                      ? scheme.onSurfaceVariant.withValues(alpha: 0.6)
                      : scheme.onSurfaceVariant,
                ),
              ),
            ),
            const SizedBox(height: 3),
            for (final g in days[c.key] ?? const <List<CalendarItem>>[])
              Container(
                margin: const EdgeInsets.only(bottom: 3),
                padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1),
                decoration: g.length > 1
                    ? BoxDecoration(
                        color: scheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(4),
                      )
                    : null,
                child: Column(
                  children: [for (final item in g) _GridItem(item: item)],
                ),
              ),
          ],
        ),
      );
    }

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        border: Border.fromBorderSide(line),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          Container(
            color: scheme.surfaceContainerLow,
            child: Row(
              children: [
                for (final d in weekdayLabels)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      child: Text(
                        d,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          for (var w = 0; w < cells.length; w += 7)
            DecoratedBox(
              decoration: BoxDecoration(border: Border(top: line)),
              child: IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var i = w; i < w + 7; i++)
                      Expanded(
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            border: i > w ? Border(left: line) : null,
                          ),
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(minHeight: 100),
                            child: cell(cells[i]),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _GridItem extends StatelessWidget {
  const _GridItem({required this.item});

  final CalendarItem item;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final source = item.source.toJson();
    final url = item.url;
    final label = itemLabel(item, sourceLabel(source));
    return Tooltip(
      message: label,
      child: Semantics(
        label: label,
        excludeSemantics: true,
        child: InkWell(
          key: ValueKey('cal-item:${item.group}:$source:${item.episode}'),
          onTap: url == null ? null : () => openUrl(url),
          child: Opacity(
            opacity: item.watched ? 0.5 : 1,
            child: DefaultTextStyle.merge(
              style: theme.textTheme.bodySmall!,
              child: Row(
                children: [
                  SourceIcon(source, size: 12),
                  const SizedBox(width: 3),
                  Expanded(
                    child: Text(
                      item.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 3),
                  Text(
                    item.episode,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({this.style});

  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    Widget entry(String source, String text) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SourceIcon(source, size: 13),
        const SizedBox(width: 4),
        Flexible(child: Text(text, style: style)),
      ],
    );
    return DefaultTextStyle.merge(
      style: style,
      child: Wrap(
        spacing: 16,
        runSpacing: 4,
        children: [
          entry('trakt', "Trakt: your shows' calendar"),
          entry('anilist', 'AniList: the anime on Shows'),
          entry(
            'simkl',
            'Simkl: your next episode, the date as Simkl gives it',
          ),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: 'Faded',
                  style: TextStyle(color: style?.color?.withValues(alpha: 0.5)),
                ),
                const TextSpan(text: ': watched'),
              ],
            ),
            style: style,
          ),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 20,
                height: 12,
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(3),
                  border: Border.all(color: scheme.outlineVariant),
                ),
              ),
              const SizedBox(width: 4),
              Flexible(
                child: Text(
                  'Shaded: one show from several sources',
                  style: style,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
