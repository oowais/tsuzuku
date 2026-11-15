import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/screens/update_widgets.dart';
import 'package:tsuzuku/theme/solid_glass.dart';
import 'package:tsuzuku/up_next/up_next_screen.dart';
import 'package:tsuzuku/update/release.dart';
import 'package:tsuzuku/update/whats_new.dart';
import 'package:tsuzuku/writes/write_flows.dart';
import 'package:tsuzuku/writes/write_sheets.dart';

import 'up_next_test.dart' show fixture, fixtureNow;
import 'writes_test.dart' show FakeServer, recorded;

// Solid Glass (#108, step 3.6), the app's only theme: Up Next and a sheet, light and dark, on the golden fixtures.
// Update after a deliberate look change: `flutter test --update-goldens test/golden_test.dart`, then look at the
// images in test/goldens/ before committing them.

/// Pixels may differ this much (text rasterising changes a little between Flutter versions; CI pins its own).
class _TolerantComparator extends LocalFileComparator {
  _TolerantComparator(super.testFile);

  static const tolerance = 0.02;

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final result = await GoldenFileComparator.compareLists(
      imageBytes,
      await getGoldenBytes(golden),
    );
    if (result.passed || result.diffPercent <= tolerance) return true;
    final error = await generateFailureOutput(result, golden, basedir);
    throw FlutterError(error);
  }
}

Future<void> _loadGeist() async {
  final loader = FontLoader('Geist');
  for (final w in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
    final bytes = File('assets/fonts/geist/Geist-$w.ttf').readAsBytesSync();
    loader.addFont(Future.value(ByteData.view(bytes.buffer)));
  }
  await loader.load();
}

Widget _app(Brightness b, Widget home) => MaterialApp(
  debugShowCheckedModeBanner: false,
  theme: solidGlassTheme(b),
  builder: (context, child) => GlassPage(child: child!),
  home: home,
);

void main() {
  setUpAll(() async {
    await _loadGeist();
    goldenFileComparator = _TolerantComparator(
      Uri.parse('${Directory.current.path}/test/golden_test.dart'),
    );
  });

  for (final b in Brightness.values) {
    final name = b.name;

    testWidgets('Up Next, $name', (tester) async {
      tester.view.physicalSize = const Size(420, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        _app(
          b,
          Scaffold(
            appBar: AppBar(title: const Text('Shows')),
            body: UpNextView(
              load: () async => fixture('demo'),
              clock: () => fixtureNow,
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/up_next_$name.png'),
      );
    });

    testWidgets('Mark sheet, $name', (tester) async {
      tester.view.physicalSize = const Size(420, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final s = FakeServer({
        '/api/mark/preview': (_) => recorded('023-postMarkPreview'),
      });
      final flow = MarkFlow(api: s.api, rowKey: 'm:1');
      await tester.pumpWidget(
        _app(
          b,
          Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: () => showWriteSheet(
                    context,
                    MarkSheet(
                      flow: flow,
                      title: 'Moonfall Academy',
                      clock: () => fixtureNow,
                    ),
                  ),
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/mark_sheet_$name.png'),
      );
    });
    testWidgets("What's new, $name", (tester) async {
      tester.view.physicalSize = const Size(420, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        _app(
          b,
          Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: () => showWhatsNew(context, const [
                    ReleaseNotes(
                      version: Version(0, 5, 1),
                      date: '2026-11-15',
                      notes: ['Restore the lockfile', 'Bump the app to 0.5.1'],
                    ),
                    ReleaseNotes(
                      version: Version(0, 5, 0),
                      date: '2026-11-15',
                      notes: ['Movies tab', 'Calendar', 'Solid Glass theme'],
                    ),
                  ]),
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/whats_new_$name.png'),
      );
    });
  }
}
