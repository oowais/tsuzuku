import '../api/tsuzuku_api.dart';
import 'write_flows.dart' show localDay;

// The write log's grouping (#74, legacy `shared/utils/log-groups.ts`). One group per calendar day (in the
// viewer's time zone); within a day, the writes of one confirm (same markId) are one mark. Entries logged
// before markId existed join a mark of the same show when they are a different source and within
// [markWindow] of it.

typedef LogEntry = GetWriteLogResponse200Item;

const markWindow = Duration(minutes: 1);

class LogMark {
  const LogMark({
    required this.key,
    required this.at,
    required this.title,
    required this.images,
    required this.entries,
    required this.ok,
  });

  final String key;
  final DateTime at;
  final String title;
  final List<String> images;

  /// Trakt, Simkl, MAL order.
  final List<LogEntry> entries;
  final bool ok;

  /// The episode every source shares, shown once; null when they number it differently.
  String? get sharedEpisode {
    final eps = {for (final e in entries) e.episode};
    return eps.length == 1 ? entries.first.episode : null;
  }
}

class LogSession {
  const LogSession({
    required this.start,
    required this.end,
    required this.marks,
    required this.shows,
  });

  final DateTime start;
  final DateTime end;
  final List<LogMark> marks;
  final int shows;
}

const _order = ['trakt', 'simkl', 'mal'];

int _rank(LogEntry e) {
  final i = _order.indexOf(e.source.toJson());
  return i < 0 ? _order.length : i;
}

/// Days newest first, marks newest first inside. [dayOf] names a time's day (local by default).
List<LogSession> groupLog(
  List<LogEntry> entries, {
  String Function(DateTime)? dayOf,
}) {
  final day = dayOf ?? (DateTime d) => localDay(d.toLocal());
  final sorted = [...entries]
    ..sort((a, b) {
      final t = b.at.compareTo(a.at);
      return t != 0 ? t : b.id.compareTo(a.id);
    });
  final sessions = <List<LogEntry>>[];
  for (final e in sorted) {
    if (sessions.isNotEmpty && day(sessions.last.last.at) == day(e.at)) {
      sessions.last.add(e);
    } else {
      sessions.add([e]);
    }
  }

  return [
    for (final list in sessions)
      () {
        final marks = <(String, List<LogEntry>)>[];
        for (final e in list) {
          final mark = e.markId != null
              ? marks.where((m) => m.$1 == e.markId).firstOrNull
              : marks.where((m) {
                  final first = m.$2.first;
                  return first.markId == null &&
                      first.rowKey == e.rowKey &&
                      !m.$2.any(
                        (x) => x.source.toJson() == e.source.toJson(),
                      ) &&
                      first.at.difference(e.at).abs() <= markWindow;
                }).firstOrNull;
          if (mark != null) {
            mark.$2.add(e);
          } else {
            marks.add((e.markId ?? 'entry:${e.id}', [e]));
          }
        }
        return LogSession(
          start: list.last.at,
          end: list.first.at,
          shows: {
            for (final e in list) e.rowKey.isNotEmpty ? e.rowKey : e.title,
          }.length,
          marks: [
            for (final (key, raw) in marks)
              () {
                final entries = [...raw]
                  ..sort((a, b) => _rank(a).compareTo(_rank(b)));
                return LogMark(
                  key: key,
                  at: raw
                      .map((e) => e.at)
                      .reduce((a, b) => a.isAfter(b) ? a : b),
                  title: entries.first.title,
                  images:
                      entries
                          .where((e) => e.images.isNotEmpty)
                          .firstOrNull
                          ?.images ??
                      const [],
                  entries: entries,
                  ok: entries.every((e) => e.result.toJson() == 'ok'),
                );
              }(),
          ],
        );
      }(),
  ];
}

/// The episode is on the card already, so "Add S2E5 to history, watched now, rated 8" reads "Added to
/// history, rated 8". Other summaries (MAL's count, a season start) are shown as logged.
String shortSummary(LogEntry e) => e.summary.replaceFirst(
  RegExp(r'^Add \S+ to history, watched now'),
  'Added to history',
);
