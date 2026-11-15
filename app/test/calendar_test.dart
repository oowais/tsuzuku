import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/api/tsuzuku_api.dart';
import 'package:tsuzuku/calendar/calendar_logic.dart';
import 'package:tsuzuku/calendar/calendar_screen.dart';

import 'writes_test.dart' show FakeServer, recorded;

// Calendar (#108, step 3.6): per source, never merged; date-only items keep their written date; one show's items
// from several sources sit together. Answers come from the golden fixtures (api/fixtures/).

GetCalendarResponse200 calendar() => GetCalendarResponse200.fromJson(
  (recorded('006-getCalendar') as Map).cast<String, Object?>(),
);

final today = DateTime(2026, 10, 10, 9);

void main() {
  test('month query: local month start to next month start, in UTC', () {
    final q = monthQuery(today, 0);
    expect(DateTime.parse(q.from).toLocal(), DateTime(2026, 10, 1));
    expect(DateTime.parse(q.to).toLocal(), DateTime(2026, 11, 1));
    expect(
      DateTime.parse(monthQuery(today, 1).to).toLocal(),
      DateTime(2026, 12, 1),
    );
    expect(monthStart(DateTime(2026, 1, 15), -1), DateTime(2025, 12, 1));
  });

  test('a date-only item keeps its written date; others their local day', () {
    final items = calendar().items;
    final simkl = items.firstWhere((i) => i.dateOnly);
    expect(itemDay(simkl), simkl.airsAt);
    expect(itemTime(simkl), isNull);
    final trakt = items.firstWhere((i) => !i.dateOnly);
    expect(itemDay(trakt), dayKey(DateTime.parse(trakt.airsAt).toLocal()));
    expect(itemTime(trakt), matches(RegExp(r'^\d\d:\d\d$')));
  });

  test('one show from several sources is one group; both dates kept', () {
    final days = byDay(calendar().items);
    final starling = [
      for (final groups in days.values)
        for (final g in groups)
          if (g.first.group == 'm:12') g,
    ];
    // Simkl's date and Trakt's both show; never merged into one.
    final sources = {
      for (final g in starling)
        for (final i in g) i.source.toJson(),
    };
    expect(sources, containsAll(['simkl', 'trakt']));
    final all = starling.expand((g) => g).length;
    expect(all, calendar().items.where((i) => i.group == 'm:12').length);
  });

  test('grid: Monday-first weeks, padded', () {
    final cells = monthCells(DateTime(2026, 10, 1)); // a Thursday
    expect(cells.length % 7, 0);
    expect(cells.take(3), everyElement(isNull));
    expect(cells[3]!.key, '2026-10-01');
    expect(cells.whereType<({String key, int day})>().length, 31);
  });

  test('agenda starts today; earlier days counted only this month', () {
    final days = byDay(calendar().items);
    final month = monthDays(days, DateTime(2026, 10, 1));
    expect(
      month.map((e) => e.key),
      orderedEquals([...month.map((e) => e.key)]..sort()),
    );
    expect(earlierDays(month, '2026-10-12', thisMonth: true), greaterThan(0));
    expect(earlierDays(month, '2026-10-12', thisMonth: false), 0);
  });

  test('labels', () {
    expect(monthLabel(DateTime(2026, 10, 1)), 'October 2026');
    expect(agendaLabel('2026-10-10'), 'Sat 10 Oct');
    expect(
      sourceProblem(status: 'rate_limited', stale: true, retryAfter: 30),
      'rate limited, try again in 30 s · showing what it said last',
    );
    expect(sourceProblem(status: 'ok', stale: false), isNull);
  });

  FakeServer server() =>
      FakeServer({'/api/calendar': (_) => recorded('006-getCalendar')});

  testWidgets('narrow: agenda from today, earlier days on a tap', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final s = server();
    await tester.pumpWidget(
      MaterialApp(
        home: CalendarScreen(api: s.api, clock: () => today),
      ),
    );
    await tester.pumpAndSettle();
    final q = s.calls('/api/calendar').single.uri.queryParameters;
    expect(q['from'], monthQuery(today, 0).from);
    expect(find.text('October 2026'), findsOneWidget);
    expect(find.byKey(const ValueKey('cal-cell:2026-10-10')), findsNothing);
    final month = monthDays(byDay(calendar().items), DateTime(2026, 10, 1));
    final first = month.firstWhere((e) => e.key.compareTo('2026-10-10') >= 0);
    expect(find.byKey(ValueKey('cal-day:${first.key}')), findsOneWidget);
  });

  testWidgets('months: previous and next within range, refetched', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final s = server();
    await tester.pumpWidget(
      MaterialApp(
        home: CalendarScreen(api: s.api, clock: () => today),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('cal-next')));
    await tester.pumpAndSettle();
    expect(find.text('November 2026'), findsOneWidget);
    expect(
      tester
          .widget<IconButton>(find.byKey(const ValueKey('cal-next')))
          .onPressed,
      isNull,
    );
    expect(s.calls('/api/calendar'), hasLength(2));
    await tester.tap(find.text('Today'));
    await tester.pumpAndSettle();
    expect(find.text('October 2026'), findsOneWidget);
  });

  testWidgets('wide: month grid', (tester) async {
    tester.view.physicalSize = const Size(1300, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: CalendarScreen(api: server().api, clock: () => today),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('cal-cell:2026-10-10')), findsOneWidget);
    expect(find.text('Mon'), findsOneWidget);
    final simkl = calendar().items.firstWhere((i) => i.dateOnly);
    expect(
      find.byKey(ValueKey('cal-item:${simkl.group}:simkl:${simkl.episode}')),
      findsOneWidget,
    );
  });
}
