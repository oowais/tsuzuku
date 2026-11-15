import 'package:flutter/foundation.dart';

import '../api/tsuzuku_api.dart';
import '../writes/write_flows.dart' show writeErrorText;
import 'mapping_logic.dart';

// The Mappings page's state (#108, step 3.6). Every change is to Tsuzuku's own links (nothing is written to Trakt,
// Simkl or MAL) and happens only on an explicit button: Confirm, Not this show, Save, Unlink (asked twice), Link
// again. The server only ever stores real IDs: a Trakt show on your up-next list or confirmed by Trakt.

/// A proposal's season and offset, editable before confirming.
class PlacementEdit {
  PlacementEdit({this.traktSeason, this.episodeOffset = 0});

  int? traktSeason;
  int episodeOffset;
}

class MappingsController extends ChangeNotifier {
  MappingsController(this.api);

  final TsuzukuApi api;

  Mappings? data;
  Object? loadError;
  bool loading = false;

  /// The proposal or row a change is running for.
  String? busy;
  final edits = <String, PlacementEdit>{};
  final _seasons = <int, Future<GetTraktSeasonsResponse200>>{};

  List<UnlinkedRow> get unlinked =>
      data == null ? const [] : unlinkedRows(data!);
  List<LinkRow> get links => data == null ? const [] : linkRows(data!);

  Future<void> load() async {
    loading = true;
    notifyListeners();
    try {
      final d = await api.mappings.getMappings();
      data = d;
      loadError = null;
      for (final p in d.proposals) {
        edits.putIfAbsent(
          p.animeKey,
          () => PlacementEdit(
            traktSeason: p.placement.traktSeason?.toInt(),
            episodeOffset: p.placement.episodeOffset.toInt(),
          ),
        );
      }
    } catch (e) {
      loadError = e;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  PlacementEdit editOf(Proposal p) => edits.putIfAbsent(
    p.animeKey,
    () => PlacementEdit(
      traktSeason: p.placement.traktSeason?.toInt(),
      episodeOffset: p.placement.episodeOffset.toInt(),
    ),
  );

  void setEdit(Proposal p, {int? season, int? offset}) {
    final e = editOf(p);
    if (season != null) e.traktSeason = season;
    if (offset != null) e.episodeOffset = offset;
    notifyListeners();
  }

  /// Trakt's seasons of a show, fetched once per page.
  Future<GetTraktSeasonsResponse200> seasons(int traktId) =>
      _seasons.putIfAbsent(traktId, () async {
        try {
          return await api.trakt.getTraktSeasons(show2: traktId);
        } catch (_) {
          // A failed fetch is tried again next time.
          _seasons.remove(traktId);
          rethrow;
        }
      });

  /// Runs one change; the page reloads after it. Returns null when it went through, else the error text.
  Future<String?> _run(String key, Future<void> Function() call) async {
    if (busy != null) return 'Another change is still running';
    busy = key;
    notifyListeners();
    try {
      await call();
      await load();
      return null;
    } catch (e) {
      return writeErrorText(e);
    } finally {
      busy = null;
      notifyListeners();
    }
  }

  /// Places the proposal's anime entry in the chosen Trakt season. Needs a season.
  Future<String?> confirm(Proposal p) {
    final e = editOf(p);
    final season = e.traktSeason;
    if (season == null) return Future.value('Pick a Trakt season first');
    return _run(
      p.animeKey,
      () => api.mappings.postMappingsConfirm(
        body: PostMappingsConfirmRequest(
          traktId: p.trakt.trakt.toInt(),
          animeKey: p.animeKey,
          traktSeason: season,
          episodeOffset: e.episodeOffset,
        ),
      ),
    );
  }

  /// "Not this show": never suggested again.
  Future<String?> reject(Proposal p) => _run(
    p.animeKey,
    () => api.mappings.postMappingsReject(
      body: PostMappingsRejectRequest(
        traktId: p.trakt.trakt.toInt(),
        animeKey: p.animeKey,
      ),
    ),
  );

  /// A link picked in "Link to Trakt", among Trakt's own search results.
  Future<String?> link({
    required String animeKey,
    required int traktId,
    required int traktSeason,
    required int episodeOffset,
  }) => _run(
    animeKey,
    () => api.mappings.postMappingsConfirm(
      body: PostMappingsConfirmRequest(
        traktId: traktId,
        animeKey: animeKey,
        traktSeason: traktSeason,
        episodeOffset: episodeOffset,
      ),
    ),
  );

  Future<String?> edit(
    LinkRow row, {
    required int traktSeason,
    required int episodeOffset,
  }) {
    final seasonId = row.seasonId;
    if (seasonId == null) return Future.value('Only anime links have a season');
    return _run(
      row.key,
      () => api.mappings.postMappingsEdit(
        body: PostMappingsEditRequest(
          seasonId: seasonId,
          traktSeason: traktSeason,
          episodeOffset: episodeOffset,
        ),
      ),
    );
  }

  Future<String?> unlink(LinkRow row) => _run(
    row.key,
    () => api.mappings.postMappingsUnlink(
      body: PostMappingsUnlinkRequest.fromJson(
        row.seasonId != null
            ? {'seasonId': row.seasonId}
            : {'mappingId': row.mappingId},
      ),
    ),
  );

  /// "Link again" for an unlinked show.
  Future<String?> restore(LinkRow row) => _run(
    row.key,
    () => api.mappings.postMappingsUnlink(
      body: PostMappingsUnlinkRequest.fromJson({
        'mappingId': row.mappingId,
        'restore': true,
      }),
    ),
  );
}
