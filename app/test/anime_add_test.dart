import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/up_next/poster.dart';
import 'package:tsuzuku/writes/anime_add.dart';
import 'package:tsuzuku/writes/write_flows.dart';
import 'package:tsuzuku/writes/write_sheets.dart' show searchDelay;

import 'writes_test.dart' show FakeServer, recorded;

// Add an anime on Shows (#108, step 3.6): AniList search (movies left out), preview per source for the chosen
// list, confirm only the ticked sources with their `expected`. Answers come from the golden fixtures.

List<Object?> searchWithMovie() => [
  ...(recorded('017-getAnilistSearch') as List),
  {
    'malId': 950099,
    'anilistId': 960099,
    'title': 'Moonfall Academy: The Movie',
    'format': 'MOVIE',
    'episodes': 1,
    'status': 'FINISHED',
    'year': 2025,
    'cover': null,
  },
];

FakeServer server({
  Object? Function(dynamic)? confirm,
  Object? Function(dynamic)? showConfirm,
}) => FakeServer({
  '/api/anilist/search': (_) => searchWithMovie(),
  '/api/trakt/search': (_) => recorded('049-getTraktSearch'),
  '/api/shows/add/preview': (_) => recorded('050-postShowsAddPreview'),
  '/api/shows/add/confirm':
      showConfirm ?? (_) => recorded('051-postShowsAddConfirm'),
  '/api/anime/add/preview': (_) => recorded('029-postAnimeAddPreview'),
  '/api/anime/add/confirm':
      confirm ?? (_) => recorded('041-postAnimeAddConfirm'),
});

const target = StartCandidate(
  malId: 950162,
  title: 'Tidewater Saints Season 2',
  format: 'TV',
  episodes: 12,
  status: 'RELEASING',
  year: 2026,
);

void main() {
  test('search leaves anime movies out and counts them', () async {
    final s = server();
    final flow = AnimeAddFlow(api: s.api)..query = 'Moonfall Academy';
    await flow.search();
    expect(flow.results!.map((r) => r.malId), [950031, 950032]);
    expect(flow.moviesLeftOut, 1);
  });

  test('a confirm without a preview sends nothing', () async {
    final s = server();
    final flow = AnimeAddFlow(api: s.api);
    expect(await flow.confirm(), isFalse);
    expect(s.adapter.requests, isEmpty);
  });

  test('pick previews for the list; the list change previews again', () async {
    final s = server();
    final flow = AnimeAddFlow(api: s.api);
    await flow.pick(target);
    expect(s.sent(s.calls('/api/anime/add/preview').single), {
      'malId': 950162,
      'status': 'watching',
    });
    await flow.setStatus('plan_to_watch');
    expect(
      s.sent(s.calls('/api/anime/add/preview').last)['status'],
      'plan_to_watch',
    );
    expect(flow.chosen, {'simkl'});
    expect(flow.plan!.skipped.single.source.toJson(), 'mal');
    expect(s.calls('/api/anime/add/confirm'), isEmpty);
  });

  test('confirm sends the ticked steps with expected', () async {
    final s = server();
    final flow = AnimeAddFlow(api: s.api);
    await flow.setStatus('plan_to_watch');
    await flow.pick(target);
    expect(await flow.confirm(), isTrue);
    expect(s.sent(s.calls('/api/anime/add/confirm').single), {
      'malId': 950162,
      'status': 'plan_to_watch',
      'steps': [
        {'source': 'simkl', 'expected': 'not_watching'},
      ],
    });
    expect(flow.wrote, isTrue);
    expect(flow.allDone, isTrue);
  });

  test('unticked: nothing to confirm', () async {
    final s = server();
    final flow = AnimeAddFlow(api: s.api);
    await flow.pick(target);
    flow.toggle('simkl', false);
    expect(await flow.confirm(), isFalse);
    expect(s.calls('/api/anime/add/confirm'), isEmpty);
  });

  test('a failed source keeps its error', () async {
    final s = server(
      confirm: (_) => {
        'outcomes': [
          {'source': 'simkl', 'ok': false, 'error': 'Simkl is down'},
        ],
      },
    );
    final flow = AnimeAddFlow(api: s.api);
    await flow.pick(target);
    expect(await flow.confirm(), isFalse);
    expect(flow.outcomes['simkl']!.error, 'Simkl is down');
    expect(flow.anyFailed, isTrue);
    expect(flow.pending, hasLength(1));
  });

  testWidgets('page: search, pick, preview with Trakt note, confirm', (
    tester,
  ) async {
    final s = server();
    final flow = AnimeAddFlow(api: s.api);
    await tester.pumpWidget(MaterialApp(home: AnimeAddScreen(flow: flow)));
    await tester.enterText(
      find.byKey(const ValueKey('anime-query')),
      'Moonfall Academy',
    );
    await tester.tap(find.text('Search'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('anime-result:950031')), findsOneWidget);
    expect(find.textContaining('1 anime movie left out'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('anime-pick:950031')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('note:trakt')), findsOneWidget);
    expect(find.byKey(const ValueKey('note:mal')), findsOneWidget);
    expect(find.text('Add to Watching on 1 source'), findsOneWidget);
    expect(s.calls('/api/anime/add/confirm'), isEmpty);
    await tester.tap(find.byKey(const ValueKey('write-confirm')));
    await tester.pumpAndSettle();
    expect(s.calls('/api/anime/add/confirm'), hasLength(1));
  });

  group('a show that is not anime (#105)', () {
    test('Show searches Trakt, not AniList, and keeps the title', () async {
      final s = server();
      final flow = AnimeAddFlow(api: s.api)..query = 'copper meridian';
      flow.setKind('show');
      await flow.search();
      expect(s.calls('/api/anilist/search'), isEmpty);
      expect(flow.showResults!.map((r) => r.title), [
        'Copper Valley',
        'Silver Meridian',
      ]);
      expect(flow.query, 'copper meridian');
    });

    test(
      'Watching previews S1E1 on Trakt and Simkl; confirm sends both',
      () async {
        final s = server();
        final flow = AnimeAddFlow(api: s.api)..setKind('show');
        flow.query = 'copper';
        await flow.search();
        await flow.pickShow(flow.showResults!.first);
        expect(s.sent(s.calls('/api/shows/add/preview').single), {
          'traktId': 900020,
          'status': 'watching',
        });
        expect(flow.chosen, {'trakt', 'simkl'});
        expect(s.calls('/api/shows/add/confirm'), isEmpty);
        expect(await flow.confirm(), isTrue);
        expect(s.sent(s.calls('/api/shows/add/confirm').single), {
          'traktId': 900020,
          'status': 'watching',
          'steps': [
            {'source': 'trakt', 'expected': 'not_on_up_next'},
            {'source': 'simkl', 'expected': 'not_watching'},
          ],
        });
        expect(flow.wrote, isTrue);
        expect(flow.allDone, isTrue);
      },
    );

    test('switching kind drops the pick and its preview', () async {
      final s = server();
      final flow = AnimeAddFlow(api: s.api)..setKind('show');
      flow.query = 'copper';
      await flow.search();
      await flow.pickShow(flow.showResults!.first);
      flow.setKind('anime');
      expect(flow.hasPick, isFalse);
      expect(flow.hasPlan, isFalse);
      expect(flow.showResults, isNull);
      expect(await flow.confirm(), isFalse);
      expect(s.calls('/api/shows/add/confirm'), isEmpty);
    });

    test('a failed source keeps its error, the other its tick', () async {
      final s = server(
        showConfirm: (_) => {
          'outcomes': [
            {'source': 'trakt', 'ok': true},
            {'source': 'simkl', 'ok': false, 'error': 'Simkl is down'},
          ],
        },
      );
      final flow = AnimeAddFlow(api: s.api)..setKind('show');
      flow.query = 'copper';
      await flow.search();
      await flow.pickShow(flow.showResults!.first);
      expect(await flow.confirm(), isFalse);
      expect(flow.isDone('trakt'), isTrue);
      expect(flow.outcomes['simkl']!.error, 'Simkl is down');
      expect(flow.pending.map((p) => p.source), ['simkl']);
    });

    testWidgets('page: Show, search, pick, MAL note, mark S1E1', (
      tester,
    ) async {
      final s = server();
      final flow = AnimeAddFlow(api: s.api);
      await tester.pumpWidget(MaterialApp(home: AnimeAddScreen(flow: flow)));
      await tester.tap(find.text('Show'));
      await tester.pumpAndSettle();
      expect(find.text('Add a show'), findsOneWidget);
      // The list is chosen once something is picked, not before.
      expect(find.byKey(const ValueKey('anime-status')), findsNothing);
      expect(find.byKey(const ValueKey('show-status-note')), findsNothing);
      await tester.enterText(
        find.byKey(const ValueKey('anime-query')),
        'copper',
      );
      await tester.tap(find.text('Search'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('show-pick:900020')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('note:mal')), findsOneWidget);
      expect(find.byKey(const ValueKey('step:trakt')), findsOneWidget);
      expect(find.byKey(const ValueKey('step:simkl')), findsOneWidget);
      expect(find.text('Mark S1E1 watched on 2 sources'), findsOneWidget);
      expect(find.byKey(const ValueKey('show-status-note')), findsOneWidget);
      await tester.tap(find.text('Plan to Watch'));
      await tester.pumpAndSettle();
      expect(s.sent(s.calls('/api/shows/add/preview').last), {
        'traktId': 900020,
        'status': 'plan_to_watch',
      });
      await tester.tap(find.text('Watching'));
      await tester.pumpAndSettle();
      expect(s.calls('/api/shows/add/preview'), hasLength(3));
      await tester.tap(find.byKey(const ValueKey('write-confirm')));
      await tester.pumpAndSettle();
      expect(s.calls('/api/shows/add/confirm'), hasLength(1));
    });
  });

  testWidgets('every result has a poster, the empty frame when none', (
    tester,
  ) async {
    final s = server();
    final flow = AnimeAddFlow(api: s.api);
    await tester.pumpWidget(MaterialApp(home: AnimeAddScreen(flow: flow)));
    await tester.enterText(
      find.byKey(const ValueKey('anime-query')),
      'Moonfall Academy',
    );
    await tester.tap(find.text('Search'));
    await tester.pumpAndSettle();
    Poster posterIn(String key) => tester.widget<Poster>(
      find.descendant(
        of: find.byKey(ValueKey(key)),
        matching: find.byType(Poster),
      ),
    );
    expect(posterIn('anime-result:950031').width, 48);
    await tester.tap(find.text('Show'));
    await tester.pumpAndSettle();
    expect(posterIn('show-result:900020').images, isEmpty);
  });

  testWidgets('typing searches once it pauses, without Enter', (tester) async {
    final s = server();
    final flow = AnimeAddFlow(api: s.api);
    await tester.pumpWidget(MaterialApp(home: AnimeAddScreen(flow: flow)));
    await tester.enterText(find.byKey(const ValueKey('anime-query')), 'Moon');
    await tester.pump(searchDelay ~/ 2);
    await tester.enterText(
      find.byKey(const ValueKey('anime-query')),
      'Moonfall Academy',
    );
    await tester.pump(searchDelay ~/ 2);
    expect(s.calls('/api/anilist/search'), isEmpty);
    await tester.pump(searchDelay);
    await tester.pumpAndSettle();
    expect(s.calls('/api/anilist/search'), hasLength(1));
    expect(find.byKey(const ValueKey('anime-result:950031')), findsOneWidget);
    await tester.tap(find.text('Show'));
    await tester.pumpAndSettle();
    expect(s.calls('/api/trakt/search'), hasLength(1));
  });
}
