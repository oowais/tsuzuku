import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/api/tsuzuku_api.dart';
import 'package:tsuzuku/mappings/mapping_logic.dart';
import 'package:tsuzuku/mappings/mappings_controller.dart';
import 'package:tsuzuku/mappings/mappings_screen.dart';

import 'writes_test.dart' show FakeServer;
import 'writes_test.dart' as w show recorded;

/// A recorded answer with `"<wall-clock>"` (a time the real clock stamped, api/fixtures/README.md) as any date.
Object? recorded(String c) => jsonDecode(
  jsonEncode(w.recorded(c))
      .replaceAll('"<wall-clock>"', '"2026-10-09T12:00:00.000Z"'),
);

// Mappings (#108, step 3.6): rows built from the recorded overview, and every change on its own explicit button,
// with exactly the body legacy sends. Answers come from the golden fixtures (api/fixtures/).

Mappings mappings() => GetMappingsResponse200.fromJson(
  (recorded('011-getMappings') as Map).cast<String, Object?>(),
);

FakeServer server() => FakeServer({
  '/api/mappings': (_) => recorded('011-getMappings'),
  '/api/trakt/seasons': (_) => recorded('016-getTraktSeasons'),
  '/api/trakt/search': (_) => recorded('015-getTraktSearch'),
  '/api/mappings/confirm': (_) => recorded('042-postMappingsConfirm'),
  '/api/mappings/edit': (_) => recorded('044-postMappingsEdit'),
  '/api/mappings/unlink': (_) => recorded('045-postMappingsUnlink'),
  '/api/mappings/reject': (_) => recorded('046-postMappingsReject'),
});

void main() {
  group('rows', () {
    test('stored links: one row per anime season, one per show link', () {
      final rows = linkRows(mappings());
      final anime = rowsForTab(rows, 'anime');
      final shows = rowsForTab(rows, 'show');
      // Mappings without a Trakt show (10, 11) are not linked rows.
      expect(anime.length, 7);
      expect(shows.length, 3);
      final moonfall = rows.firstWhere((r) => r.key == 's:1');
      expect(moonfall.traktTitle, 'Moonfall Academy');
      expect(moonfall.traktSeason, 1);
      expect(moonfall.episodeOffset, 12);
      expect(moonfall.how, 'confirmed');
      expect(
        moonfall.traktSeasonUrl,
        'https://trakt.tv/shows/moonfall-academy/seasons/1',
      );
      expect(moonfall.entryLinks.map((l) => l.source), contains('mal'));
      final clockwork = rows.firstWhere((r) => r.key == 's:5');
      expect(clockwork.traktSeason, isNull);
      expect(clockwork.how, 'by ID');
      expect(
        rows.map((r) => r.traktTitle).toList(),
        [...rows.map((r) => r.traktTitle)]..sort(),
      );
    });

    test('Simkl and MAL listing the same anime are one group, titles once', () {
      final d = mappings();
      final group = sameAnime(d, mal: 950032, simkl: 970032);
      expect(group.map((e) => e.source.toJson()).toSet(), {'simkl', 'mal'});
      expect(
        entryTitles(group).split(' / ').toSet().length,
        entryTitles(group).split(' / ').length,
      );
    });

    test('not linked to Trakt: no proposal and no Trakt show', () {
      final d = mappings();
      final rows = unlinkedRows(d);
      final keys = rows.map((r) => r.key).toList();
      // The proposal's anime is never listed here.
      expect(keys, isNot(contains('mal:950071')));
      expect(rows.every((r) => r.entries.isNotEmpty), isTrue);
      expect(keys.toSet().length, keys.length);
    });

    test("meaning: at Trakt's next episode, offset applied", () {
      final d = mappings();
      final p = d.proposals.single;
      final m = meaning(d, p, traktSeason: 1, offset: 0)!;
      final n = p.trakt.next?.number.toInt() ?? 1;
      expect(m.trakt.label, 'Trakt S1E$n');
      expect(m.anime.map((a) => a.label), everyElement(endsWith('E$n')));
      expect(meaning(d, p, traktSeason: null, offset: 0), isNull);
      final shifted = meaning(d, p, traktSeason: 1, offset: 2)!;
      expect(shifted.anime.first.label, endsWith('E${n - 2}'));
    });

    test('season label', () {
      expect(
        seasonLabel(
          const TraktSeason(
            number: 2,
            title: 'Arc Two',
            episodeCount: 12,
            airedEpisodes: 12,
            poster: null,
          ),
        ),
        'S2 · Arc Two · 12 eps',
      );
      expect(
        seasonLabel(
          const TraktSeason(
            number: 1,
            title: 'Season 1',
            episodeCount: null,
            airedEpisodes: null,
            poster: null,
          ),
        ),
        'S1',
      );
    });
  });

  group('changes', () {
    test('confirm sends the placement; needs a season', () async {
      final s = server();
      final c = MappingsController(s.api);
      await c.load();
      final p = c.data!.proposals.single;
      c.setEdit(p, season: 1, offset: 0);
      expect(await c.confirm(p), isNull);
      expect(s.sent(s.calls('/api/mappings/confirm').single), {
        'traktId': 900007,
        'animeKey': 'mal:950071',
        'traktSeason': 1,
        'episodeOffset': 0,
      });
      // Reloaded after the change.
      expect(s.calls('/api/mappings'), hasLength(2));
    });

    test('confirm without a season sends nothing', () async {
      final s = server();
      final c = MappingsController(s.api);
      await c.load();
      final p = c.data!.proposals.single;
      c.editOf(p).traktSeason = null;
      expect(await c.confirm(p), 'Pick a Trakt season first');
      expect(s.calls('/api/mappings/confirm'), isEmpty);
    });

    test(
      'reject, edit, unlink and link again send what legacy sends',
      () async {
        final s = server();
        final c = MappingsController(s.api);
        await c.load();
        await c.reject(c.data!.proposals.single);
        expect(s.sent(s.calls('/api/mappings/reject').single), {
          'traktId': 900007,
          'animeKey': 'mal:950071',
        });
        final row = c.links.firstWhere((r) => r.key == 's:1');
        await c.edit(row, traktSeason: 1, episodeOffset: 12);
        expect(s.sent(s.calls('/api/mappings/edit').single), {
          'seasonId': 1,
          'traktSeason': 1,
          'episodeOffset': 12,
        });
        await c.unlink(row);
        expect(s.sent(s.calls('/api/mappings/unlink').single), {'seasonId': 1});
        final show = c.links.firstWhere((r) => r.kind == 'show');
        await c.unlink(show);
        expect(s.sent(s.calls('/api/mappings/unlink').last), {
          'mappingId': show.mappingId,
        });
        await c.restore(show);
        expect(s.sent(s.calls('/api/mappings/unlink').last), {
          'mappingId': show.mappingId,
          'restore': true,
        });
      },
    );

    test('a failed change returns its error and keeps the page', () async {
      final s = FakeServer({
        '/api/mappings': (_) => recorded('011-getMappings'),
        '/api/mappings/reject': (_) => throw StateError('down'),
      });
      final c = MappingsController(s.api);
      await c.load();
      final error = await c.reject(c.data!.proposals.single);
      expect(error, isNotNull);
      expect(c.data, isNotNull);
      expect(c.busy, isNull);
    });
  });

  group('screen', () {
    testWidgets('phone: proposal, Confirm writes; Unlink asks first', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(420, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final s = server();
      await tester.pumpWidget(MaterialApp(home: MappingsScreen(api: s.api)));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('proposal:mal:950071')), findsOneWidget);
      expect(find.text('Same show by ID'), findsOneWidget);
      expect(find.byKey(const ValueKey('meaning:mal:950071')), findsOneWidget);
      expect(s.calls('/api/mappings/confirm'), isEmpty);
      await tester.tap(
        find.byKey(const ValueKey('proposal-confirm:mal:950071')),
      );
      await tester.pumpAndSettle();
      expect(s.calls('/api/mappings/confirm'), hasLength(1));

      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('link-menu:s:1')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const ValueKey('link-menu:s:1')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Unlink'));
      await tester.pumpAndSettle();
      expect(s.calls('/api/mappings/unlink'), isEmpty);
      await tester.tap(find.byKey(const ValueKey('unlink-confirm')));
      await tester.pumpAndSettle();
      expect(s.calls('/api/mappings/unlink'), hasLength(1));
    });

    testWidgets('wide: table; Unlink needs a second press', (tester) async {
      tester.view.physicalSize = const Size(1300, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final s = server();
      await tester.pumpWidget(MaterialApp(home: MappingsScreen(api: s.api)));
      await tester.pumpAndSettle();
      expect(find.text('Simkl / MAL entry'), findsOneWidget);
      final unlink = find.byKey(const ValueKey('row-unlink:s:1'));
      await tester.scrollUntilVisible(
        unlink,
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(unlink);
      await tester.pumpAndSettle();
      expect(find.text('Confirm unlink'), findsOneWidget);
      expect(s.calls('/api/mappings/unlink'), isEmpty);
      await tester.tap(unlink);
      await tester.pumpAndSettle();
      expect(s.calls('/api/mappings/unlink'), hasLength(1));
    });
  });
}
