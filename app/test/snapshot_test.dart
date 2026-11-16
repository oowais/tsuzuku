import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/api/tsuzuku_api.dart';
import 'package:tsuzuku/app_controller.dart';
import 'package:tsuzuku/movies/movie_logic.dart';
import 'package:tsuzuku/movies/movies_screen.dart';
import 'package:tsuzuku/server/server_config.dart';
import 'package:tsuzuku/snapshot/snapshot.dart';
import 'package:tsuzuku/stats/stats_screen.dart';
import 'package:tsuzuku/up_next/up_next_logic.dart';
import 'package:tsuzuku/up_next/up_next_screen.dart';

import 'app_test.dart' show MemoryStore;
import 'support/adapters.dart';

// The local snapshot (#108, step 3.7): saved only after a successful read, shown at once with its fetch
// time, replaced by the live answer, dropped on an `apiVersion`, URL or token change, never on web,
// never holding a credential; offline the app is read-only.

class MemoryFiles implements SnapshotFiles {
  final files = <String, String>{};

  @override
  Future<String?> read(String name) async => files[name];

  @override
  Future<void> write(String name, String text) async => files[name] = text;

  @override
  Future<void> deleteAll() async => files.clear();
}

Map<String, Object?> recorded(String scenario, String caseDir) => (jsonDecode(
  File('../api/fixtures/$scenario/cases/$caseDir/response.json')
      .readAsStringSync(),
) as Map).cast<String, Object?>();

String caseNamed(String scenario, String suffix) =>
    Directory('../api/fixtures/$scenario/cases')
        .listSync()
        .whereType<Directory>()
        .map((d) => d.uri.pathSegments.where((s) => s.isNotEmpty).last)
        .firstWhere((n) => n.endsWith('-$suffix'));

Map<String, Object?> body(String suffix) {
  final r = recorded('demo', caseNamed('demo', suffix));
  return (r['body'] as Map).cast<String, Object?>();
}

final fixtureNow = DateTime.utc(2026, 10, 9, 12);

/// What Dio's adapter throws when the network is down (airplane mode).
DioException unreachable(RequestOptions o) => DioException(
  requestOptions: o,
  type: DioExceptionType.connectionError,
  error: const SocketException('no network'),
);

/// Lets the views' pending timers (Dio's timeouts, the clock tick) run out after a test.
Future<void> finish(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(minutes: 1));
}

const url = 'https://tsuzuku.example.com';

Future<SnapshotCache> openCache(MemoryFiles files, {int app = 1}) async {
  final cache = SnapshotCache(files, appVersion: app);
  await cache.open(url);
  return cache;
}

void main() {
  group('cache', () {
    test('keeps an answer with its fetch time across restarts', () async {
      final files = MemoryFiles();
      final cache = await openCache(files);
      await cache.write(SnapshotKey.stats, {'a': 1}, fixtureNow);
      final again = await openCache(files);
      final saved = await again.read(SnapshotKey.stats);
      expect(saved!.json, {'a': 1});
      expect(saved.fetchedAt, fixtureNow);
      expect(await again.read(SnapshotKey.movies), isNull);
    });

    test('dropped when the app\'s apiVersion changes', () async {
      final files = MemoryFiles();
      await (await openCache(files))
          .write(SnapshotKey.upNext, {'a': 1}, fixtureNow);
      final updated = await openCache(files, app: 2);
      expect(await updated.read(SnapshotKey.upNext), isNull);
    });

    test('dropped when the server\'s apiVersion changes', () async {
      final files = MemoryFiles();
      final cache = await openCache(files);
      await cache.serverVersion(1);
      await cache.write(SnapshotKey.upNext, {'a': 1}, fixtureNow);
      await cache.serverVersion(1);
      expect(await cache.read(SnapshotKey.upNext), isNotNull);
      await cache.serverVersion(2);
      expect(await cache.read(SnapshotKey.upNext), isNull);
      // Survives a restart as version 2's.
      await cache.write(SnapshotKey.upNext, {'b': 1}, fixtureNow);
      final again = await openCache(files);
      await again.serverVersion(2);
      expect((await again.read(SnapshotKey.upNext))!.json, {'b': 1});
    });

    test('dropped when the server URL changes, and on reset', () async {
      final files = MemoryFiles();
      final cache = await openCache(files);
      await cache.write(SnapshotKey.upNext, {'a': 1}, fixtureNow);
      final other = SnapshotCache(files, appVersion: 1);
      await other.open('https://other.example.com');
      expect(await other.read(SnapshotKey.upNext), isNull);
      await other.write(SnapshotKey.upNext, {'a': 1}, fixtureNow);
      await other.reset('https://other.example.com');
      expect(await other.read(SnapshotKey.upNext), isNull);
    });

    test(
      'scope: a month saved before the turn of the month is not this one',
      () async {
        final cache = await openCache(MemoryFiles());
        await cache.write(
          SnapshotKey.calendar,
          {'a': 1},
          fixtureNow,
          scope: '2026-10',
        );
        expect(
          await cache.read(SnapshotKey.calendar, scope: '2026-11'),
          isNull,
        );
        expect(
          await cache.read(SnapshotKey.calendar, scope: '2026-10'),
          isNotNull,
        );
      },
    );

    test('a broken file reads as no snapshot', () async {
      final files = MemoryFiles();
      final cache = await openCache(files);
      files.files[SnapshotKey.stats] = '{not json';
      expect(await cache.read(SnapshotKey.stats), isNull);
      files.files['meta'] = 'garbage';
      final again = await openCache(files);
      expect(await again.read(SnapshotKey.stats), isNull);
    });

    test('off: nothing is read or written', () async {
      final cache = SnapshotCache.off();
      await cache.open(url);
      await cache.write(SnapshotKey.stats, {'a': 1}, fixtureNow);
      expect(await cache.read(SnapshotKey.stats), isNull);
    });

    test('files in a folder, replaced whole, deleted on drop', () async {
      final dir = await Directory.systemTemp.createTemp('snapshot');
      addTearDown(() => dir.delete(recursive: true));
      final files = DirSnapshotFiles(
        () async => Directory('${dir.path}/snapshot'),
      );
      final cache = SnapshotCache(files, appVersion: 1);
      await cache.open(url);
      await cache.write(SnapshotKey.stats, {'a': 1}, fixtureNow);
      await cache.write(SnapshotKey.stats, {'a': 2}, fixtureNow);
      expect((await cache.read(SnapshotKey.stats))!.json, {'a': 2});
      expect(
        Directory('${dir.path}/snapshot')
            .listSync()
            .map((f) => f.uri.pathSegments.last)
            .toSet(),
        {'meta.json', 'stats.json'},
      );
      await cache.reset(url);
      expect(await cache.read(SnapshotKey.stats), isNull);
    });

    test('the four reads survive the trip through the snapshot', () async {
      final cache = await openCache(MemoryFiles());
      Future<Map<String, Object?>> trip(Map<String, Object?> json) async {
        await cache.write('x', json, fixtureNow);
        return (await cache.read('x'))!.json;
      }

      for (final scenario in ['demo', 'demo-blocked']) {
        final dio = Dio(BaseOptions(baseUrl: 'https://tsuzuku.test'))
          ..httpClientAdapter = FixtureAdapter(scenario);
        final api = TsuzukuApi(dio);
        final upNext = await api.upNext.getUpNext();
        expect(
          jsonEncode(UpNext.fromJson(await trip(upNext.toJson())).toJson()),
          jsonEncode(upNext.toJson()),
        );
        final movies = await api.movies.getMovies();
        expect(
          jsonEncode(Movies.fromJson(await trip(movies.toJson())).toJson()),
          jsonEncode(movies.toJson()),
        );
        final calendar = await api.calendar.getCalendar(
          from: '2026-10-09T00:00:00.000Z',
          to: '2026-11-09T00:00:00.000Z',
        );
        expect(
          jsonEncode(
            GetCalendarResponse200.fromJson(await trip(calendar.toJson()))
                .toJson(),
          ),
          jsonEncode(calendar.toJson()),
        );
        final stats = await api.stats.getStats();
        expect(
          jsonEncode(
            GetStatsResponse200.fromJson(await trip(stats.toJson())).toJson(),
          ),
          jsonEncode(stats.toJson()),
        );
      }
    });
  });

  group('app', () {
    const config = ServerConfig(
      baseUrl: url,
      clientId: 'id.access',
      clientSecret: 'very-secret',
    );

    ScriptedAdapter server({int apiVersion = 1}) => ScriptedAdapter((o) {
      if (o.path == '/api/health') {
        return jsonBody({'ok': true, 'apiVersion': apiVersion});
      }
      return jsonBody([]);
    });

    Future<(AppController, MemoryFiles)> start({
      MemoryFiles? files,
      int apiVersion = 1,
      bool web = false,
      HttpClientAdapter? adapter,
    }) async {
      final f = files ?? MemoryFiles();
      final c = AppController(
        store: MemoryStore(config),
        web: web,
        adapter: adapter ?? server(apiVersion: apiVersion),
        snapshots: SnapshotCache(f, appVersion: 1),
      );
      await c.load();
      return (c, f);
    }

    test(
      'kept across restarts with the same server, token and versions',
      () async {
        final (c, files) = await start();
        await c.snapshots.write(SnapshotKey.upNext, {'a': 1}, fixtureNow);
        final (again, _) = await start(files: files);
        expect(await again.snapshots.read(SnapshotKey.upNext), isNotNull);
      },
    );

    test('dropped when the server reports another apiVersion', () async {
      final (c, files) = await start();
      await c.snapshots.write(SnapshotKey.upNext, {'a': 1}, fixtureNow);
      final (again, _) = await start(files: files, apiVersion: 2);
      expect(await again.snapshots.read(SnapshotKey.upNext), isNull);
    });

    test(
      'dropped when the token or the URL changes, not on the same config',
      () async {
        final (c, _) = await start();
        await c.snapshots.write(SnapshotKey.upNext, {'a': 1}, fixtureNow);
        await c.save(config, serverApiVersion: 1);
        expect(await c.snapshots.read(SnapshotKey.upNext), isNotNull);

        await c.save(
          const ServerConfig(
            baseUrl: url,
            clientId: 'id.access',
            clientSecret: 'rotated',
          ),
          serverApiVersion: 1,
        );
        expect(await c.snapshots.read(SnapshotKey.upNext), isNull);

        await c.snapshots.write(SnapshotKey.upNext, {'a': 1}, fixtureNow);
        await c.save(
          const ServerConfig(baseUrl: 'https://other.example.com'),
          serverApiVersion: 1,
        );
        expect(await c.snapshots.read(SnapshotKey.upNext), isNull);
      },
    );

    test('never stores the token', () async {
      final (c, files) = await start();
      await c.snapshots.write(SnapshotKey.upNext, {'a': 1}, fixtureNow);
      final all = files.files.values.join('\n');
      expect(all, isNot(contains('very-secret')));
      expect(all, isNot(contains('id.access')));
    });

    test('web keeps no snapshot', () async {
      final (c, files) = await start(web: true);
      expect(c.snapshots.enabled, isFalse);
      await c.snapshots.write(SnapshotKey.upNext, {'a': 1}, fixtureNow);
      expect(files.files, isEmpty);
    });

    test(
      'offline when the server cannot be reached, back on any answer',
      () async {
        var down = true;
        final adapter = ScriptedAdapter((o) {
          if (down) throw unreachable(o);
          return jsonBody({'ok': true, 'apiVersion': 1});
        });
        final (c, _) = await start(adapter: adapter);
        expect(c.offline, isTrue);
        down = false;
        await c.checkVersion();
        expect(c.offline, isFalse);
      },
    );
  });

  group('screens', () {
    final upNextJson = body('getUpNext');

    Future<void> pumpUpNext(
      WidgetTester tester, {
      required Future<UpNext> Function() load,
      required SnapshotCache snapshots,
      bool offline = false,
      TsuzukuApi? api,
    }) async {
      tester.view.physicalSize = const Size(420, 12000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: UpNextView(
              load: load,
              clock: () => fixtureNow,
              snapshots: snapshots,
              offline: offline,
              api: api,
            ),
          ),
        ),
      );
    }

    TsuzukuApi fixtureApi() => TsuzukuApi(
      Dio(BaseOptions(baseUrl: 'https://tsuzuku.test'))
        ..httpClientAdapter = FixtureAdapter('demo'),
    );

    testWidgets(
      'shown at once with its fetch time, then replaced by the live list',
      (tester) async {
        final files = MemoryFiles();
        final cache = await tester.runAsync(() => openCache(files));
        final savedAt = fixtureNow.subtract(const Duration(hours: 3));
        await tester.runAsync(
          () => cache!.write(SnapshotKey.upNext, upNextJson, savedAt),
        );
        final live = Completer<UpNext>();
        await pumpUpNext(
          tester,
          load: () => live.future,
          snapshots: cache!,
          api: fixtureApi(),
        );
        await tester.pump();
        await tester.pump();
        expect(find.text('Moonfall Academy'), findsOneWidget);
        final notice = find.byKey(const ValueKey('snapshot-notice'));
        expect(
          find.descendant(
            of: notice,
            matching: find.textContaining(
              'Saved copy from 3 hours ago',
              findRichText: true,
            ),
          ),
          findsOneWidget,
        );
        // The saved list's write buttons are off.
        final mark = tester.widget<IconButton>(
          find.byKey(const ValueKey('mark')).first,
        );
        expect(mark.onPressed, isNull);

        live.complete(UpNext.fromJson(upNextJson));
        await tester.pump();
        await tester.pump();
        expect(find.byKey(const ValueKey('snapshot-notice')), findsNothing);
        expect(find.text('Moonfall Academy'), findsOneWidget);
        expect(
          tester
              .widget<IconButton>(find.byKey(const ValueKey('mark')).first)
              .onPressed,
          isNotNull,
        );
        // The live list replaces the saved one, with its own fetch time.
        final saved = jsonDecode(files.files[SnapshotKey.upNext]!) as Map;
        expect(DateTime.parse(saved['fetchedAt'] as String), fixtureNow);
        await finish(tester);
      },
    );

    testWidgets('written only on success', (tester) async {
      final files = MemoryFiles();
      final cache = await tester.runAsync(() => openCache(files));
      await pumpUpNext(
        tester,
        load: () async => throw DioException(
          requestOptions: RequestOptions(path: '/api/up-next'),
          type: DioExceptionType.connectionError,
        ),
        snapshots: cache!,
      );
      await tester.pump();
      await tester.pump();
      expect(files.files.keys, isNot(contains(SnapshotKey.upNext)));

      // A new view (the old one is gone) loads again, and succeeds.
      await tester.pumpWidget(const SizedBox());
      await pumpUpNext(
        tester,
        load: () async => UpNext.fromJson(upNextJson),
        snapshots: cache,
      );
      await tester.pump();
      await tester.pump();
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      expect(files.files.keys, contains(SnapshotKey.upNext));
      await finish(tester);
    });

    testWidgets('offline: the saved list stays, writes are off with a note', (
      tester,
    ) async {
      final files = MemoryFiles();
      final cache = await tester.runAsync(() => openCache(files));
      await tester.runAsync(
        () => cache!.write(SnapshotKey.upNext, upNextJson, fixtureNow),
      );
      await pumpUpNext(
        tester,
        load: () async => throw DioException(
          requestOptions: RequestOptions(path: '/api/up-next'),
          type: DioExceptionType.connectionError,
        ),
        snapshots: cache!,
        offline: true,
        api: fixtureApi(),
      );
      await tester.pump();
      await tester.pump();
      expect(find.text('Moonfall Academy'), findsOneWidget);
      expect(
        find.textContaining('writes are off', findRichText: true),
        findsOneWidget,
      );
      expect(
        tester
            .widget<IconButton>(find.byKey(const ValueKey('mark')).first)
            .onPressed,
        isNull,
      );
      await finish(tester);
    });

    testWidgets('offline with the live list: writes are off too', (
      tester,
    ) async {
      await pumpUpNext(
        tester,
        load: () async => UpNext.fromJson(upNextJson),
        snapshots: SnapshotCache.off(),
        offline: true,
        api: fixtureApi(),
      );
      await tester.pump();
      await tester.pump();
      expect(
        find.textContaining('writes are off', findRichText: true),
        findsOneWidget,
      );
      expect(
        tester
            .widget<IconButton>(find.byKey(const ValueKey('mark')).first)
            .onPressed,
        isNull,
      );
      await finish(tester);
    });

    testWidgets('Movies offline: add and mark are off', (tester) async {
      tester.view.physicalSize = const Size(420, 12000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: MoviesScreen(
            api: fixtureApi(),
            snapshots: SnapshotCache.off(),
            offline: true,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<IconButton>(find.byKey(const ValueKey('movie-add')))
            .onPressed,
        isNull,
      );
      final mark = find.byWidgetPredicate(
        (w) =>
            w.key is ValueKey<String> &&
            (w.key as ValueKey<String>).value.startsWith('movie-mark:'),
      );
      expect(mark, findsWidgets);
      expect(tester.widget<IconButton>(mark.first).onPressed, isNull);
      await finish(tester);
    });

    testWidgets('Stats: the saved stats show with their fetch time', (
      tester,
    ) async {
      final files = MemoryFiles();
      final cache = await tester.runAsync(() => openCache(files));
      await tester.runAsync(
        () => cache!.write(
          SnapshotKey.stats,
          body('getStats'),
          fixtureNow.subtract(const Duration(days: 2)),
        ),
      );
      final api = TsuzukuApi(
        Dio(BaseOptions(baseUrl: 'https://tsuzuku.test'))
          ..httpClientAdapter = ScriptedAdapter((o) => throw unreachable(o)),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: StatsScreen(
            api: api,
            clock: () => fixtureNow,
            snapshots: cache!,
            offline: true,
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
      expect(
        find.textContaining('Saved copy from 2 days ago', findRichText: true),
        findsOneWidget,
      );
      await finish(tester);
    });
  });
}
