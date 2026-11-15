import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/up_next/format.dart';
import 'package:tsuzuku/up_next/up_next_logic.dart';
import 'package:tsuzuku/up_next/up_next_screen.dart';

// Up Next (#108, step 3.4): the row logic and the screen, on the golden fixtures (api/fixtures/):
// `demo` (every source answers) and `demo-blocked` (Simkl and MAL rate limited, stale data).

UpNext fixture(String scenario) {
  final file = File(
    '../api/fixtures/$scenario/cases/004-getUpNext/response.json',
  );
  final body = (jsonDecode(file.readAsStringSync()) as Map)['body'];
  return UpNext.fromJson((body as Map).cast<String, Object?>());
}

final fixtureNow = DateTime.utc(2026, 10, 9, 12);

UpRow rowNamed(UpNext data, String title) =>
    data.rows.firstWhere((r) => r.title.startsWith(title));

void main() {
  final demo = fixture('demo');
  final blocked = fixture('demo-blocked');

  group('sections and summary', () {
    test('splits rows by section and next episode, in the server order', () {
      final s = UpNextSections(demo.rows);
      expect(s.nextToWatch.first.title, 'Moonfall Academy');
      expect(s.nextToWatch, hasLength(11));
      expect(s.notOnTrakt.map((r) => r.title), [
        'Mukudori no Shio',
        'Winter Ledger',
        'Hinoko Monogatari',
        startsWith('Chronicles'),
        'Haguruma no Guwa',
      ]);
      expect(s.caughtUp.map((r) => r.title), ['Birodo Suisei']);
    });

    test('counts flagged and accepted differences', () {
      expect(
        summary(demo.rows),
        '3 shows differ between sources. 1 accepted difference.',
      );
    });
  });

  group('per-source progress, never merged', () {
    test('agreeing sources share one lead episode, in Trakt numbering', () {
      final l = lead(rowNamed(demo, 'Moonfall Academy'))!;
      expect(l.episode, 'S1E17');
      expect(l.name, 'The Second Bell');
      // Anime on Simkl and MAL: their own E5 is Trakt's S1E17.
      final m = lead(rowNamed(demo, 'Mukudori no Shio'))!;
      expect(m.episode, 'S1E6');
      expect(m.name, 'Murmuration');
    });

    test('a lone source leads with its own episode', () {
      expect(lead(rowNamed(demo, 'Glass Harbor'))!.episode, 'S2E1');
    });

    test('differing sources each keep their own next episode', () {
      final row = rowNamed(demo, 'Paper Kites');
      expect(lead(row), isNull);
      final next = perSourceNext(row);
      expect(next.map((n) => (n.source, n.label, n.differs)), [
        ('trakt', 'S1E3', true),
        ('simkl', 'S1E4', true),
      ]);
    });

    test('an accepted difference still shows each source, unflagged', () {
      final row = rowNamed(demo, 'Iron Petals');
      expect(flaggedDiffers(row), isFalse);
      expect(lead(row), isNull);
      final next = perSourceNext(row);
      expect(next.map((n) => n.label), ['S1E8', 'E8', 'E7']);
      expect(next.every((n) => !n.differs), isTrue);
      expect(next[2].traktLabel, 'S1E7');
    });

    test('unplaced anime shows every source and the season-not-set badge', () {
      final row = rowNamed(demo, 'Clockwork Garden');
      expect(lead(row), isNull);
      expect(perSourceNext(row), hasLength(3));
      expect(notPlaced(row), isTrue);
    });

    test(
      'progress comes from one named source: Simkl, else Trakt, else MAL',
      () {
        final p = progress(rowNamed(demo, 'Moonfall Academy'))!;
        expect((p.source, p.watched, p.episodes, p.left), ('simkl', 4, 12, 8));
        final mal = progress(rowNamed(demo, 'Haguruma no Guwa'))!;
        expect((mal.source, mal.watched, mal.episodes), ('mal', 1, 2));
        final done = progress(rowNamed(demo, 'Birodo Suisei'))!;
        expect(done.left, 0);
      },
    );

    test(
      'last watched once while the sources agree, newest Trakt/Simkl time',
      () {
        final l = lastWatched(rowNamed(demo, 'Moonfall Academy'))!;
        expect(l.at, '2026-10-09T09:36:00.000Z');
        expect(l.updated, isFalse);
        // MAL alone only knows when its entry changed.
        expect(
          lastWatched(rowNamed(demo, 'Haguruma no Guwa'))!.updated,
          isTrue,
        );
        expect(lastWatched(rowNamed(demo, 'Paper Kites')), isNull);
      },
    );

    test(
      'upcoming episodes, diff reasons and next-season start come through',
      () {
        expect(rowNamed(demo, 'Birodo Suisei').upcoming.single.episode, 'E13');
        final reason = rowNamed(demo, 'Paper Kites').reasons.single.toJson();
        expect((reason as Map)['kind'], 'partial_mark');
        final start = rowNamed(demo, 'Glass Harbor').start;
        expect(start.sources.map((s) => s.toJson()), ['mal', 'simkl']);
        expect(rowNamed(demo, 'Tidewater Saints').start.search, isTrue);
      },
    );
  });

  group('flags and fetch status', () {
    test('no flags when every source answers', () {
      expect(demo.rows.expand(flags), isEmpty);
    });

    test('blocked sources flag their own cells only', () {
      final row = rowNamed(blocked, 'Moonfall Academy');
      expect(flags(row).map((f) => (f.source, f.kind)), [
        ('simkl', FlagKind.blocked),
        ('mal', FlagKind.blocked),
      ]);
      // Trakt-only rows carry no flag.
      final traktOnly = rowNamed(blocked, 'Quiet Orbit');
      expect(flags(traktOnly).map((f) => f.source), isNot(contains('trakt')));
    });

    test('source health: status, stale, fetch time, rate-limit end', () {
      final h = sourceHealth(blocked, fixtureNow);
      expect(h.map((s) => s.source), ['trakt', 'simkl', 'mal']);
      expect(h[0].ok, isTrue);
      expect(h[1].status, 'rate_limited');
      expect(h[1].stale, isTrue);
      expect(h[1].fetchedAt, DateTime.utc(2026, 10, 9, 12));
      expect(h[1].blockedUntil, fixtureNow.add(const Duration(minutes: 5)));
    });

    test(
      'mark watched hook: every source when they agree, else the lone one',
      () {
        expect(markAction(rowNamed(demo, 'Moonfall Academy')), (
          show: true,
          source: null,
        ));
        expect(markAction(rowNamed(demo, 'Paper Kites')).show, isFalse);
        expect(markAction(rowNamed(demo, 'Glass Harbor')), (
          show: true,
          source: 'trakt',
        ));
      },
    );
  });

  group('filter', () {
    List<String> titles(UpNextFilter f) => demo.rows
        .where((r) => matchesFilter(r, f))
        .map((r) => r.title)
        .toList();

    test('title search ignores case and accents, every word must match', () {
      expect(fold('Pokémon Ça'), 'pokemon ca');
      expect(titles(const UpNextFilter(q: 'MOONFALL')), ['Moonfall Academy']);
      expect(titles(const UpNextFilter(q: 'harbor glass')), ['Glass Harbor']);
      expect(titles(const UpNextFilter(q: 'nothing like this')), isEmpty);
    });

    test('differs leaves out accepted differences', () {
      expect(titles(const UpNextFilter(only: {UpNextChip.differs})), [
        'Paper Kites',
        startsWith('The Extraordinarily'),
        'Lantern Road',
      ]);
    });

    test('unmapped, next episode and kind', () {
      expect(
        titles(const UpNextFilter(only: {UpNextChip.unmapped})),
        containsAll(['Tidewater Saints', 'Winter Ledger', 'Birodo Suisei']),
      );
      expect(
        titles(const UpNextFilter(only: {UpNextChip.next})),
        isNot(contains('Birodo Suisei')),
      );
      final shows = titles(const UpNextFilter(kind: 'show'));
      expect(shows, containsAll(['Harbor Lights', 'Paper Kites']));
      expect(shows, isNot(contains('Moonfall Academy')));
    });
  });

  group('format', () {
    test('relative times and dates', () {
      expect(
        relativeTo(fixtureNow.add(const Duration(days: 3)), fixtureNow),
        'in 3 days',
      );
      expect(
        relativeTo(fixtureNow.subtract(const Duration(hours: 2)), fixtureNow),
        '2 hours ago',
      );
      expect(
        relativeTo(fixtureNow.add(const Duration(days: 1)), fixtureNow),
        'tomorrow',
      );
      expect(relativeTo(fixtureNow, fixtureNow), 'just now');
      // A source's midnight is a calendar date, not moved to the local time zone.
      expect(shortDate('2026-10-03T00:00:00+09:00', fixtureNow), '3 Oct');
      expect(shortDate('2025-01-20', fixtureNow), '20 Jan 2025');
      expect(episodeLabel(2, 5), 'S2E5');
      expect(episodeLabel(null, 5), 'E5');
      expect(countdown(const Duration(seconds: 292)), '4:52');
    });
  });

  group('screen', () {
    Future<void> pump(
      WidgetTester tester,
      Future<UpNext> Function() load, {
      Size size = const Size(420, 12000),
    }) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: UpNextView(load: load, clock: () => fixtureNow),
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
    }

    testWidgets('blocked sources never blank the screen', (tester) async {
      await pump(tester, () async => blocked);
      expect(find.text('Moonfall Academy'), findsOneWidget);
      expect(find.text('Harbor Lights'), findsOneWidget);
      final simkl = find.byKey(const ValueKey('health:simkl'));
      expect(
        find.descendant(
          of: simkl,
          matching: find.textContaining('rate limited 5:00'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: simkl, matching: find.textContaining('stale')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('health:trakt')),
          matching: find.textContaining('fetched just now'),
        ),
        findsOneWidget,
      );
      expect(find.text('rate limited'), findsWidgets);

      // The countdown runs.
      await tester.pump(const Duration(seconds: 1));
    });

    testWidgets('differing rows show every source, agreeing rows one lead', (
      tester,
    ) async {
      await pump(tester, () async => demo);
      final kites = find.byKey(const ValueKey('card:m:5'));
      expect(
        find.descendant(
          of: kites,
          matching: find.byKey(const ValueKey('per-source-next')),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: kites, matching: find.text('S1E3')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: kites, matching: find.text('S1E4')),
        findsOneWidget,
      );
      final moonfall = find.byKey(const ValueKey('card:m:1'));
      expect(
        find.descendant(
          of: moonfall,
          matching: find.byKey(const ValueKey('lead')),
        ),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('proposals')), findsOneWidget);
      expect(
        find.text('3 shows differ between sources. 1 accepted difference.'),
        findsOneWidget,
      );
    });

    testWidgets(
      'a card opens to each source\'s own view; writes are disabled',
      (tester) async {
        await pump(tester, () async => demo);
        await tester.tap(find.text('Paper Kites'));
        await tester.pump();
        expect(find.byKey(const ValueKey('source:m:5:trakt')), findsOneWidget);
        expect(find.byKey(const ValueKey('source:m:5:simkl')), findsOneWidget);
        final accept = tester.widget<OutlinedButton>(
          find.ancestor(
            of: find.text('Accept difference'),
            matching: find.byWidgetPredicate((w) => w is OutlinedButton),
          ),
        );
        expect(accept.onPressed, isNull);
      },
    );

    testWidgets('caught up rows are folded away', (tester) async {
      await pump(tester, () async => demo);
      final toggle = find.byKey(const ValueKey('caught-up-toggle'));
      await tester.scrollUntilVisible(
        toggle,
        500,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Birodo Suisei'), findsNothing);
      await tester.tap(toggle);
      await tester.pump();
      await tester.scrollUntilVisible(
        find.text('Birodo Suisei'),
        500,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Birodo Suisei'), findsOneWidget);
    });

    testWidgets('wide screens lay cards out in columns', (tester) async {
      await pump(tester, () async => demo, size: const Size(1000, 4000));
      final a = tester.getTopLeft(find.byKey(const ValueKey('card:m:1')));
      final b = tester.getTopLeft(find.byKey(const ValueKey('card:m:2')));
      expect(a.dy, b.dy);
      expect(b.dx, greaterThan(a.dx));
    });

    testWidgets(
      'a failed first load offers a retry; a failed reload keeps the list',
      (tester) async {
        var fail = true;
        await pump(tester, () async {
          if (fail) throw StateError('offline');
          return demo;
        });
        expect(find.text('Retry'), findsOneWidget);
        fail = false;
        await tester.tap(find.text('Retry'));
        await tester.pump();
        await tester.pump();
        expect(find.text('Moonfall Academy'), findsOneWidget);

        fail = true;
        await tester.state<UpNextViewState>(find.byType(UpNextView)).reload();
        await tester.pump();
        expect(find.text('Moonfall Academy'), findsOneWidget);
        expect(find.textContaining('Could not refresh'), findsOneWidget);
      },
    );
  });
}
