import '../api/tsuzuku_api.dart';

// Calendar (#108, step 3.6; legacy `pages/calendar.vue`, #72): what airs, per source and never merged. When two
// sources date the same episode differently, both show (decision #19). Local time throughout.

/// Months offered around this one: last month, this month and next.
const minMonthOffset = -1;
const maxMonthOffset = 1;

/// The first day of the month [offset] months from [today], local midnight.
DateTime monthStart(DateTime today, int offset) =>
    DateTime(today.year, today.month + offset, 1);

/// `from` and `to` for `/api/calendar`: the month's local start and the next month's, as UTC ISO strings.
({String from, String to}) monthQuery(DateTime today, int offset) => (
  from: monthStart(today, offset).toUtc().toIso8601String(),
  to: monthStart(today, offset + 1).toUtc().toIso8601String(),
);

String _two(int n) => n.toString().padLeft(2, '0');

/// 2026-10-09 for a local date.
String dayKey(DateTime d) => '${d.year}-${_two(d.month)}-${_two(d.day)}';

/// A date-only item (Simkl) sits on the date it was written with; the rest on their local day.
String itemDay(CalendarItem i) => i.dateOnly
    ? i.airsAt.substring(0, 10)
    : dayKey(DateTime.parse(i.airsAt).toLocal());

/// 14:00 local, or null for a date-only item.
String? itemTime(CalendarItem i) {
  if (i.dateOnly) return null;
  final t = DateTime.parse(i.airsAt).toLocal();
  return '${_two(t.hour)}:${_two(t.minute)}';
}

/// Per day, one show's items side by side (a group), earliest show first, in the answer's order.
Map<String, List<List<CalendarItem>>> byDay(List<CalendarItem> items) {
  final days = <String, List<List<CalendarItem>>>{};
  for (final item in items) {
    final groups = days.putIfAbsent(itemDay(item), () => []);
    final group = groups.where((g) => g.first.group == item.group).firstOrNull;
    if (group != null) {
      group.add(item);
    } else {
      groups.add([item]);
    }
  }
  return days;
}

/// The grid: Monday-first weeks covering the month; null pads the first and last week.
List<({String key, int day})?> monthCells(DateTime first) {
  final lead = (first.weekday + 6) % 7;
  final count = DateTime(first.year, first.month + 1, 0).day;
  final out = <({String key, int day})?>[for (var i = 0; i < lead; i++) null];
  for (var d = 1; d <= count; d++) {
    out.add((key: dayKey(DateTime(first.year, first.month, d)), day: d));
  }
  while (out.length % 7 != 0) {
    out.add(null);
  }
  return out;
}

/// The month's days that have episodes, in order.
List<MapEntry<String, List<List<CalendarItem>>>> monthDays(
  Map<String, List<List<CalendarItem>>> days,
  DateTime first,
) {
  final prefix = dayKey(first).substring(0, 7);
  return days.entries.where((e) => e.key.startsWith(prefix)).toList()
    ..sort((a, b) => a.key.compareTo(b.key));
}

/// This month's agenda starts today: how many days with episodes come before.
int earlierDays(
  List<MapEntry<String, List<List<CalendarItem>>>> days,
  String todayKey, {
  required bool thisMonth,
}) => thisMonth ? days.where((e) => e.key.compareTo(todayKey) < 0).length : 0;

const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weekdayLabels = _weekdays;
const _months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/// "October 2026".
String monthLabel(DateTime first) =>
    '${_months[first.month - 1]} ${first.year}';

/// "Sat 10 Oct" for a day key.
String agendaLabel(String key) {
  final p = key.split('-').map(int.parse).toList();
  final d = DateTime(p[0], p[1], p[2]);
  return '${_weekdays[d.weekday - 1]} ${d.day} ${_months[d.month - 1].substring(0, 3)}';
}

/// What a screen reader says for an item (legacy `label`).
String itemLabel(CalendarItem i, String sourceName) {
  final time = itemTime(i);
  return '${i.title} ${i.episode}'
      '${i.episodeTitle != null ? ' “${i.episodeTitle}”' : ''} on $sourceName'
      '${time != null ? ' at $time' : ''}'
      '${i.dateOnly ? ' (date as Simkl gives it)' : ''}'
      '${i.watched ? ', watched' : ''}';
}

/// A source's problem, as legacy words it; null when it is fine.
String? sourceProblem({
  required String status,
  required bool stale,
  String? error,
  num? retryAfter,
}) {
  if (status == 'ok') return null;
  final text = status == 'rate_limited'
      ? 'rate limited${retryAfter != null ? ', try again in ${retryAfter.round()} s' : ''}'
      : (error ?? status);
  return '$text${stale ? ' · showing what it said last' : ''}';
}
