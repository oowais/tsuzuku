import '../api/tsuzuku_api.dart';
import '../up_next/format.dart' show episodeLabel, isSideStory;
import '../up_next/source_ui.dart' show sourceLabel;
import '../up_next/up_next_logic.dart' show itemUrl;

// Mappings (#108, step 3.6; legacy `pages/mappings.vue`, `LinksTable.vue`, `entry-view.ts`): how shows line up
// across Trakt, Simkl and MAL. Every change here is to Tsuzuku's own links; nothing is written to the sources.
// Each source keeps its own title and progress; entries listed by both Simkl and MAL say so.

typedef Mappings = GetMappingsResponse200;
typedef StoredMapping = GetMappingsResponse200MappingsItem;

/// A source name linking to a page (legacy `LinkItem`).
class LinkItem {
  const LinkItem(this.label, this.url, {this.source});

  final String label;
  final String? url;
  final String? source;
}

String? entryUrl(Entry e) => itemUrl(e.source.toJson(), e.kind.toJson(), e.ids);

/// The source's page for an episode of an entry (legacy `episodeUrl`).
String? entryEpisodeUrl(Entry e, {required num? season, required num number}) {
  final item = entryUrl(e);
  if (item == null) return null;
  final n = number.toInt();
  final s = season?.toInt();
  switch (e.source.toJson()) {
    case 'trakt':
      return s != null ? '$item/seasons/$s/episodes/$n' : item;
    case 'simkl':
      if (e.ids.simklSlug == null) return item;
      if (e.kind.toJson() == 'anime') return '$item/episode-$n/';
      return s != null ? '$item/season-$s/episode-$n/' : item;
    case 'mal':
      return '$item/_/episode/$n';
  }
  return null;
}

String? traktShowUrl(String? slug) =>
    slug == null ? null : 'https://trakt.tv/shows/$slug';

String? traktEpisodeUrl(String? slug, num season, num number) => slug == null
    ? null
    : 'https://trakt.tv/shows/$slug/seasons/${season.toInt()}/episodes/${number.toInt()}';

String malAnimeUrl(num id) => 'https://myanimelist.net/anime/${id.toInt()}';

String? labelOf(num? season, num? number) =>
    number == null ? null : episodeLabel(season, number);

/// The same anime entry as listed on each source; Simkl and MAL can disagree on title and progress.
List<Entry> sameAnime(Mappings d, {num? mal, num? simkl}) => [
  for (final e in d.entries)
    if (e.kind.toJson() == 'anime' &&
        ((mal != null && e.ids.mal == mal) ||
            (simkl != null && e.ids.simkl == simkl)))
      e,
];

Entry? entryByKey(Mappings d, String key) =>
    d.entries.where((e) => e.key == key).firstOrNull;

List<Entry> groupOf(Mappings d, String animeKey) {
  final e = entryByKey(d, animeKey);
  return e == null
      ? const []
      : sameAnime(d, mal: e.ids.mal, simkl: e.ids.simkl);
}

/// "Simkl + MAL", each name linking to that source's page.
List<LinkItem> entrySourceLinks(List<Entry> entries) => [
  for (final e in entries)
    LinkItem(
      sourceLabel(e.source.toJson()),
      entryUrl(e),
      source: e.source.toJson(),
    ),
];

/// Each source's own title, once per distinct title.
String entryTitles(List<Entry> entries) =>
    {for (final e in entries) e.title}.join(' / ');

/// Next episode per source, merged when they agree: "E6 on Simkl + MAL", else one group per episode.
List<({String label, List<LinkItem> links})> entryNextGroups(
  List<Entry> entries,
) {
  final groups = <String, List<LinkItem>>{};
  for (final e in entries) {
    final next = e.next;
    final label = next == null
        ? 'caught up'
        : episodeLabel(next.season, next.number);
    groups
        .putIfAbsent(label, () => [])
        .add(
          LinkItem(
            sourceLabel(e.source.toJson()),
            next == null
                ? entryUrl(e)
                : entryEpisodeUrl(e, season: next.season, number: next.number),
            source: e.source.toJson(),
          ),
        );
  }
  return [for (final g in groups.entries) (label: g.key, links: g.value)];
}

/// What a proposal's season and offset mean, each side's episode linked: at Trakt's next episode when the show is
/// on your list, else at the entry's first episode (legacy `meaning`).
({LinkItem trakt, List<LinkItem> anime})? meaning(
  Mappings d,
  Proposal p, {
  required int? traktSeason,
  required int offset,
}) {
  if (traktSeason == null) return null;
  final group = groupOf(d, p.animeKey);
  if (group.isEmpty) return null;
  final traktNumber = p.trakt.next?.number.toInt() ?? 1 + offset;
  final animeNumber = traktNumber - offset;
  return (
    trakt: LinkItem(
      'Trakt ${episodeLabel(traktSeason, traktNumber)}',
      traktEpisodeUrl(p.trakt.slug, traktSeason, traktNumber),
      source: 'trakt',
    ),
    anime: [
      for (final e in group)
        LinkItem(
          '${sourceLabel(e.source.toJson())} ${episodeLabel(null, animeNumber)}',
          entryEpisodeUrl(e, season: null, number: animeNumber),
          source: e.source.toJson(),
        ),
    ],
  );
}

/// An anime on your lists with no Trakt show and no proposal: only a search can link it.
class UnlinkedRow {
  const UnlinkedRow({
    required this.key,
    required this.title,
    required this.links,
    required this.entries,
    required this.format,
    required this.sideStory,
    required this.query,
    required this.chain,
  });

  final String key;
  final String title;
  final List<LinkItem> links;
  final List<Entry> entries;
  final String? format;

  /// Specials, OVAs and movies are shown but not linked (decision #23).
  final bool sideStory;

  /// What the Trakt search starts with: AniList's first title in the series, else the entry's.
  final String query;
  final List<GetMappingsResponse200ChainsValueItem> chain;
}

List<UnlinkedRow> unlinkedRows(Mappings d) {
  final proposed = {
    for (final p in d.proposals)
      for (final e in groupOf(d, p.animeKey)) e.key,
  };
  final withTrakt = <num>{};
  final withTraktSimkl = <num>{};
  for (final m in d.mappings) {
    if (m.traktId == null) continue;
    for (final s in m.seasons) {
      if (s.malId != null) withTrakt.add(s.malId!);
      if (s.simklId != null) withTraktSimkl.add(s.simklId!);
    }
  }
  final seen = <String>{};
  final rows = <UnlinkedRow>[];
  for (final e in d.entries) {
    if (e.kind.toJson() != 'anime' || proposed.contains(e.key)) continue;
    if ((e.ids.mal != null && withTrakt.contains(e.ids.mal)) ||
        (e.ids.simkl != null && withTraktSimkl.contains(e.ids.simkl))) {
      continue;
    }
    final group = sameAnime(d, mal: e.ids.mal, simkl: e.ids.simkl);
    final id = (group.map((g) => g.key).toList()..sort()).join(',');
    if (!seen.add(id)) continue;
    final own =
        group.where((g) => g.source.toJson() == 'mal').firstOrNull ??
        group.first;
    final chain = own.ids.mal != null
        ? (d.chains['${own.ids.mal!.toInt()}'] ?? const [])
        : const <GetMappingsResponse200ChainsValueItem>[];
    rows.add(
      UnlinkedRow(
        key: own.key,
        title: entryTitles(group),
        links: entrySourceLinks(group),
        entries: group,
        format: own.format,
        sideStory: isSideStory(own.format),
        query: chain.firstOrNull?.title ?? own.title,
        chain: chain,
      ),
    );
  }
  return rows;
}

/// One stored link: an anime entry placed under a Trakt show, or a show-level link.
class LinkRow {
  const LinkRow({
    required this.key,
    required this.kind,
    required this.mappingId,
    required this.seasonId,
    required this.status,
    required this.traktId,
    required this.traktTitle,
    required this.traktUrl,
    required this.traktSlug,
    required this.traktSeason,
    required this.episodeOffset,
    required this.entryTitle,
    required this.entryLinks,
  });

  final String key;

  /// anime or show.
  final String kind;
  final int mappingId;
  final int? seasonId;

  /// auto, confirmed or rejected.
  final String status;
  final int traktId;
  final String traktTitle;
  final String? traktUrl;
  final String? traktSlug;
  final int? traktSeason;
  final int episodeOffset;
  final String entryTitle;
  final List<LinkItem> entryLinks;

  String? get traktSeasonUrl => traktSeason == null || traktUrl == null
      ? null
      : traktSlug != null
      ? '$traktUrl/seasons/$traktSeason'
      : traktUrl;

  /// How it was made, as legacy words it.
  String get how => switch (status) {
    'confirmed' => 'confirmed',
    'rejected' => 'unlinked',
    _ => 'by ID',
  };
}

List<LinkRow> linkRows(Mappings d) {
  final rows = <LinkRow>[];
  for (final m in d.mappings) {
    final traktId = m.traktId;
    if (traktId == null) continue;
    final listed = d.entries
        .where((e) => e.source.toJson() == 'trakt' && e.ids.trakt == traktId)
        .firstOrNull;
    final slug = m.traktSlug ?? listed?.ids.traktSlug;
    final traktTitle =
        listed?.title ??
        d.traktTitles['${traktId.toInt()}'] ??
        m.traktSlug ??
        'Trakt #${traktId.toInt()}';
    final traktUrl = traktShowUrl(slug);
    if (m.kind.toJson() == 'show') {
      final simkl = d.entries
          .where(
            (e) => e.source.toJson() == 'simkl' && e.ids.simkl == m.simklId,
          )
          .firstOrNull;
      rows.add(
        LinkRow(
          key: 'm:${m.id.toInt()}',
          kind: 'show',
          mappingId: m.id.toInt(),
          seasonId: null,
          status: m.status.toJson(),
          traktId: traktId.toInt(),
          traktTitle: traktTitle,
          traktUrl: traktUrl,
          traktSlug: slug,
          traktSeason: null,
          episodeOffset: 0,
          entryTitle: simkl?.title ?? 'Simkl #${m.simklId?.toInt()}',
          entryLinks: simkl != null
              ? entrySourceLinks([simkl])
              : [
                  LinkItem(
                    'Simkl',
                    itemUrl('simkl', 'show', EntryIds(simkl: m.simklId)),
                    source: 'simkl',
                  ),
                ],
        ),
      );
      continue;
    }
    for (final s in m.seasons) {
      final group = sameAnime(d, mal: s.malId, simkl: s.simklId);
      rows.add(
        LinkRow(
          key: 's:${s.id.toInt()}',
          kind: 'anime',
          mappingId: m.id.toInt(),
          seasonId: s.id.toInt(),
          status: m.status.toJson(),
          traktId: traktId.toInt(),
          traktTitle: traktTitle,
          traktUrl: traktUrl,
          traktSlug: slug,
          traktSeason: s.traktSeason?.toInt(),
          episodeOffset: s.episodeOffset.toInt(),
          entryTitle: group.isNotEmpty
              ? entryTitles(group)
              : '${s.malId != null ? 'MAL #${s.malId!.toInt()}' : 'Simkl #${s.simklId?.toInt()}'} (not on your lists now)',
          entryLinks: group.isNotEmpty
              ? entrySourceLinks(group)
              : [
                  if (s.simklId != null)
                    LinkItem(
                      'Simkl',
                      itemUrl('simkl', 'anime', EntryIds(simkl: s.simklId)),
                      source: 'simkl',
                    ),
                  if (s.malId != null)
                    LinkItem('MAL', malAnimeUrl(s.malId!), source: 'mal'),
                ],
        ),
      );
    }
  }
  rows.sort((a, b) => a.traktTitle.compareTo(b.traktTitle));
  return rows;
}

/// Rows for a Linked tab: anime, show (both without rejected), or rejected.
List<LinkRow> rowsForTab(List<LinkRow> rows, String tab) => [
  for (final r in rows)
    if (tab == 'rejected'
        ? r.status == 'rejected'
        : r.kind == tab && r.status != 'rejected')
      r,
];

/// "S1 · Season title · 12 eps" (legacy `TraktSeasonSelect`).
String seasonLabel(TraktSeason s) {
  final n = s.number.toInt();
  return [
    'S$n',
    if (s.title != null && s.title != 'Season $n') s.title!,
    if (s.episodeCount != null) '${s.episodeCount!.toInt()} eps',
  ].join(' · ');
}
