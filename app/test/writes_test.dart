import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/api/tsuzuku_api.dart';
import 'package:tsuzuku/up_next/up_next_logic.dart';
import 'package:tsuzuku/up_next/up_next_screen.dart';
import 'package:tsuzuku/writes/coming_back.dart';
import 'package:tsuzuku/writes/log_groups.dart';
import 'package:tsuzuku/writes/write_flows.dart';
import 'package:tsuzuku/writes/write_log_screen.dart';
import 'package:tsuzuku/writes/write_sheets.dart';

import 'support/adapters.dart';

// The writes (#108, step 3.5): preview first, confirm only what the preview planned for the sources you
// left ticked, each source's error on its own line. Answers come from the golden fixtures (api/fixtures/).

Object? recorded(String c, {String scenario = 'demo'}) => (jsonDecode(
  File('../api/fixtures/$scenario/cases/$c/response.json').readAsStringSync(),
) as Map)['body'];

final fixtureNow = DateTime.utc(2026, 10, 9, 12);

/// A fake server: `answers[path]` gives the body (or a [ResponseBody]) for each call; every request is kept.
class FakeServer {
  FakeServer(this.answers);

  final Map<String, Object? Function(RequestOptions o)> answers;
  late final adapter = ScriptedAdapter((o) {
    final answer = answers[o.uri.path];
    if (answer == null) throw StateError('Unexpected ${o.method} ${o.uri}');
    final body = answer(o);
    return body is ResponseBody ? body : jsonBody(body);
  });
  late final api = TsuzukuApi(
    Dio(BaseOptions(baseUrl: 'https://tsuzuku.test'))
      ..httpClientAdapter = adapter,
  );

  List<RequestOptions> calls(String path) =>
      adapter.requests.where((r) => r.uri.path == path).toList();

  Map<String, Object?> sent(RequestOptions o) =>
      (jsonDecode(o.data as String) as Map).cast<String, Object?>();
}

Map<String, Object?> markPreview() =>
    (recorded('023-postMarkPreview') as Map).cast<String, Object?>();

/// The recorded preview with Simkl's step on the last episode: statuses offered, Completed suggested.
Map<String, Object?> markPreviewWithAfter() {
  final p = markPreview();
  final steps = (p['steps'] as List).cast<Map<String, Object?>>();
  final simkl = steps.firstWhere((s) => s['source'] == 'simkl');
  simkl['after'] = {
    'options': ['completed', 'hold', 'dropped'],
    'suggested': 'completed',
  };
  simkl['note'] = 'to history, completed';
  return p;
}

const confirmPath = '/api/mark/confirm';

void main() {
  group('mark watched', () {
    test('a confirm without a preview sends nothing', () async {
      final server = FakeServer({
        confirmPath: (_) => {'outcomes': []},
      });
      final flow = MarkFlow(api: server.api, rowKey: 'm:1');
      expect(await flow.confirm(), isFalse);
      expect(server.adapter.requests, isEmpty);
    });

    test('a failed preview leaves nothing to confirm', () async {
      final server = FakeServer({
        '/api/mark/preview': (_) =>
            jsonBody(recorded('024-postMarkPreview-404'), status: 404),
        confirmPath: (_) => {'outcomes': []},
      });
      final flow = MarkFlow(api: server.api, rowKey: 'no-such-row');
      await flow.preview();
      expect(
        flow.loadError,
        'This show is no longer on Shows; reload the page',
      );
      expect(await flow.confirm(), isFalse);
      expect(server.calls(confirmPath), isEmpty);
    });

    test(
      'confirms the previewed steps with their expected state, in one call',
      () async {
        final server = FakeServer({
          '/api/mark/preview': (_) => markPreview(),
          confirmPath: (_) => recorded('037-postMarkConfirm'),
        });
        final flow = MarkFlow(
          api: server.api,
          rowKey: 'm:1',
          signature: 'mal:1x17|simkl:1x17|trakt:1x17',
          clock: () => DateTime(2026, 10, 9, 23),
        );
        await flow.preview();
        expect(server.sent(server.calls('/api/mark/preview').single), {
          'rowKey': 'm:1',
          'signature': 'mal:1x17|simkl:1x17|trakt:1x17',
        });
        expect(flow.picked, {'trakt', 'simkl', 'mal'});
        expect(await flow.confirm(), isTrue);
        // The recorded request (037): exactly what the preview planned.
        expect(
          server.sent(server.calls(confirmPath).single),
          (jsonDecode(
            File('../api/fixtures/demo/cases/037-postMarkConfirm/request.json')
                .readAsStringSync(),
          ) as Map)['body'],
        );
        expect(flow.wrote, isTrue);
      },
    );

    test('only ticked sources are written', () async {
      final server = FakeServer({
        '/api/mark/preview': (_) => markPreview(),
        confirmPath: (_) => {
          'outcomes': [
            {'source': 'trakt', 'ok': true},
            {'source': 'mal', 'ok': true},
          ],
        },
      });
      final flow = MarkFlow(api: server.api, rowKey: 'm:1');
      await flow.preview();
      flow.toggle('simkl', false);
      await flow.confirm();
      final steps = server.sent(server.calls(confirmPath).single)['steps'];
      expect(
        [for (final s in steps as List) (s as Map)['source']],
        ['trakt', 'mal'],
      );
    });

    test('nothing ticked: nothing to confirm', () async {
      final server = FakeServer({
        '/api/mark/preview': (_) => markPreview(),
        confirmPath: (_) => {'outcomes': []},
      });
      final flow = MarkFlow(api: server.api, rowKey: 'm:1');
      await flow.preview();
      for (final s in ['trakt', 'simkl', 'mal']) {
        flow.toggle(s, false);
      }
      expect(flow.pending, isEmpty);
      expect(await flow.confirm(), isFalse);
      expect(server.calls(confirmPath), isEmpty);
    });

    test(
      'a failed source keeps its error; the retry sends only that source',
      () async {
        var round = 0;
        final server = FakeServer({
          '/api/mark/preview': (_) => markPreview(),
          confirmPath: (_) => round++ == 0
              ? {
                  'outcomes': [
                    {'source': 'trakt', 'ok': true},
                    {'source': 'simkl', 'ok': false, 'error': 'HTTP 503'},
                    {'source': 'mal', 'ok': true},
                  ],
                }
              : {
                  'outcomes': [
                    {'source': 'simkl', 'ok': true},
                  ],
                },
        });
        final flow = MarkFlow(api: server.api, rowKey: 'm:1');
        await flow.preview();
        expect(await flow.confirm(), isFalse);
        expect(flow.outcomes['simkl']!.error, 'HTTP 503');
        expect(flow.anyFailed, isTrue);
        expect(flow.pending.map((s) => s.source.toJson()), ['simkl']);
        expect(await flow.confirm(), isTrue);
        final retry = server.sent(server.calls(confirmPath).last)['steps'];
        expect(
          [for (final s in retry as List) (s as Map)['source']],
          ['simkl'],
        );
      },
    );

    test('a failed call marks every pending source failed', () async {
      final server = FakeServer({
        '/api/mark/preview': (_) => markPreview(),
        confirmPath: (_) =>
            jsonBody({'statusMessage': 'Simkl is rate limited'}, status: 429),
      });
      final flow = MarkFlow(api: server.api, rowKey: 'm:1');
      await flow.preview();
      expect(await flow.confirm(), isFalse);
      expect(flow.outcomes.keys, {'trakt', 'simkl', 'mal'});
      expect(flow.outcomes.values.map((o) => o.error).toSet(), {
        'Simkl is rate limited',
      });
      expect(flow.wrote, isFalse);
    });

    test(
      '"Keep watching" sends status null; the suggestion is sent as picked',
      () async {
        final server = FakeServer({
          '/api/mark/preview': (_) => markPreviewWithAfter(),
          confirmPath: (_) => {'outcomes': []},
        });
        final flow = MarkFlow(api: server.api, rowKey: 'm:1');
        await flow.preview();
        expect(flow.after['simkl'], 'completed');
        await flow.confirm();
        Map<Object?, Object?> simklStep() =>
            (server.sent(server.calls(confirmPath).last)['steps'] as List)
                .cast<Map<Object?, Object?>>()
                .firstWhere((s) => s['source'] == 'simkl');
        expect(simklStep()['status'], 'completed');

        await flow.preview();
        flow.setAfter('simkl', leave);
        await flow.confirm();
        expect(simklStep().containsKey('status'), isTrue);
        expect(simklStep()['status'], isNull);
        // Steps without `after` send no status at all.
        final trakt =
            (server.sent(server.calls(confirmPath).last)['steps'] as List)
                .cast<Map<Object?, Object?>>()
                .firstWhere((s) => s['source'] == 'trakt');
        expect(trakt.containsKey('status'), isFalse);
      },
    );

    testWidgets('the sheet: untick, confirm, per-source error, retry', (
      tester,
    ) async {
      final server = FakeServer({
        '/api/mark/preview': (_) => markPreview(),
        confirmPath: (_) => {
          'outcomes': [
            {'source': 'trakt', 'ok': true},
            {'source': 'mal', 'ok': false, 'error': 'MAL shows 5 watched now'},
          ],
        },
      });
      final flow = MarkFlow(api: server.api, rowKey: 'm:1');
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MarkSheet(
              flow: flow,
              title: 'Moonfall Academy',
              clock: () => fixtureNow,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('S1E17 · “The Second Bell”'), findsOneWidget);
      expect(find.text('Mark watched on 3 sources'), findsOneWidget);
      // No write yet: only the preview was asked for.
      expect(server.calls(confirmPath), isEmpty);

      await tester.tap(find.byKey(const ValueKey('pick:simkl')));
      await tester.pump();
      expect(find.text('Mark watched on 2 sources'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('write-confirm')));
      await tester.pumpAndSettle();
      final steps = server.sent(server.calls(confirmPath).single)['steps'];
      expect(
        [for (final s in steps as List) (s as Map)['source']],
        ['trakt', 'mal'],
      );
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('error:mal')),
          matching: find.text('MAL shows 5 watched now'),
        ),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('error:trakt')), findsNothing);
      expect(find.text('Retry'), findsOneWidget);
    });
  });

  group('start next season', () {
    Map<String, Object?> plan() =>
        (recorded('028-postNextSeasonPreview') as Map).cast<String, Object?>();

    test('a confirm without a preview sends nothing', () async {
      final server = FakeServer({
        '/api/next-season/confirm': (_) =>
            recorded('040-postNextSeasonConfirm'),
      });
      final flow = StartFlow(api: server.api, rowKey: 'm:13', title: 'x');
      expect(await flow.confirm(), isFalse);
      expect(server.adapter.requests, isEmpty);
    });

    test('confirms the previewed target and ticked steps', () async {
      final server = FakeServer({
        '/api/next-season/preview': (_) => plan(),
        '/api/next-season/confirm': (_) =>
            recorded('040-postNextSeasonConfirm'),
      });
      final flow = StartFlow(
        api: server.api,
        rowKey: 'm:13',
        title: 'Glass Harbor',
      );
      await flow.preview();
      expect(flow.target!.title, 'Glass Harbor Season 2');
      expect(await flow.confirm(), isTrue);
      expect(
        server.sent(server.calls('/api/next-season/confirm').single),
        (jsonDecode(
          File(
            '../api/fixtures/demo/cases/040-postNextSeasonConfirm/request.json',
          ).readAsStringSync(),
        ) as Map)['body'],
      );
    });

    test('an unticked source is not written; errors stay per source', () async {
      final server = FakeServer({
        '/api/next-season/preview': (_) => plan(),
        '/api/next-season/confirm': (_) => {
          'outcomes': [
            {'source': 'mal', 'ok': false, 'error': 'already on your list'},
          ],
          'linkError': null,
          'placement': null,
        },
      });
      final flow = StartFlow(
        api: server.api,
        rowKey: 'm:13',
        title: 'Glass Harbor',
      );
      await flow.preview();
      flow.toggle('simkl', false);
      expect(await flow.confirm(), isFalse);
      final sent = server.sent(server.calls('/api/next-season/confirm').single);
      expect(sent['steps'], [
        {'source': 'mal', 'expected': 'none'},
      ]);
      expect(flow.outcomes['mal']!.error, 'already on your list');
      expect(flow.outcomes.containsKey('simkl'), isFalse);
    });

    test('a search result is previewed, never written directly', () async {
      final server = FakeServer({
        '/api/next-season/preview': (o) {
          final body = (jsonDecode(o.data as String) as Map);
          return body['malId'] == null
              ? {
                  ...plan(),
                  'target': null,
                  'placement': null,
                  'steps': [],
                  'needsSearch': true,
                }
              : plan();
        },
        '/api/anilist/search': (_) => recorded('017-getAnilistSearch'),
      });
      final flow = StartFlow(
        api: server.api,
        rowKey: 't:1',
        title: 'Moonfall Academy',
        search: true,
      );
      await flow.preview();
      await pumpEventQueue();
      expect(flow.searching, isTrue);
      expect(flow.results!.map((r) => r.malId), [950031, 950032]);
      await flow.pick(flow.results!.last);
      expect(
        server.sent(server.calls('/api/next-season/preview').last)['malId'],
        950032,
      );
      expect(server.calls('/api/next-season/confirm'), isEmpty);
    });
  });

  group('accept and coming back', () {
    testWidgets('accept and undo save on the server and update the card', (
      tester,
    ) async {
      final server = FakeServer({
        '/api/up-next': (_) => recorded('004-getUpNext'),
        '/api/up-next/accept': (_) => {'ok': true},
        '/api/up-next/undo-accept': (_) => {'ok': true},
        '/api/coming-back': (_) => recorded('009-getComingBack'),
      });
      tester.view.physicalSize = const Size(420, 6000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: UpNextView(
              load: () => server.api.upNext.getUpNext(),
              clock: () => fixtureNow,
              api: server.api,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      // Iron Petals' difference is accepted in the fixture: undo, then accept again.
      await tester.tap(find.text('Iron Petals'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Undo'));
      await tester.pumpAndSettle();
      expect(server.sent(server.calls('/api/up-next/undo-accept').single), {
        'rowKey': 'm:2',
      });
      await tester.tap(find.text('Accept difference').first);
      await tester.pumpAndSettle();
      expect(server.sent(server.calls('/api/up-next/accept').single), {
        'rowKey': 'm:2',
        'signature': 'mal:1x7|simkl:1x8|trakt:1x8',
      });
      expect(find.text('Difference accepted'), findsOneWidget);
      // No source was written, and the list was not fetched again.
      expect(server.calls('/api/up-next'), hasLength(1));
    });

    testWidgets('a show nothing links offers its Coming back sequel', (
      tester,
    ) async {
      final server = FakeServer({
        '/api/up-next': (_) => recorded('004-getUpNext'),
        '/api/coming-back': (_) => recorded('009-getComingBack'),
      });
      tester.view.physicalSize = const Size(420, 6000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: UpNextView(
              load: () => server.api.upNext.getUpNext(),
              clock: () => fixtureNow,
              api: server.api,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('sequel-offer:950162')), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('sequel-offer:950162')),
          matching: find.text('Season 2'),
        ),
        findsOneWidget,
      );
    });

    test('dismiss and undo, reverted when the server refuses', () async {
      var fail = false;
      final server = FakeServer({
        '/api/coming-back': (_) => recorded('009-getComingBack'),
        '/api/coming-back/dismiss': (_) => fail
            ? jsonBody({'statusMessage': 'nope'}, status: 500)
            : {'ok': true},
        '/api/coming-back/undo-dismiss': (_) => {'ok': true},
      });
      final c = ComingBackController(server.api);
      await c.load();
      final s = c.shown.first;
      await c.setDismissed(s, true);
      expect(server.sent(server.calls('/api/coming-back/dismiss').single), {
        'malId': 950162,
      });
      expect(c.dismissed.map((d) => d.malId), [950162]);
      await c.setDismissed(s, false);
      expect(c.dismissed, isEmpty);
      fail = true;
      await c.setDismissed(s, true);
      expect(c.dismissed, isEmpty);
      expect(c.error, 'nope');
    });

    test('sequels match a show by title, "Season N" ignored', () {
      final data = ComingBackResult.fromJson(
        (recorded('009-getComingBack') as Map).cast<String, Object?>(),
      );
      expect(
        sequelsForShow('Tidewater Saints', data.sequels).map((s) => s.malId),
        [950162],
      );
      expect(
        sequelsForShow(
          'Glass Harbor Season 2',
          data.sequels,
        ).map((s) => s.malId),
        [950142],
      );
      expect(sequelsForShow('Quiet Orbit', data.sequels), isEmpty);
    });
  });

  group('write log', () {
    // Port of legacy test/log-groups.test.ts; days in UTC so the tests don't depend on the time zone.
    final t = DateTime.utc(2026, 10, 9, 20);
    String utcDay(DateTime d) => d.toUtc().toIso8601String().substring(0, 10);
    var id = 0;
    LogEntry entry(
      double minutesAgo,
      String source, {
      String? markId,
      String rowKey = 'm:1',
      String? title,
      String result = 'ok',
      List<String> images = const [],
    }) => LogEntry.fromJson({
      'id': ++id,
      'at': t
          .subtract(Duration(seconds: (minutesAgo * 60).round()))
          .toIso8601String(),
      'source': source,
      'action': 'mark_watched',
      'rowKey': rowKey,
      'markId': markId,
      'title': title ?? '$source title',
      'episode': 'E1',
      'summary': 's',
      'listStatus': null,
      'images': images,
      'result': result,
      'error': result == 'error' ? 'HTTP 503' : null,
      'url': null,
      'episodeUrl': null,
    });

    test('one group per calendar day', () {
      final days = groupLog([
        entry(0, 'trakt'),
        entry(179, 'trakt'),
        entry(600, 'trakt'),
        entry(1201, 'trakt'),
      ], dayOf: utcDay);
      expect(days.map((s) => s.marks.length), [3, 1]);
      expect(days[0].end, t);
      expect(days[0].start, t.subtract(const Duration(minutes: 600)));
    });

    test('one mark per confirm, in Trakt, Simkl, MAL order', () {
      final s = groupLog([
        entry(0, 'mal', markId: 'a', title: 'Getsuraku Gakuen Part 2'),
        entry(0, 'trakt', markId: 'a', title: 'Moonfall Academy'),
        entry(0, 'simkl', markId: 'a', result: 'error'),
        entry(5, 'trakt', markId: 'b', rowKey: 'm:2'),
      ], dayOf: utcDay).single;
      expect(s.marks, hasLength(2));
      expect(s.marks[0].title, 'Moonfall Academy');
      expect(s.marks[0].ok, isFalse);
      expect(s.marks[0].entries.map((e) => e.source.toJson()), [
        'trakt',
        'simkl',
        'mal',
      ]);
      expect(s.shows, 2);
    });

    test('older entries without a markId join by time and source', () {
      final s = groupLog([
        entry(0, 'trakt', markId: 'x'),
        entry(2, 'trakt', markId: 'y'),
        entry(30, 'trakt'),
        entry(30.5, 'mal'),
        entry(40, 'trakt'),
      ], dayOf: utcDay).single;
      expect(s.marks.map((m) => m.entries.length), [1, 1, 2, 1]);
    });

    test('a mark takes the poster of the first entry that has one', () {
      final s = groupLog([
        entry(0, 'trakt', markId: 'a'),
        entry(0, 'mal', markId: 'a', images: ['https://img/poster.jpg']),
        entry(5, 'trakt', markId: 'b', rowKey: 'm:2'),
      ], dayOf: utcDay).single;
      expect(s.marks.map((m) => m.images), [
        ['https://img/poster.jpg'],
        <String>[],
      ]);
      expect(groupLog([]), isEmpty);
    });

    testWidgets('the page shows each source with its own result', (
      tester,
    ) async {
      final entries = [
        for (final e in recorded('010-getWriteLog') as List)
          LogEntry.fromJson((e as Map).cast<String, Object?>()),
      ];
      tester.view.physicalSize = const Size(420, 3000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: WriteLogScreen(
            load: () async => entries,
            clock: () => fixtureNow,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Nothing written yet.'), findsNothing);
      for (final e in entries) {
        expect(find.byKey(ValueKey('log-entry:${e.id}')), findsOneWidget);
      }
    });
  });

  test('a row changed in JSON decodes again', () {
    final data = UpNext.fromJson(
      (recorded('004-getUpNext') as Map).cast<String, Object?>(),
    );
    final json = data.toJson();
    (json['rows'] as List).cast<Map<String, Object?>>().first['accepted'] =
        true;
    expect(UpNext.fromJson(jsonRoundTrip(json)).rows.first.accepted, isTrue);
  });

  test('list status labels', () {
    expect(listStatusLabel('hold'), 'On hold');
    expect(listStatusLabel('odd'), 'odd');
  });
}
