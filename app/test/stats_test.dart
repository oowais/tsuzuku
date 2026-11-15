import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/api/tsuzuku_api.dart';
import 'package:tsuzuku/stats/stats_logic.dart';
import 'package:tsuzuku/stats/stats_screen.dart';

import 'writes_test.dart' show FakeServer, recorded;

// Stats (#108, step 3.6): each source's own figures, never added up; history and marks in local time. Answers come
// from the golden fixtures (api/fixtures/).

GetStatsResponse200 stats() => GetStatsResponse200.fromJson(
  (recorded('007-getStats') as Map).cast<String, Object?>(),
);

Figure fig(num v, [String? unit]) =>
    Figure.fromJson({'label': 'x', 'value': v, 'unit': ?unit});

void main() {
  test('figures as legacy shows them', () {
    expect(showFigure(fig(71240, 'minutes')), '49.5 days');
    expect(showFigure(fig(410, 'minutes')), '6.8 h');
    expect(showFigure(fig(16.7, 'days')), '16.7 days');
    expect(showFigure(fig(7.62, 'score')), '7.62');
    expect(showFigure(fig(2516)), '2,516');
    expect(formatNumber(1203), '1,203');
    expect(formatNumber(3.25), '3.3');
  });

  test('history: week from Monday, month, 4-week average, local time', () {
    final now = DateTime(2026, 10, 15, 12); // a Thursday
    final recent = [
      DateTime(2026, 10, 14, 20), // this week
      DateTime(2026, 10, 12, 1), // Monday, this week
      DateTime(2026, 10, 11, 23), // Sunday before
      DateTime(2026, 10, 1, 9), // this month
      DateTime(2026, 9, 25), // in the last 4 weeks, last month
      DateTime(2026, 8, 1), // older
    ].map((d) => d.toUtc().toIso8601String()).toList();
    final h = historyFigures(recent, now)!;
    expect(h.week, 2);
    expect(h.month, 4);
    expect(h.weeklyAverage, 5 / 4);
    expect(historyFigures(null, now), isNull);
  });

  test('marks per day: 30 columns, today last, failures apart', () {
    final now = DateTime(2026, 10, 15, 12);
    GetStatsResponse200WritesItemRecentItem m(DateTime d, bool ok) =>
        GetStatsResponse200WritesItemRecentItem(
          at: d.toUtc().toIso8601String(),
          ok: ok,
        );
    final days = marksByDay([
      m(DateTime(2026, 10, 15, 8), true),
      m(DateTime(2026, 10, 15, 9), false),
      m(DateTime(2026, 10, 14, 22), true),
      m(DateTime(2026, 9, 1), true), // too old
    ], now);
    expect(days.length, 30);
    expect(days.last, (ok: 1, failed: 1));
    expect(days[28], (ok: 1, failed: 0));
    expect(days.take(28).every((d) => d.ok == 0 && d.failed == 0), isTrue);
    expect(daysAgo(29), 'Today');
    expect(daysAgo(28), 'Yesterday');
    expect(daysAgo(0), '29 days ago');
  });

  test('breakdown totals per list, never across sources', () {
    final simkl = stats().sources.firstWhere(
      (s) => s.source.toJson() == 'simkl',
    );
    expect(simkl.breakdowns.map(breakdownTotal), [46, 53, 51]);
  });

  testWidgets('screen: a card per source; refresh asks again', (tester) async {
    tester.view.physicalSize = const Size(420, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final s = FakeServer({
      '/api/stats': (o) => o.uri.queryParameters['refresh'] == '1'
          ? recorded('008-getStats')
          : recorded('007-getStats'),
    });
    await tester.pumpWidget(
      MaterialApp(
        home: StatsScreen(api: s.api, clock: () => DateTime(2026, 10, 9, 14)),
      ),
    );
    await tester.pumpAndSettle();
    for (final src in ['trakt', 'simkl', 'mal']) {
      expect(find.byKey(ValueKey('stats:$src')), findsOneWidget);
    }
    expect(find.text('49.5 days'), findsOneWidget);
    expect(find.text('7.62'), findsOneWidget);
    expect(find.text('Your ratings'), findsOneWidget);
    expect(s.calls('/api/stats').single.uri.queryParameters, isEmpty);
    await tester.tap(find.byKey(const ValueKey('stats-refresh')));
    await tester.pumpAndSettle();
    expect(s.calls('/api/stats').last.uri.queryParameters['refresh'], '1');
  });

  testWidgets('wide: three across, marks cards', (tester) async {
    tester.view.physicalSize = const Size(1300, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final s = FakeServer({'/api/stats': (_) => recorded('007-getStats')});
    await tester.pumpWidget(
      MaterialApp(
        home: StatsScreen(api: s.api, clock: () => DateTime(2026, 10, 9, 14)),
      ),
    );
    await tester.pumpAndSettle();
    final trakt = tester.getTopLeft(find.byKey(const ValueKey('stats:trakt')));
    final mal = tester.getTopLeft(find.byKey(const ValueKey('stats:mal')));
    expect(trakt.dy, mal.dy);
    expect(find.byKey(const ValueKey('marks:simkl')), findsOneWidget);
    expect(find.text('Marked from Tsuzuku'), findsOneWidget);
  });
}
