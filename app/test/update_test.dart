import 'dart:convert';
import 'dart:io';

import 'package:cryptography/cryptography.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/screens/update_widgets.dart';
import 'package:tsuzuku/update/release.dart';
import 'package:tsuzuku/update/signature.dart';
import 'package:tsuzuku/update/update_controller.dart';
import 'package:tsuzuku/update/whats_new.dart';

import 'support/adapters.dart';

const _base = 'https://github.com/oowais/tsuzuku/releases/download';

Map<String, Object?> release(
  String tag, {
  List<String> assets = const [
    'tsuzuku.apk',
    'tsuzuku-setup.exe',
    'tsuzuku-setup.exe.sig',
    'tsuzuku-x86_64.AppImage',
    'tsuzuku-x86_64.AppImage.sig',
  ],
  bool draft = false,
  bool prerelease = false,
}) => {
  'tag_name': tag,
  'draft': draft,
  'prerelease': prerelease,
  'assets': [
    for (final a in assets)
      {
        'name': a,
        'state': 'uploaded',
        'browser_download_url': '$_base/$tag/$a',
      },
  ],
};

final _now = DateTime.utc(2026, 11, 14, 12);

class MemoryUpdateStore implements UpdateStore {
  final values = <String, String>{};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String? value) async =>
      value == null ? values.remove(key) : values[key] = value;
}

void main() {
  group('Version', () {
    test('parses X.Y.Z and ignores the build number', () {
      expect(Version.tryParse('0.2.1'), const Version(0, 2, 1));
      expect(Version.tryParse('0.2.1+5'), const Version(0, 2, 1));
      expect(Version.tryParse('0.2'), isNull);
      expect(Version.tryParse('v0.2.1'), isNull);
    });

    test('compares numerically, not as text', () {
      expect(Version.tryParse('0.10.0')! > Version.tryParse('0.9.9')!, isTrue);
      expect(Version.tryParse('1.0.0')! > Version.tryParse('0.99.99')!, isTrue);
      expect(Version.tryParse('0.2.0')! > Version.tryParse('0.2.0')!, isFalse);
    });

    test('only app-v tags are app releases', () {
      expect(Version.fromTag('app-v0.3.0'), const Version(0, 3, 0));
      expect(Version.fromTag('v0.3.0'), isNull);
      expect(Version.fromTag('backend-v9.0.0'), isNull);
      expect(Version.fromTag('glass-v1'), isNull);
    });
  });

  group('newestAppRelease', () {
    test('picks the highest app-v tag, never a backend release', () {
      final r = newestAppRelease(
        [
          release('backend-v9.0.0'),
          release('app-v0.2.0'),
          release('app-v0.10.0'),
          release('app-v0.9.0'),
          release('glass-v1'),
        ],
        UpdatePlatform.android,
        _now,
      )!;
      expect(r.version, const Version(0, 10, 0));
      expect(r.assetUrl, '$_base/app-v0.10.0/tsuzuku.apk');
      expect(r.checkedAt, _now);
    });

    test('skips drafts and pre-releases', () {
      final r = newestAppRelease(
        [
          release('app-v0.4.0', draft: true),
          release('app-v0.3.0', prerelease: true),
          release('app-v0.2.0'),
        ],
        UpdatePlatform.windows,
        _now,
      )!;
      expect(r.version, const Version(0, 2, 0));
    });

    test('null without any app release', () {
      expect(
        newestAppRelease(
          [release('backend-v1.0.0')],
          UpdatePlatform.linux,
          _now,
        ),
        isNull,
      );
    });

    test('each platform looks for its own file', () {
      final apkOnly = [
        release('app-v0.2.0', assets: ['tsuzuku.apk']),
      ];
      expect(
        newestAppRelease(apkOnly, UpdatePlatform.android, _now)!.ready,
        isTrue,
      );
      expect(
        newestAppRelease(apkOnly, UpdatePlatform.windows, _now)!.ready,
        isFalse,
      );
      expect(
        newestAppRelease(apkOnly, UpdatePlatform.linux, _now)!.ready,
        isFalse,
      );
    });

    test('a desktop file counts only with its signature', () {
      final r = newestAppRelease(
        [
          release('app-v0.2.0', assets: ['tsuzuku-setup.exe']),
        ],
        UpdatePlatform.windows,
        _now,
      )!;
      expect(r.ready, isFalse);
      final signed = newestAppRelease(
        [release('app-v0.2.0')],
        UpdatePlatform.windows,
        _now,
      )!;
      expect(signed.ready, isTrue);
      expect(signed.signatureUrl, '$_base/app-v0.2.0/tsuzuku-setup.exe.sig');
    });

    test('a file still uploading does not count', () {
      final r = release('app-v0.2.0', assets: ['tsuzuku.apk']);
      ((r['assets'] as List).first as Map)['state'] = 'starter';
      expect(
        newestAppRelease([r], UpdatePlatform.android, _now)!.ready,
        isFalse,
      );
    });
  });

  group('checkDue', () {
    final current = const Version(0, 2, 0);
    LatestRelease saved(String v, {bool ready = true, required Duration ago}) =>
        LatestRelease(
          version: Version.tryParse(v)!,
          ready: ready,
          checkedAt: _now.subtract(ago),
        );

    test('due without a saved check', () {
      expect(checkDue(null, current, _now), isTrue);
    });

    test('at most once a day', () {
      expect(
        checkDue(saved('0.2.0', ago: const Duration(hours: 23)), current, _now),
        isFalse,
      );
      expect(
        checkDue(saved('0.2.0', ago: const Duration(hours: 24)), current, _now),
        isTrue,
      );
    });

    test('every 5 minutes while the newer release is being built', () {
      final building = saved(
        '0.3.0',
        ready: false,
        ago: const Duration(minutes: 4),
      );
      expect(checkDue(building, current, _now), isFalse);
      expect(
        checkDue(
          saved('0.3.0', ready: false, ago: const Duration(minutes: 5)),
          current,
          _now,
        ),
        isTrue,
      );
    });

    test(
      'an older release without a file waits a day (nothing to update to)',
      () {
        expect(
          checkDue(
            saved('0.1.0', ready: false, ago: const Duration(minutes: 10)),
            current,
            _now,
          ),
          isFalse,
        );
      },
    );

    test('a check from the future (clock set back) is due', () {
      expect(
        checkDue(saved('0.2.0', ago: const Duration(hours: -2)), current, _now),
        isTrue,
      );
    });

    test('the saved check survives a round trip', () {
      final r = LatestRelease(
        version: const Version(0, 3, 0),
        ready: true,
        assetUrl: 'a',
        signatureUrl: 'b',
        checkedAt: _now,
      );
      final back = LatestRelease.fromJson(jsonDecode(jsonEncode(r.toJson())))!;
      expect(back.version, r.version);
      expect(back.ready, isTrue);
      expect(back.assetUrl, 'a');
      expect(back.signatureUrl, 'b');
      expect(back.checkedAt, _now);
      expect(LatestRelease.fromJson({'version': 'x'}), isNull);
    });
  });

  group('signature', () {
    test('the built-in key is the one in packaging/', () {
      final pem = File('packaging/update-signing-key.pub.pem')
          .readAsStringSync()
          .split('\n')
          .where((l) => l.isNotEmpty && !l.startsWith('-----'))
          .join();
      final der = base64.decode(pem);
      expect(base64.encode(der.sublist(der.length - 32)), updatePublicKey);
    });

    test('accepts a file signed by the key, rejects anything else', () async {
      final algorithm = Ed25519();
      final pair = await algorithm.newKeyPair();
      final public = base64.encode((await pair.extractPublicKey()).bytes);
      final data = utf8.encode('tsuzuku-setup.exe contents');
      final sig = base64.encode(
        (await algorithm.sign(data, keyPair: pair)).bytes,
      );

      expect(
        await verifyUpdateSignature(data, '$sig\n', publicKey: public),
        isTrue,
      );
      final tampered = [...data]..[0] ^= 1;
      expect(
        await verifyUpdateSignature(tampered, sig, publicKey: public),
        isFalse,
      );
      // Signed by another key: the built-in one.
      expect(await verifyUpdateSignature(data, sig), isFalse);
      expect(
        await verifyUpdateSignature(data, 'not base64!', publicKey: public),
        isFalse,
      );
      expect(
        await verifyUpdateSignature(data, base64.encode([1, 2, 3])),
        isFalse,
      );
    });
  });

  group("what's new", () {
    final all = ReleaseNotes.parseList(
      jsonEncode([
        {
          'version': '0.2.0',
          'date': '2026-11-10',
          'notes': ['b'],
        },
        {
          'version': '0.4.0',
          'date': '2026-11-14',
          'notes': ['d'],
        },
        {
          'version': '0.3.0',
          'date': '2026-11-12',
          'notes': ['c'],
        },
        {'version': 'broken'},
      ]),
    );

    test('parses newest first and skips broken entries', () {
      expect(all.map((r) => '${r.version}'), ['0.4.0', '0.3.0', '0.2.0']);
      expect(ReleaseNotes.parseList('nope'), isEmpty);
      expect(ReleaseNotes.parseList('[]'), isEmpty);
    });

    test('after an update: the releases since the version seen last', () {
      final shown = notesSince(
        all,
        const Version(0, 2, 0),
        const Version(0, 4, 0),
      );
      expect(shown.map((r) => '${r.version}'), ['0.4.0', '0.3.0']);
    });

    test('nothing on a fresh install, the same version or a downgrade', () {
      expect(notesSince(all, null, const Version(0, 4, 0)), isEmpty);
      expect(
        notesSince(all, const Version(0, 4, 0), const Version(0, 4, 0)),
        isEmpty,
      );
      expect(
        notesSince(all, const Version(0, 4, 0), const Version(0, 3, 0)),
        isEmpty,
      );
    });
  });

  group('UpdateController', () {
    UpdateController controller(
      ScriptedAdapter adapter,
      MemoryUpdateStore store, {
      UpdatePlatform platform = UpdatePlatform.android,
      String version = '0.2.0',
      DateTime? now,
    }) {
      final dio = Dio()..httpClientAdapter = adapter;
      return UpdateController(
        platform: platform,
        store: store,
        dio: dio,
        appVersion: () async => version,
        clock: () => now ?? _now,
      );
    }

    test(
      'finds a ready update, keeps it, and does not ask again the same day',
      () async {
        final adapter = ScriptedAdapter(
          (_) => jsonBody([release('app-v0.3.0'), release('backend-v5.0.0')]),
        );
        final store = MemoryUpdateStore();
        final u = controller(adapter, store);
        await u.start(listenToLifecycle: false);
        expect(u.available, const Version(0, 3, 0));
        expect(u.canInstall, isTrue);
        expect(adapter.requests.single.uri.toString(), releasesUrl);
        expect(
          adapter.requests.single.headers.keys,
          isNot(contains('CF-Access-Client-Id')),
        );
        u.dispose();

        // Next start, an hour later: the saved result, no request.
        final again = controller(
          adapter,
          store,
          now: _now.add(const Duration(hours: 1)),
        );
        await again.start(listenToLifecycle: false);
        expect(again.available, const Version(0, 3, 0));
        expect(adapter.requests, hasLength(1));
        again.dispose();
      },
    );

    test('"being built" until this platform\'s file is there', () async {
      final adapter = ScriptedAdapter(
        (_) => jsonBody([
          release('app-v0.3.0', assets: ['tsuzuku.apk']),
        ]),
      );
      final u = controller(
        adapter,
        MemoryUpdateStore(),
        platform: UpdatePlatform.windows,
      );
      await u.start(listenToLifecycle: false);
      expect(u.available, isNull);
      expect(u.building, const Version(0, 3, 0));
      expect(u.canInstall, isFalse);
      u.dispose();
    });

    test('Linux shows the update but never installs it', () async {
      final adapter = ScriptedAdapter((_) => jsonBody([release('app-v0.3.0')]));
      final u = controller(
        adapter,
        MemoryUpdateStore(),
        platform: UpdatePlatform.linux,
      );
      await u.start(listenToLifecycle: false);
      expect(u.available, const Version(0, 3, 0));
      expect(u.canInstall, isFalse);
      u.dispose();
    });

    test('up to date when the newest release is this version', () async {
      final adapter = ScriptedAdapter((_) => jsonBody([release('app-v0.2.0')]));
      final u = controller(adapter, MemoryUpdateStore());
      await u.start(listenToLifecycle: false);
      expect(u.available, isNull);
      expect(u.building, isNull);
      expect(u.latest, isNotNull);
      u.dispose();
    });

    test('a GitHub error is shown and nothing is saved', () async {
      final adapter = ScriptedAdapter((_) => jsonBody({}, status: 403));
      final store = MemoryUpdateStore();
      final u = controller(adapter, store);
      await u.start(listenToLifecycle: false);
      expect(u.checkError, 'GitHub answered HTTP 403.');
      expect(store.values[UpdateController.latestKey], isNull);
      u.dispose();
    });

    test('web never checks', () async {
      final adapter = ScriptedAdapter((_) => jsonBody([]));
      final u = UpdateController(
        platform: null,
        store: MemoryUpdateStore(),
        dio: Dio()..httpClientAdapter = adapter,
        appVersion: () async => '0.2.0',
      );
      await u.start(listenToLifecycle: false);
      await u.check(force: true);
      expect(adapter.requests, isEmpty);
      u.dispose();
    });

    test('remembers the version seen; a fresh install shows nothing', () async {
      final adapter = ScriptedAdapter((_) => jsonBody([]));
      final store = MemoryUpdateStore();
      final u = controller(adapter, store);
      await u.start(listenToLifecycle: false);
      expect(u.whatsNew, isEmpty);
      expect(store.values[UpdateController.seenKey], '0.2.0');
      u.dispose();
    });

    test('Windows: a started install still on the old version is a failure', () async {
      final dir = Directory.systemTemp.createTempSync('tsuzuku-update');
      addTearDown(() => dir.deleteSync(recursive: true));
      final installer = File('${dir.path}/tsuzuku-setup-0.3.0.exe')
        ..writeAsStringSync('x');
      final log = File('${dir.path}/install-0.3.0.log')
        ..writeAsStringSync('line 1\nError: file in use\n');
      final store = MemoryUpdateStore();
      store.values[UpdateController.windowsInstallKey] = jsonEncode({
        'version': '0.3.0',
        'installer': installer.path,
        'log': log.path,
      });
      final u = controller(
        ScriptedAdapter((_) => jsonBody([release('app-v0.3.0')])),
        store,
        platform: UpdatePlatform.windows,
      );
      await u.start(listenToLifecycle: false);
      expect(u.failedInstall?.version, const Version(0, 3, 0));
      expect(u.installError, contains('Installing 0.3.0 failed.'));
      expect(u.installError, contains('Error: file in use'));
      expect(installer.existsSync(), isTrue, reason: 'kept for Try again');
      u.dispose();

      // After a good install the next start removes the installer and the note.
      final done = controller(
        ScriptedAdapter((_) => jsonBody([release('app-v0.3.0')])),
        store,
        platform: UpdatePlatform.windows,
        version: '0.3.0',
      );
      await done.start(listenToLifecycle: false);
      expect(done.installError, isNull);
      expect(installer.existsSync(), isFalse);
      expect(store.values[UpdateController.windowsInstallKey], isNull);
      done.dispose();
    });
  });

  testWidgets('Settings: version, dot and Update when an update is ready', (
    tester,
  ) async {
    final u = UpdateController(
      platform: UpdatePlatform.android,
      store: MemoryUpdateStore(),
      dio: Dio()
        ..httpClientAdapter = ScriptedAdapter(
          (_) => jsonBody([release('app-v0.3.0')]),
        ),
      appVersion: () async => '0.2.0',
      clock: () => _now,
    );
    await tester.runAsync(() => u.start(listenToLifecycle: false));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          appBar: AppBar(actions: [SettingsIcon(updates: u)]),
          body: UpdateSection(updates: u),
        ),
      ),
    );
    expect(find.text('0.2.0'), findsOneWidget);
    expect(find.text('Version 0.3.0 is ready'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Update'), findsOneWidget);
    final dot = tester.widget<Badge>(
      find.ancestor(
        of: find.byIcon(Icons.settings_outlined),
        matching: find.byType(Badge),
      ),
    );
    expect(dot.isLabelVisible, isTrue);
    u.dispose();
  });
}
