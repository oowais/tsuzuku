import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/app_controller.dart';
import 'package:tsuzuku/main.dart';
import 'package:tsuzuku/server/connection.dart';
import 'package:tsuzuku/server/server_config.dart';

import 'support/adapters.dart';

class MemoryStore implements ServerConfigStore {
  MemoryStore([this.config]);
  ServerConfig? config;

  @override
  Future<ServerConfig?> load() async => config;

  @override
  Future<void> save(ServerConfig config) async => this.config = config;
}

const _config = ServerConfig(
  baseUrl: 'https://tsuzuku.example.com',
  clientId: 'id.access',
  clientSecret: 'secret',
);

const _status = [
  {
    'source': 'trakt',
    'connected': true,
    'status': 'ok',
    'blockedUntil': null,
    'retryAfter': null,
    'lastFetchAt': null,
    'lastError': null,
  },
];

ScriptedAdapter server({int apiVersion = 1, bool refuse = false}) =>
    ScriptedAdapter((o) {
      if (o.path == '/api/health') {
        return jsonBody({'ok': true, 'apiVersion': apiVersion});
      }
      if (refuse) {
        return redirect(
          'https://team.cloudflareaccess.com/cdn-cgi/access/login/x',
        );
      }
      return jsonBody(_status);
    });

Future<AppController> pumpApp(
  WidgetTester tester, {
  ServerConfigStore? store,
  ScriptedAdapter? adapter,
  bool web = false,
}) async {
  final controller = AppController(
    store: store ?? MemoryStore(),
    web: web,
    adapter: adapter ?? server(),
  );
  await tester.pumpWidget(TsuzukuApp(controller: controller));
  await tester.runAsync(controller.load);
  await tester.pumpAndSettle();
  return controller;
}

void main() {
  brokenStoreTests();

  testWidgets('first run asks for the server, tests it, then saves it', (
    tester,
  ) async {
    final store = MemoryStore();
    final adapter = server();
    await pumpApp(tester, store: store, adapter: adapter);
    expect(find.text('Connect to your Tsuzuku server'), findsOneWidget);

    await tester.enterText(
      find.byType(TextField).at(0),
      'tsuzuku.example.com/',
    );
    await tester.enterText(find.byType(TextField).at(1), 'id.access');
    await tester.enterText(find.byType(TextField).at(2), 'secret');
    await tester.runAsync(() async {
      await tester.tap(find.text('Test and save'));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pumpAndSettle();

    expect(store.config?.baseUrl, 'https://tsuzuku.example.com');
    expect(store.config?.clientSecret, 'secret');
    expect(adapter.requests.first.path, '/api/sources/status');
    expect(find.text('Tsuzuku'), findsOneWidget);
  });

  testWidgets('nothing is saved when the test call fails', (tester) async {
    final store = MemoryStore();
    await pumpApp(tester, store: store, adapter: server(refuse: true));
    await tester.enterText(
      find.byType(TextField).at(0),
      'https://tsuzuku.example.com',
    );
    await tester.enterText(find.byType(TextField).at(1), 'id.access');
    await tester.enterText(find.byType(TextField).at(2), 'wrong');
    await tester.runAsync(() async {
      await tester.tap(find.text('Test and save'));
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pumpAndSettle();
    expect(store.config, isNull);
    expect(
      find.textContaining('Cloudflare Access refused the service token'),
      findsOneWidget,
    );
  });

  testWidgets('the web build skips the first run and uses relative URLs', (
    tester,
  ) async {
    final adapter = server();
    await pumpApp(tester, web: true, adapter: adapter);
    expect(find.text('Connect to your Tsuzuku server'), findsNothing);
    expect(
      adapter.requests.map((r) => r.uri.toString()),
      contains('/api/health'),
    );
    expect(
      adapter.requests.first.headers.keys,
      isNot(contains('CF-Access-Client-Id')),
    );
  });

  testWidgets('an apiVersion mismatch shows the update banner', (tester) async {
    await pumpApp(
      tester,
      store: MemoryStore(_config),
      adapter: server(apiVersion: appApiVersion + 1),
    );
    expect(find.byType(MaterialBanner), findsOneWidget);
    expect(find.textContaining('Update the app'), findsOneWidget);
  });

  testWidgets('no banner when the versions match', (tester) async {
    await pumpApp(tester, store: MemoryStore(_config));
    expect(find.byType(MaterialBanner), findsNothing);
  });

  testWidgets('a refused token shows the Access screen', (tester) async {
    final controller = await pumpApp(
      tester,
      store: MemoryStore(_config),
      adapter: server(refuse: true),
    );
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
    await tester.pumpAndSettle();
    expect(controller.accessRejected, isTrue);
    expect(find.text('Open Cloudflare'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    expect(find.text('Update in Settings'), findsOneWidget);
  });
}

class BrokenStore implements ServerConfigStore {
  @override
  Future<ServerConfig?> load() async => throw Exception('no keyring');

  @override
  Future<void> save(ServerConfig config) async {}
}

void brokenStoreTests() {
  testWidgets(
    'a storage error leads to the first run, not an endless spinner',
    (tester) async {
      await pumpApp(tester, store: BrokenStore());
      expect(find.text('Connect to your Tsuzuku server'), findsOneWidget);
      expect(find.textContaining('no keyring'), findsOneWidget);
    },
  );
}
