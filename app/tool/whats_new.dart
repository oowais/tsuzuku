// Writes assets/whats_new.json, the notes of the last 10 app releases bundled with the app for the
// "What's new" sheet (#108, step 3.3; lib/update/whats_new.dart). A release's notes are the subjects
// of the commits under app/ since the previous app-v* tag, without the "(#108, step 3.3)" suffix.
// The version being built is included when it isn't tagged yet. Needs the full history and tags
// (actions/checkout with fetch-depth: 0).
//
//   dart run tool/whats_new.dart 0.2.0   writes assets/whats_new.json
//
// The Release body uses the same rules in plain git (.github/workflows/app-release.yml, "Release notes").
//
// Run from app/. Without a run the committed file is an empty list (dev builds show nothing).
import 'dart:convert';
import 'dart:io';

const keep = 10;
const output = 'assets/whats_new.json';

/// Before the Flutter app (4454c72, #108 step 3.1): the Nuxt app had its own app/ folder, so the
/// first release's range starts here instead of at the root commit.
const firstCommit = '4454c72';

String git(List<String> args) {
  final r = Process.runSync('git', args);
  if (r.exitCode != 0) {
    stderr.write(r.stderr);
    exit(1);
  }
  return r.stdout as String;
}

List<String> lines(String text) =>
    text.split('\n').map((l) => l.trim()).where((l) => l.isNotEmpty).toList();

/// Commit subjects under app/ in [range], oldest first, issue suffix dropped.
List<String> notes(String range) => lines(
  git(['log', '--no-merges', '--reverse', '--format=%s', range, '--', '.']),
).map((s) => s.replaceFirst(RegExp(r'\s*\(#\d+[^)]*\)$'), '')).toList();

String date(String ref) => git(['log', '-1', '--format=%cs', ref]).trim();

void main(List<String> args) {
  final version = args.isEmpty ? '' : args.first;
  if (!RegExp(r'^\d+\.\d+\.\d+$').hasMatch(version)) {
    stderr.writeln('Usage: dart run tool/whats_new.dart X.Y.Z');
    exit(2);
  }
  final tags = lines(
    git(['tag', '--list', 'app-v*', '--sort=-v:refname', '--merged', 'HEAD']),
  ).where((t) => RegExp(r'^app-v\d+\.\d+\.\d+$').hasMatch(t)).toList();

  final releases = <Map<String, Object>>[];
  void add(String v, String ref, String? previous) {
    final n = notes('${previous ?? '$firstCommit^'}..$ref');
    if (n.isNotEmpty) {
      releases.add({'version': v, 'date': date(ref), 'notes': n});
    }
  }

  if (!tags.contains('app-v$version')) {
    add(version, 'HEAD', tags.isEmpty ? null : tags.first);
  }
  for (var i = 0; releases.length < keep && i < tags.length; i++) {
    add(
      tags[i].substring(5),
      tags[i],
      i + 1 < tags.length ? tags[i + 1] : null,
    );
  }

  File(output).writeAsStringSync(
    '${const JsonEncoder.withIndent(' ').convert(releases)}\n',
  );
  stdout.writeln('$output: ${releases.map((r) => r['version']).join(', ')}');
}
