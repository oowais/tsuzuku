// Dates and labels for display, ported from legacy `app/utils/time.ts`, `shared/utils/formats.ts` and
// `shared/utils/source-links.ts`: "3 days ago", "in 2 days", "10 Aug", "S1E5".

const _months = [
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
const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

DateTime? parseTime(String? iso) => iso == null ? null : DateTime.tryParse(iso);

bool isFuture(String? iso, DateTime now) {
  final t = parseTime(iso);
  return t != null && t.isAfter(now);
}

const _units = <(String, int)>[
  ('year', 31536000000),
  ('month', 2592000000),
  ('day', 86400000),
  ('hour', 3600000),
  ('minute', 60000),
];

/// "3 days ago", "in 2 hours", "tomorrow", "just now"; null when [iso] is not a time.
String? relativeTime(String? iso, DateTime now) {
  final t = parseTime(iso);
  return t == null ? null : relativeTo(t, now);
}

String relativeTo(DateTime t, DateTime now) {
  final diff = t.difference(now).inMilliseconds;
  for (final (unit, ms) in _units) {
    if (diff.abs() >= ms) {
      final n = (diff / ms).round();
      if (n == 1 && unit == 'day') return 'tomorrow';
      if (n == -1 && unit == 'day') return 'yesterday';
      if (n == 1 && (unit == 'month' || unit == 'year')) return 'next $unit';
      if (n == -1 && (unit == 'month' || unit == 'year')) return 'last $unit';
      final label = n.abs() == 1 ? unit : '${unit}s';
      return n > 0 ? 'in ${n.abs()} $label' : '${n.abs()} $label ago';
    }
  }
  return 'just now';
}

// A midnight timestamp is a calendar date in the source's time zone (Simkl sends `2026-09-06T00:00:00+09:00`
// for an episode airing on 6 Sept in Japan); it is shown as written, not moved into the local time zone.
final _calendarDate = RegExp(
  r'^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.0+)?(?:Z|[+-]\d{2}:?\d{2})?)?$',
);

/// "3 Oct", with the year when it is not this year.
String? shortDate(String? iso, DateTime now) {
  if (iso == null) return null;
  final cal = _calendarDate.firstMatch(iso);
  final DateTime d;
  if (cal != null) {
    d = DateTime(int.parse(cal[1]!), int.parse(cal[2]!), int.parse(cal[3]!));
  } else {
    final t = parseTime(iso);
    if (t == null) return null;
    d = t.toLocal();
  }
  final year = d.year != now.year ? ' ${d.year}' : '';
  return '${d.day} ${_months[d.month - 1]}$year';
}

/// "Fri 16 Oct, 17:00" in the device's time zone.
String? airTime(String? iso) {
  final t = parseTime(iso)?.toLocal();
  if (t == null) return null;
  String two(int n) => n.toString().padLeft(2, '0');
  return '${_weekdays[t.weekday - 1]} ${t.day} ${_months[t.month - 1]}, '
      '${two(t.hour)}:${two(t.minute)}';
}

/// "S1E5", or "E5" for sources that number episodes without seasons.
String episodeLabel(num? season, num number) => season != null
    ? 'S${season.toInt()}E${number.toInt()}'
    : 'E${number.toInt()}';

/// "4:52" for a countdown.
String countdown(Duration d) {
  final s = d.inSeconds < 0 ? 0 : d.inSeconds;
  return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
}

// Specials and OVAs (decision #23), by the source's own type.
const _sideStoryFormats = {
  'ova',
  'special',
  'movie',
  'tv_special',
  'music',
  'cm',
  'pv',
};
const _formatLabels = {
  'tv': 'TV',
  'ona': 'ONA',
  'ova': 'OVA',
  'special': 'Special',
  'tv_special': 'TV special',
  'movie': 'Movie',
  'music': 'Music video',
  'cm': 'Commercial',
  'pv': 'Promo video',
};

bool isSideStory(String? format) =>
    format != null && _sideStoryFormats.contains(format.toLowerCase());

String formatLabel(String format) =>
    _formatLabels[format.toLowerCase()] ?? format;

// The source's airing status, in its own terms, shortened.
const _airing = {
  'returning series': 'Returning',
  'ended': 'Ended',
  'canceled': 'Canceled',
  'in production': 'In production',
  'upcoming': 'Upcoming',
  'currently_airing': 'Airing',
  'finished_airing': 'Finished airing',
  'not_yet_aired': 'Not yet aired',
};

String airingLabel(String airing) =>
    _airing[airing] ?? airing.replaceAll('_', ' ');

// Case and accents ignored in search: "pokemon" finds "Pokémon". Dart has no Unicode normalization,
// so the common Latin accents are folded by hand.
const _accents = {
  'àáâãäåāăą': 'a',
  'çćĉċč': 'c',
  'ďđ': 'd',
  'èéêëēĕėęě': 'e',
  'ĝğġģ': 'g',
  'ĥħ': 'h',
  'ìíîïĩīĭįı': 'i',
  'ĵ': 'j',
  'ķ': 'k',
  'ĺļľŀł': 'l',
  'ñńņňŉ': 'n',
  'òóôõöøōŏő': 'o',
  'ŕŗř': 'r',
  'śŝşšș': 's',
  'ţťŧț': 't',
  'ùúûüũūŭůűų': 'u',
  'ŵ': 'w',
  'ýÿŷ': 'y',
  'źżž': 'z',
};
final _foldMap = {
  for (final e in _accents.entries)
    for (final ch in e.key.split('')) ch: e.value,
};

String fold(String s) =>
    s.toLowerCase().split('').map((c) => _foldMap[c] ?? c).join();

/// The widest the content gets on a desktop (legacy's Nuxt UI container, 80rem).
const maxContentWidth = 1280.0;

/// Side padding that keeps the content at most [maxContentWidth] wide, centred.
double sidePadding(double width, {required bool wide}) {
  final base = wide ? 24.0 : 12.0;
  final extra = (width - maxContentWidth) / 2;
  return extra > base ? extra : base;
}
