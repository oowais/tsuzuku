import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../server/connection.dart' show appApiVersion;

// The local snapshot (#108, step 3.7): the last successful answer of each read shown on open (Up Next,
// Movies, Calendar, Stats), kept on the device so a screen can show it at once, with its fetch time,
// until the live answer replaces it. Only a display cache: written after a successful read, never
// synced in the background, and nothing is ever queued from it. Native only; web has none.
//
// Never holds credentials: the server URL is the only part of the server config written here; the
// Access token stays in secure storage.

/// The snapshot names, one per screen.
abstract final class SnapshotKey {
  static const upNext = 'up-next';
  static const movies = 'movies';
  static const calendar = 'calendar';
  static const stats = 'stats';
}

/// A stored answer and when it was received.
class Snapshot {
  const Snapshot(this.json, this.fetchedAt);

  /// The response as plain JSON maps and lists, for the generated `fromJson`.
  final Map<String, Object?> json;

  /// When the app received it (not when the sources were fetched: those times are in the answer).
  final DateTime fetchedAt;
}

/// Where the snapshot files live: a folder on the device, or memory in tests.
abstract interface class SnapshotFiles {
  Future<String?> read(String name);

  /// Replaces [name] as a whole: a reader sees the old or the new file, never half of one.
  Future<void> write(String name, String text);
  Future<void> deleteAll();
}

/// [SnapshotFiles] in `<app support>/snapshot/`.
class DirSnapshotFiles implements SnapshotFiles {
  DirSnapshotFiles([Future<Directory> Function()? dir])
    : _dir = dir ?? _defaultDir;

  final Future<Directory> Function() _dir;

  static Future<Directory> _defaultDir() async => Directory(
    '${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}snapshot',
  );

  Future<File> _file(String name) async =>
      File('${(await _dir()).path}${Platform.pathSeparator}$name.json');

  @override
  Future<String?> read(String name) async {
    final file = await _file(name);
    return await file.exists() ? file.readAsString() : null;
  }

  @override
  Future<void> write(String name, String text) async {
    final file = await _file(name);
    await file.parent.create(recursive: true);
    final temp = File('${file.path}.tmp');
    await temp.writeAsString(text, flush: true);
    await temp.rename(file.path);
  }

  @override
  Future<void> deleteAll() async {
    final dir = await _dir();
    if (await dir.exists()) await dir.delete(recursive: true);
  }
}

/// The snapshot of one server, valid for one `apiVersion`: [open] drops it when the app's or the
/// server's `apiVersion` or the server URL changed since it was written, [reset] when the server
/// config changes. Every failure reads as "no snapshot": a broken file never stops a screen.
class SnapshotCache {
  SnapshotCache(SnapshotFiles this._files, {int? appVersion})
    : _appVersion = appVersion ?? appApiVersion;

  /// No snapshot (web, and tests that don't cover it): reads find nothing, writes do nothing.
  SnapshotCache.off() : _files = null, _appVersion = 0;

  final SnapshotFiles? _files;
  final int _appVersion;

  static const _meta = 'meta';

  bool get enabled => _files != null;

  /// What the stored answers were written for; null until [open].
  _Meta? _current;

  /// Checks the stored snapshot against this app and [serverUrl], drops it when it does not match.
  Future<void> open(String serverUrl) async {
    final files = _files;
    if (files == null) return;
    _Meta? stored;
    try {
      final text = await files.read(_meta);
      if (text != null) stored = _Meta.fromJson(jsonDecode(text));
    } catch (_) {
      stored = null;
    }
    if (stored != null &&
        stored.app == _appVersion &&
        stored.url == serverUrl) {
      _current = stored;
      return;
    }
    await _drop(_Meta(app: _appVersion, url: serverUrl));
  }

  /// The server config changed: a new URL or token. The old snapshot may be another server's, or
  /// one this token may no longer read.
  Future<void> reset(String serverUrl) async {
    if (_files == null) return;
    await _drop(_Meta(app: _appVersion, url: serverUrl));
  }

  /// The server's `apiVersion` from `/api/health`: drops the snapshot when it differs from the one
  /// the snapshot was written under.
  Future<void> serverVersion(int version) async {
    final current = _current;
    if (_files == null || current == null || current.server == version) return;
    final next = _Meta(app: current.app, url: current.url, server: version);
    if (current.server == null) {
      _current = next;
      await _writeMeta(next);
    } else {
      await _drop(next);
    }
  }

  /// The stored answer for [key], if any. [scope] tells answers of the same screen apart (the
  /// calendar's month); a snapshot of another scope is not returned.
  Future<Snapshot?> read(String key, {String scope = ''}) async {
    final files = _files;
    if (files == null || _current == null) return null;
    try {
      final text = await files.read(key);
      if (text == null) return null;
      final json = (jsonDecode(text) as Map).cast<String, Object?>();
      if ((json['scope'] ?? '') != scope) return null;
      return Snapshot(
        (json['body'] as Map).cast<String, Object?>(),
        DateTime.parse(json['fetchedAt'] as String),
      );
    } catch (_) {
      return null;
    }
  }

  /// Stores a successful answer. Call only after the live read succeeded.
  Future<void> write(
    String key,
    Map<String, Object?> body,
    DateTime fetchedAt, {
    String scope = '',
  }) async {
    final files = _files;
    if (files == null || _current == null) return;
    try {
      await files.write(
        key,
        jsonEncode({
          'fetchedAt': fetchedAt.toUtc().toIso8601String(),
          'scope': scope,
          'body': body,
        }),
      );
    } catch (_) {
      // A full disk or a read-only folder: the screen simply has no snapshot next time.
    }
  }

  Future<void> _drop(_Meta next) async {
    _current = null;
    try {
      await _files!.deleteAll();
      await _writeMeta(next);
      _current = next;
    } catch (_) {
      // Left closed: nothing is read or written until the next open.
    }
  }

  Future<void> _writeMeta(_Meta meta) async {
    try {
      await _files!.write(_meta, jsonEncode(meta.toJson()));
    } catch (_) {
      _current = null;
    }
  }
}

class _Meta {
  const _Meta({required this.app, required this.url, this.server});

  factory _Meta.fromJson(Object? json) {
    final map = json as Map;
    return _Meta(
      app: map['app'] as int,
      url: map['url'] as String,
      server: map['server'] as int?,
    );
  }

  final int app;
  final String url;
  final int? server;

  Map<String, Object?> toJson() => {'app': app, 'url': url, 'server': server};
}
