import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/api/tsuzuku_api.dart';
import 'package:tsuzuku/server/server_config.dart';
import 'package:tsuzuku/settings/appearance.dart';
import 'package:tsuzuku/settings/backups_section.dart';
import 'package:tsuzuku/settings/sources_section.dart';

import 'writes_test.dart' show FakeServer, recorded;

// Settings (#108, step 3.6): connect opens the server's sign-in in the browser (the token never reaches the app),
// backups list, back up now and download to a file, light / dark kept across restarts.

SourceStatusInfo status(Map<String, Object?> over) =>
    SourceStatusInfo.fromJson({
      'source': 'mal',
      'connected': true,
      'status': null,
      'blockedUntil': null,
      'retryAfter': null,
      'lastFetchAt': null,
      'lastError': null,
      ...over,
    });

const backup = {
  'name': 'tsuzuku-2026-10-09T12-00-13-434Z.db',
  'size': 192512,
  'createdAt': '2026-10-09T12:00:13.434Z',
};

void main() {
  test('sign-in URL: on the server natively, same origin on web', () {
    expect(
      authStartUrl(const ServerConfig(baseUrl: 'https://t.example'), 'trakt'),
      Uri.parse('https://t.example/api/auth/trakt/start'),
    );
    expect(
      authStartUrl(const ServerConfig.sameOrigin(), 'mal').path,
      '/api/auth/mal/start',
    );
  });

  test('status chip as legacy words it', () {
    final now = DateTime.utc(2026, 10, 9, 12);
    expect(statusChip(status({'status': 'ok'}), now).label, 'OK');
    expect(
      statusChip(status({'status': 'auth_expired'}), now).tone,
      ChipTone.error,
    );
    expect(
      statusChip(
        status({
          'status': 'rate_limited',
          'blockedUntil': '2026-10-09T12:00:30.000Z',
        }),
        now,
      ).label,
      startsWith('Rate limited · '),
    );
    expect(
      statusChip(status({'connected': false}), now).label,
      'Not connected',
    );
    expect(
      statusChip(status({'source': 'tmdb', 'connected': false}), now).label,
      'Not checked yet',
    );
  });

  test('backup size and time', () {
    expect(backupSize(192512), '188 KB');
    expect(backupSize(2.4 * 1024 * 1024), '2.4 MB');
    expect(backupTime(DateTime(2026, 11, 15, 3)), '15 Nov 2026, 03:00');
  });

  test('appearance: kept across restarts, system by default', () async {
    final store = MemoryAppearanceStore();
    final a = AppearanceController(store);
    await a.load();
    expect(a.mode, ThemeMode.system);
    await a.setMode(ThemeMode.dark);
    expect(store.value, 'dark');
    final again = AppearanceController(store);
    await again.load();
    expect(again.mode, ThemeMode.dark);
  });

  testWidgets('sources: Connect opens the sign-in; nothing else is called', (
    tester,
  ) async {
    final s = FakeServer({
      '/api/sources/status': (_) => [
        ...(recorded('002-getSourcesStatus') as List).map((e) {
          final m = (e as Map).cast<String, Object?>();
          return m['source'] == 'mal' ? {...m, 'status': 'auth_expired'} : m;
        }),
      ],
    });
    final opened = <Uri>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SourcesSection(
              api: s.api,
              config: const ServerConfig(baseUrl: 'https://t.example'),
              open: (u) async {
                opened.add(u);
                return true;
              },
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('source:trakt')), findsOneWidget);
    expect(find.text('Auth expired'), findsOneWidget);
    expect(find.byKey(const ValueKey('connect:tmdb')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('connect:mal')));
    await tester.pump();
    expect(opened, [Uri.parse('https://t.example/api/auth/mal/start')]);
    expect(s.adapter.requests.map((r) => r.uri.path).toSet(), {
      '/api/sources/status',
    });
  });

  testWidgets('backups: back up now, then download saves the bytes', (
    tester,
  ) async {
    var list = <Object?>[];
    final s = FakeServer({
      '/api/backups': (o) {
        if (o.method == 'POST') {
          list = [backup];
          return backup;
        }
        return list;
      },
      '/api/backups/${backup['name']}': (_) => ResponseBody.fromBytes(
        [1, 2, 3, 4],
        200,
        headers: {
          Headers.contentTypeHeader: ['application/vnd.sqlite3'],
        },
      ),
    });
    final saved = <String, Uint8List>{};
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: BackupsSection(
              api: s.api,
              save: (name, bytes) async {
                saved[name] = bytes;
                return true;
              },
              clock: () => DateTime.utc(2026, 10, 9, 14),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No backups yet.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('back-up-now')));
    await tester.pumpAndSettle();
    expect(s.adapter.requests.where((r) => r.method == 'POST'), hasLength(1));
    await tester.tap(find.byKey(ValueKey('download:${backup['name']}')));
    await tester.pumpAndSettle();
    expect(saved[backup['name']], Uint8List.fromList([1, 2, 3, 4]));
  });
}
