import 'dart:convert';

import 'package:flutter/services.dart';

import 'release.dart';

/// "What's new" (#108, step 3.3), as in Befikr: notes of the last 10 releases, written at build time
/// by `tool/whats_new.dart` into [whatsNewAsset]. The first start of a newer version shows what
/// changed since the version seen last on this device; a fresh install only remembers its version.
const whatsNewAsset = 'assets/whats_new.json';

class ReleaseNotes {
  const ReleaseNotes({
    required this.version,
    required this.date,
    required this.notes,
  });

  final Version version;

  /// `2026-11-14`.
  final String date;
  final List<String> notes;

  /// Newest first; entries that don't parse are left out. Empty for anything else (a dev build).
  static List<ReleaseNotes> parseList(String json) {
    final Object? list;
    try {
      list = jsonDecode(json);
    } on FormatException {
      return const [];
    }
    if (list is! List) return const [];
    final out = <ReleaseNotes>[];
    for (final r in list) {
      if (r is! Map) continue;
      final v = Version.tryParse('${r['version']}');
      final notes = r['notes'];
      if (v == null || notes is! List) continue;
      out.add(
        ReleaseNotes(
          version: v,
          date: '${r['date'] ?? ''}',
          notes: notes.map((n) => '$n').toList(),
        ),
      );
    }
    out.sort((a, b) => b.version.compareTo(a.version));
    return out;
  }
}

/// The bundled notes; empty when the asset is missing or broken.
Future<List<ReleaseNotes>> loadReleaseNotes([AssetBundle? bundle]) async {
  try {
    return ReleaseNotes.parseList(
      await (bundle ?? rootBundle).loadString(whatsNewAsset),
    );
  } catch (_) {
    return const [];
  }
}

/// What to show after starting [current] when [seen] was the version seen last: the releases after
/// [seen] up to [current]. Empty on a fresh install ([seen] null), on the same version, or after a
/// downgrade.
List<ReleaseNotes> notesSince(
  List<ReleaseNotes> all,
  Version? seen,
  Version current,
) {
  if (seen == null || !(current > seen)) return const [];
  return [
    for (final r in all)
      if (r.version > seen && !(r.version > current)) r,
  ];
}
