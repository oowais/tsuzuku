import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tsuzuku/api/tsuzuku_api.dart';

import 'support/adapters.dart';

// The generated client decodes every read the legacy server answered in the golden fixtures
// (api/fixtures/, #108 step 2.2), in both scenarios: all sources answering, and Simkl and MAL blocked.
void main() {
  for (final scenario in ['demo', 'demo-blocked']) {
    test('decodes the recorded reads: $scenario', () async {
      final dio = Dio(BaseOptions(baseUrl: 'https://tsuzuku.test'))
        ..httpClientAdapter = FixtureAdapter(scenario);
      final api = TsuzukuApi(dio);

      final health = await api.health.getHealth();
      expect(health.apiVersion, int.parse(TsuzukuApi.apiVersion));
      expect(await api.sources.getSourcesStatus(), isNotEmpty);
      await api.sources.getSourcesWatching();
      expect((await api.upNext.getUpNext()).rows, isNotEmpty);
      await api.movies.getMovies();
      await api.calendar.getCalendar(
        from: '2026-10-09T00:00:00.000Z',
        to: '2026-11-09T00:00:00.000Z',
      );
      await api.stats.getStats();
      await api.stats.getStats(refresh: GetStatsRefresh.field1);
      await api.comingBack.getComingBack();
      await api.writeLog.getWriteLog();
      await api.mappings.getMappings();
      await api.mapping.getMappingPreview();
      await api.backups.getBackups();
      await api.trakt.getTraktSearch(q: 'Moonfall Academy');
      await api.trakt.getTraktSeasons(show2: 900003);
      await api.anilist.getAnilistSearch(q: 'Moonfall Academy');
      await api.movies.getMoviesSearch(
        from: GetMoviesSearchFrom.anilist,
        q: 'Moonfall Academy',
      );
      await api.movies.getMoviesSearch(
        from: GetMoviesSearchFrom.tmdb,
        q: 'the',
      );
      await api.movies.getMoviesLinkSearch(
        target: GetMoviesLinkSearchTarget.mal,
        q: 'Moonfall Academy',
      );
      await api.movies.getMoviesLinkSearch(
        target: GetMoviesLinkSearchTarget.trakt,
        q: 'Midnight Lantern',
      );
      await api.movies.getMoviesLinkTitles(rowKey: 'trakt:991007');
    });
  }
}
