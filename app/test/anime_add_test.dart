import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/writes/anime_add.dart';
import 'package:tsuzuku/writes/write_flows.dart';

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

FakeServer server({Object? Function(dynamic)? confirm}) => FakeServer({
  '/api/anilist/search': (_) => searchWithMovie(),
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

  testWidgets('sheet: search, pick, preview with Trakt note, confirm', (
    tester,
  ) async {
    final s = server();
    final flow = AnimeAddFlow(api: s.api);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: AnimeAddSheet(flow: flow)),
      ),
    );
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
}
