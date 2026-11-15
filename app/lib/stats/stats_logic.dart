import '../api/tsuzuku_api.dart';

// Stats (#108, step 3.6; legacy `pages/stats.vue`, `history.ts`, `MarksChart.vue`): each source's own numbers side
// by side, never added up, and Tsuzuku's marks from the write log.

String _num(num v) {
  // One decimal at most, thousands grouped (legacy `Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })`).
  final rounded = (v * 10).round() / 10;
  final whole = rounded.truncate();
  final frac = ((rounded - whole).abs() * 10).round();
  final digits = whole.abs().toString();
  final grouped = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) grouped.write(',');
    grouped.write(digits[i]);
  }
  return '${rounded < 0 ? '-' : ''}$grouped${frac == 0 ? '' : '.$frac'}';
}

String formatNumber(num v) => _num(v);

/// A figure as legacy shows it: minutes as hours (days from 48 h), days, a score with two decimals.
String showFigure(Figure f) {
  final unit = f.unit?.toJson();
  final v = f.value;
  if (unit == 'minutes') {
    final hours = v / 60;
    return hours >= 48 ? '${_num(hours / 24)} days' : '${_num(hours)} h';
  }
  if (unit == 'days') return '${_num(v)} days';
  if (unit == 'score') return v.toStringAsFixed(2);
  return _num(v);
}

/// This week (from Monday), this month and the weekly average over the last 4 weeks, in local time.
({int week, int month, double weeklyAverage})? historyFigures(
  List<String>? recent,
  DateTime now,
) {
  if (recent == null) return null;
  final monthStart = DateTime(now.year, now.month, 1);
  final weekStart = DateTime(now.year, now.month, now.day - (now.weekday - 1));
  final fourWeeks = now.subtract(const Duration(days: 28));
  final times = [for (final t in recent) ?DateTime.tryParse(t)?.toLocal()];
  return (
    week: times.where((t) => !t.isBefore(weekStart)).length,
    month: times.where((t) => !t.isBefore(monthStart)).length,
    weeklyAverage: times.where((t) => !t.isBefore(fourWeeks)).length / 4,
  );
}

/// Marks per local day over the last 30 days, oldest first, today last.
List<({int ok, int failed})> marksByDay(
  List<GetStatsResponse200WritesItemRecentItem> marks,
  DateTime now,
) {
  final days = List.generate(30, (_) => (ok: 0, failed: 0));
  // Calendar days in UTC arithmetic, so a DST change never makes a day 23 hours.
  final today = DateTime.utc(now.year, now.month, now.day);
  for (final m in marks) {
    final t = DateTime.tryParse(m.at)?.toLocal();
    if (t == null) continue;
    final ago = today.difference(DateTime.utc(t.year, t.month, t.day)).inDays;
    if (ago < 0 || ago > 29) continue;
    final i = 29 - ago;
    final d = days[i];
    days[i] = m.ok
        ? (ok: d.ok + 1, failed: d.failed)
        : (ok: d.ok, failed: d.failed + 1);
  }
  return days;
}

/// "Today", "Yesterday", "N days ago" for column [i] of 30.
String daysAgo(int i) {
  final n = 29 - i;
  return n == 0
      ? 'Today'
      : n == 1
      ? 'Yesterday'
      : '$n days ago';
}

num breakdownTotal(Breakdown b) => b.parts.fold<num>(0, (n, p) => n + p.value);
