import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/api/tsuzuku_api.dart';
import 'package:tsuzuku/movies/movie_flows.dart';
import 'package:tsuzuku/movies/movie_logic.dart';
import 'package:tsuzuku/movies/movie_sheets.dart';
import 'package:tsuzuku/movies/movies_screen.dart';

import 'support/adapters.dart';
import 'writes_test.dart' show FakeServer, fixtureNow, recorded;

// Movies (#108, step 3.6): row logic on the recorded list, and the add / mark writes: preview first, confirm only
// the previewed steps for the ticked sources. Answers come from the golden fixtures (api/fixtures/).

Movies movies() => GetMoviesResponse200.fromJson(
  (recorded('005-getMovies') as Map).cast<String, Object?>(),
);

MovieRow rowNamed(String title) =>
    movies().rows.firstWhere((r) => r.title == title);

Map<String, Object?> map(Object? o) => (o as Map).cast<String, Object?>();

void main() {
  group('movie rows', () {
    test('MAL shows only for anime', () {
      expect(movieSources(rowNamed('Midnight Lantern')), ['trakt', 'simkl']);
      expect(movieSources(rowNamed('Tidebound')), ['trakt', 'simkl', 'mal']);
    });

    test('each source keeps its own state', () {
      final r = rowNamed('The Salt Cartographer');
      expect(r.differs, isTrue);
      expect(movieStateLabel(movieCell(r, 'trakt').entry!), 'Watchlist');
      expect(movieStateTone(movieCell(r, 'trakt').entry!), MovieTone.primary);
      expect(movieStateTone(movieCell(r, 'simkl').entry!), MovieTone.success);
    });

    test('absent labels', () {
      final r = rowNamed('Cinder Bloom: The Movie');
      expect(absentLabel(movieCell(r, 'trakt')), 'not linked');
      expect(absentLabel(movieCell(r, 'simkl')), 'not on your lists');
    });

    test('offered for the other watchlists only when missing somewhere', () {
      expect(fillable(rowNamed('Midnight Lantern')), isFalse);
      expect(fillable(rowNamed('Northbound Static')), isTrue);
      expect(fillable(rowNamed('Tidebound')), isTrue);
    });

    test('source pages', () {
      final e = movieCell(rowNamed('Midnight Lantern'), 'trakt').entry!;
      expect(entryUrl(e), 'https://trakt.tv/movies/midnight-lantern');
      expect(
        movieUrl(
          'simkl',
          anime: true,
          ids: const MovieIds(simkl: 5, simklSlug: 'x'),
        ),
        'https://simkl.com/anime/5/x',
      );
      expect(
        movieUrl('mal', anime: true, ids: const MovieIds(mal: 9)),
        'https://myanimelist.net/anime/9',
      );
    });

    test('health from the answer', () {
      final h = movieHealth(movies(), fixtureNow);
      expect(h.map((s) => s.source), ['trakt', 'simkl', 'mal']);
      expect(h.every((s) => s.ok), isTrue);
    });
  });

  group('movie mark', () {
    FakeServer server({Object? Function(RequestOptions)? confirm}) =>
        FakeServer({
          '/api/movies/mark/preview': (_) =>
              recorded('025-postMoviesMarkPreview'),
          '/api/movies/mark/confirm':
              confirm ?? (_) => recorded('038-postMoviesMarkConfirm'),
        });

    test('a confirm without a preview sends nothing', () async {
      final s = server();
      final flow = MovieMarkFlow(api: s.api, rowKey: 'trakt:991007');
      expect(await flow.confirm(), isFalse);
      expect(s.adapter.requests, isEmpty);
    });

    test(
      'confirms only the ticked sources, with expected and rating',
      () async {
        final s = server();
        final flow = MovieMarkFlow(
          api: s.api,
          rowKey: 'trakt:991007',
          clock: () => fixtureNow,
        );
        await flow.preview();
        expect(flow.picked, {'trakt', 'simkl'});
        flow.toggle('simkl', false);
        flow.setScore(8);
        expect(await flow.confirm(), isTrue);
        final sent = s.sent(s.calls('/api/movies/mark/confirm').single);
        expect(sent['steps'], [
          {'source': 'trakt', 'expected': 'watchlist'},
        ]);
        expect(sent['rating'], 8);
        expect(sent['today'], '2026-10-09');
        expect(flow.wrote, isTrue);
      },
    );

    test('optional steps start unticked', () async {
      final s = FakeServer({
        '/api/movies/mark/preview': (_) {
          final p = map(recorded('025-postMoviesMarkPreview'));
          (p['steps'] as List).cast<Map>().last['optional'] = true;
          return p;
        },
      });
      final flow = MovieMarkFlow(api: s.api, rowKey: 'trakt:991007');
      await flow.preview();
      expect(flow.picked, {'trakt'});
    });

    test('a failed source keeps its error; retry sends only it', () async {
      var first = true;
      final s = server(
        confirm: (_) {
          if (first) {
            first = false;
            return {
              'outcomes': [
                {'source': 'trakt', 'ok': true},
                {'source': 'simkl', 'ok': false, 'error': 'Simkl is down'},
              ],
            };
          }
          return {
            'outcomes': [
              {'source': 'simkl', 'ok': true},
            ],
          };
        },
      );
      final flow = MovieMarkFlow(api: s.api, rowKey: 'trakt:991007');
      await flow.preview();
      expect(await flow.confirm(), isFalse);
      expect(flow.outcomes['simkl']!.error, 'Simkl is down');
      expect(flow.pending.map((p) => p.source.toJson()), ['simkl']);
      expect(await flow.confirm(), isTrue);
      final retry = s.sent(s.calls('/api/movies/mark/confirm').last);
      expect((retry['steps'] as List).single['source'], 'simkl');
    });
  });

  group('movie add', () {
    FakeServer server() => FakeServer({
      '/api/movies/search': (o) => o.uri.queryParameters['from'] == 'tmdb'
          ? recorded('018-getMoviesSearch')
          : recorded('019-getMoviesSearch'),
      '/api/movies/add/preview': (o) {
        final body = (o.data is String) ? o.data as String : '';
        return body.contains('rowKey')
            ? recorded('027-postMoviesAddPreview')
            : recorded('026-postMoviesAddPreview');
      },
      '/api/movies/add/confirm': (_) => recorded('039-postMoviesAddConfirm'),
      '/api/movies/link-titles': (_) => recorded('022-getMoviesLinkTitles'),
      '/api/movies/link-search': (_) => recorded('020-getMoviesLinkSearch'),
    });

    test('search, pick, preview, confirm the ticked sources', () async {
      final s = server();
      final flow = MovieAddFlow(api: s.api)..query = 'the';
      await flow.search();
      expect(flow.results!.first.listedOn, ['trakt', 'simkl']);
      expect(await flow.confirm(), isFalse);
      await flow.pick(flow.results!.firstWhere((r) => r.id == 991009));
      expect(flow.chosen, {'trakt', 'simkl'});
      expect(flow.plan!.malSearch, isTrue);
      // Not anime: MAL's search opens only on asking.
      expect(flow.sides['mal']!.open, isFalse);
      flow.toggle('trakt', false);
      expect(await flow.confirm(), isTrue);
      final sent = s.sent(s.calls('/api/movies/add/confirm').single);
      expect(sent['from'], 'tmdb');
      expect(sent['id'], 991009);
      expect(sent['steps'], [
        {'source': 'simkl'},
      ]);
      expect(sent.containsKey('rowKey'), isFalse);
    });

    test('a pick on Trakt previews again with its ID', () async {
      final s = server();
      final flow = MovieAddFlow(api: s.api);
      await flow.pick(
        const MovieChoice(id: 991009, title: 'Library in the Fog', url: 'u'),
      );
      await flow.openSide('trakt');
      expect(flow.sides['trakt']!.query, 'Library in the Fog');
      final c = flow.sides['trakt']!.results!.single;
      expect(c.onList, isTrue);
      await flow.pickSide('trakt', c);
      final preview = s.sent(s.calls('/api/movies/add/preview').last);
      expect(preview['traktId'], 991007);
      expect(s.calls('/api/movies/add/confirm'), isEmpty);
    });

    test(
      'a row opens on its preview; skipped sources, nothing to add',
      () async {
        final s = server();
        final flow = MovieAddFlow(
          api: s.api,
          rowKey: 'trakt:991007',
          title: 'Midnight Lantern',
        );
        await flow.preview();
        expect(flow.plan!.steps, isEmpty);
        expect(flow.plan!.skipped.length, 2);
        expect(flow.titles, ['Midnight Lantern']);
        expect(await flow.confirm(), isFalse);
        final preview = s.sent(s.calls('/api/movies/add/preview').single);
        expect(preview, {'rowKey': 'trakt:991007'});
      },
    );
  });

  group('movies screen', () {
    TsuzukuApi fixtureApi() => TsuzukuApi(
      Dio(BaseOptions(baseUrl: 'https://tsuzuku.test'))
        ..httpClientAdapter = FixtureAdapter('demo'),
    );

    testWidgets('cards; opening one shows each source', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MoviesView(api: fixtureApi(), clock: () => fixtureNow),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Midnight Lantern'), findsOneWidget);
      expect(find.text('differs'), findsWidgets);
      await tester.tap(find.text('The Salt Cartographer'));
      await tester.pumpAndSettle();
      final key = rowNamed('The Salt Cartographer').key;
      expect(find.byKey(ValueKey('movie-source:$key:trakt')), findsOneWidget);
      expect(find.byKey(ValueKey('movie-source:$key:simkl')), findsOneWidget);
      expect(find.byKey(ValueKey('movie-source:$key:mal')), findsNothing);
      expect(find.text('Watchlist'), findsOneWidget);
      expect(find.text('Completed'), findsOneWidget);
    });

    testWidgets('mark sheet: rating and steps, confirm writes', (tester) async {
      final s = FakeServer({
        '/api/movies/mark/preview': (_) =>
            recorded('025-postMoviesMarkPreview'),
        '/api/movies/mark/confirm': (_) =>
            recorded('038-postMoviesMarkConfirm'),
      });
      final flow = MovieMarkFlow(api: s.api, rowKey: 'trakt:991007');
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MovieMarkSheet(flow: flow, title: 'Midnight Lantern'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Mark on 2 sources'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('pick:simkl')));
      await tester.pump();
      expect(find.text('Mark on 1 source'), findsOneWidget);
      expect(s.calls('/api/movies/mark/confirm'), isEmpty);
      await tester.tap(find.byKey(const ValueKey('write-confirm')));
      await tester.pumpAndSettle();
      expect(s.calls('/api/movies/mark/confirm'), hasLength(1));
    });
  });
}
