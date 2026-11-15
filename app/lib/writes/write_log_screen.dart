import 'package:flutter/material.dart';

import '../server/connection.dart';
import '../up_next/format.dart';
import '../up_next/poster.dart';
import '../up_next/source_ui.dart';
import '../up_next/up_next_card.dart' show Tag, TagTone, openUrl;
import 'log_groups.dart';
import 'write_sheets.dart' show listStatusLabel;
import '../theme/solid_glass.dart';
import '../screens/app_title.dart';

/// The write log (legacy `pages/log.vue`): every write Tsuzuku sent to a source, newest first, with
/// what the source said. Grouped by day and by mark: one card per show and episode with its poster,
/// a line per source. A failed write marks the card's edge red.
class WriteLogScreen extends StatefulWidget {
  const WriteLogScreen({
    super.key,
    required this.load,
    this.posters,
    this.clock = DateTime.now,
  });

  /// Fetches `/api/write-log`.
  final Future<List<LogEntry>> Function() load;
  final PosterSource? posters;
  final DateTime Function() clock;

  @override
  State<WriteLogScreen> createState() => _WriteLogScreenState();
}

class _WriteLogScreenState extends State<WriteLogScreen> {
  List<LogSession>? _sessions;
  Object? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      final entries = await widget.load();
      if (mounted) {
        setState(() {
          _sessions = groupLog(entries);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final sessions = _sessions;
    final width = MediaQuery.sizeOf(context).width;
    final wide = width >= 840;
    return Scaffold(
      appBar: AppBar(
        title: const AppTitle('Write log'),
        actions: [
          IconButton(
            onPressed: _loading ? null : _reload,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: ListView(
          padding: EdgeInsets.fromLTRB(
            sidePadding(width, wide: wide),
            8,
            sidePadding(width, wide: wide),
            8 + MediaQuery.paddingOf(context).bottom,
          ),
          children: [
            SizedBox(
              height: 2,
              child: _loading ? const LinearProgressIndicator() : null,
            ),
            Text.rich(
              TextSpan(
                style: muted,
                children: [
                  const TextSpan(text: 'Every change sent to '),
                  sourceSpan('trakt'),
                  const TextSpan(text: ', '),
                  sourceSpan('simkl'),
                  const TextSpan(text: ' or '),
                  sourceSpan('mal'),
                  const TextSpan(text: ', and whether the source took it.'),
                ],
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  sessions == null
                      ? describeError(_error!)
                      : 'Could not refresh: ${describeError(_error!)}. Showing the last log.',
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
            if (sessions == null && _error == null)
              const Padding(
                padding: EdgeInsets.all(32),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (sessions != null && sessions.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 16),
                child: Text('Nothing written yet.', style: muted),
              ),
            for (final s in sessions ?? const <LogSession>[]) ...[
              Padding(
                padding: const EdgeInsets.only(top: 20, bottom: 8),
                child: Wrap(
                  spacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.end,
                  children: [
                    Text(
                      sessionLabel(s, widget.clock()),
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      '${s.shows} ${s.shows == 1 ? 'show' : 'shows'}',
                      style: muted,
                    ),
                  ],
                ),
              ),
              for (final m in s.marks)
                _MarkCard(mark: m, posters: widget.posters, wide: wide),
            ],
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}

String _two(int n) => n.toString().padLeft(2, '0');

/// "21:04" in local time.
String clockLabel(DateTime at) {
  final l = at.toLocal();
  return '${_two(l.hour)}:${_two(l.minute)}';
}

const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _monthNames = [
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

/// "Today", "Yesterday", else "Fri 9 Oct" (with the year when not this year), local time.
String dayLabel(DateTime at, DateTime now) {
  final a = at.toLocal(), n = now.toLocal();
  final days = DateTime(
    n.year,
    n.month,
    n.day,
  ).difference(DateTime(a.year, a.month, a.day)).inHours;
  final d = (days / 24).round();
  if (d == 0) return 'Today';
  if (d == 1) return 'Yesterday';
  return '${_weekdays[a.weekday - 1]} ${a.day} ${_monthNames[a.month - 1]}'
      '${a.year != n.year ? ' ${a.year}' : ''}';
}

/// "Today · 15:40–20:05", one time when the day has a single write.
String sessionLabel(LogSession s, DateTime now) {
  final day = dayLabel(s.end, now);
  final from = clockLabel(s.start), to = clockLabel(s.end);
  return from == to ? '$day · $to' : '$day · $from–$to';
}

class _MarkCard extends StatelessWidget {
  const _MarkCard({required this.mark, this.posters, required this.wide});

  final LogMark mark;
  final PosterSource? posters;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final shared = mark.sharedEpisode;
    final allFailed = mark.entries.every((e) => e.result.toJson() == 'error');
    return Padding(
      key: ValueKey('log:${mark.key}'),
      padding: const EdgeInsets.only(bottom: 12),
      child: PaneCard(
        edgeColor: mark.ok ? null : scheme.error,
        edgeWidth: mark.ok ? 1 : 1.6,
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Poster(
              images: mark.images,
              source: posters,
              width: wide ? 80 : 64,
              height: wide ? 120 : 96,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          mark.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      Text(
                        clockLabel(mark.at),
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                  if (shared != null || !mark.ok)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Wrap(
                        spacing: 6,
                        children: [
                          if (shared != null)
                            Tag(shared, tone: TagTone.primary, bold: true),
                          if (!mark.ok)
                            _FailedTag(allFailed ? 'failed' : 'partly failed'),
                        ],
                      ),
                    ),
                  const SizedBox(height: 6),
                  for (final e in mark.entries)
                    _EntryLine(entry: e, mark: mark, shared: shared),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FailedTag extends StatelessWidget {
  const _FailedTag(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    final error = Theme.of(context).colorScheme.error;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: error.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline, size: 13, color: error),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(color: error, fontSize: 12)),
        ],
      ),
    );
  }
}

class _EntryLine extends StatelessWidget {
  const _EntryLine({
    required this.entry,
    required this.mark,
    required this.shared,
  });

  final LogEntry entry;
  final LogMark mark;
  final String? shared;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final e = entry;
    final source = e.source.toJson();
    final failed = e.result.toJson() == 'error';
    final url = e.episodeUrl ?? e.url;
    final icon = Padding(
      padding: const EdgeInsets.only(top: 2),
      child: SourceIcon(source, size: 16),
    );
    return Padding(
      key: ValueKey('log-entry:${e.id}'),
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          url == null
              ? icon
              : Tooltip(
                  message: '${e.title} on ${sourceLabel(source)}',
                  child: InkWell(onTap: () => openUrl(url), child: icon),
                ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (shared == null || e.title != mark.title)
                  Text.rich(
                    TextSpan(
                      children: [
                        if (shared == null)
                          TextSpan(
                            text: e.episode,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                        if (e.title != mark.title)
                          TextSpan(
                            text: '${shared == null ? ' · ' : ''}${e.title}',
                            style: TextStyle(color: scheme.onSurfaceVariant),
                          ),
                      ],
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                Wrap(
                  spacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      shortSummary(e),
                      style: failed
                          ? TextStyle(
                              color: scheme.onSurfaceVariant,
                              decoration: TextDecoration.lineThrough,
                              decorationColor: scheme.error.withValues(
                                alpha: 0.6,
                              ),
                            )
                          : null,
                    ),
                    if (e.listStatus != null && e.listStatus != 'watching')
                      Tag(
                        listStatusLabel(e.listStatus!),
                        tone: TagTone.outline,
                      ),
                  ],
                ),
                if (failed)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.close, size: 16, color: scheme.error),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          e.error ?? 'failed',
                          style: TextStyle(color: scheme.error),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
