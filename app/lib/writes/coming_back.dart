import 'package:flutter/material.dart';

import '../api/tsuzuku_api.dart';
import '../up_next/format.dart';
import '../up_next/poster.dart';
import '../up_next/source_ui.dart';
import '../up_next/up_next_card.dart' show Tag, TagTone, openUrl;
import 'write_flows.dart';

// "Coming back" (#66, legacy `ComingBack.vue` and `useComingBack.ts`): sequels of anime you completed
// that are on no watching list. Asked when the section is opened, or when an Up Next card for a show
// nothing links needs a sequel to offer. Dismiss and undo only change Tsuzuku's own list, no source.

typedef Sequel = ComingBackResultSequelsItem;

/// Coming back's answer, shared by the section and the cards. Loaded once, on demand.
class ComingBackController extends ChangeNotifier {
  ComingBackController(this.api);

  final TsuzukuApi api;

  ComingBackResult? data;
  bool loading = false;
  String? error;

  /// Dismissed or undone here since the load (the answer itself is immutable).
  final _dismissed = <int, bool>{};

  bool isDismissed(Sequel s) => _dismissed[s.malId.toInt()] ?? s.dismissed;

  List<Sequel> get shown => [
    for (final s in data?.sequels ?? const <Sequel>[])
      if (!isDismissed(s)) s,
  ];

  List<Sequel> get dismissed => [
    for (final s in data?.sequels ?? const <Sequel>[])
      if (isDismissed(s)) s,
  ];

  Future<void> load() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      data = await api.comingBack.getComingBack();
      _dismissed.clear();
    } catch (e) {
      error = writeErrorText(e);
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  /// Loads unless it is loaded or loading.
  void ensure() {
    if (data == null && !loading) load();
  }

  Future<void> setDismissed(Sequel s, bool dismissed) async {
    final id = s.malId.toInt();
    _dismissed[id] = dismissed;
    notifyListeners();
    try {
      if (dismissed) {
        await api.comingBack.postComingBackDismiss(
          body: PostComingBackDismissRequest(malId: id),
        );
      } else {
        await api.comingBack.postComingBackUndoDismiss(
          body: PostComingBackUndoDismissRequest(malId: id),
        );
      }
    } catch (e) {
      _dismissed[id] = !dismissed;
      error = writeErrorText(e);
    }
    notifyListeners();
  }
}

String _norm(String t) => t
    .toLowerCase()
    .replaceAll(
      RegExp(r'\bseason\s*\d+\b|\b\d+(st|nd|rd|th)\s+season\b', unicode: true),
      '',
    )
    .replaceAll(RegExp(r'[^\p{L}\p{N}]+', unicode: true), '');

/// Sequels that belong to a Trakt show by title: the season it follows, or the sequel itself, named
/// like the show (case, punctuation and "Season N" ignored). Only candidates: starting one still goes
/// through the preview.
List<Sequel> sequelsForShow(String title, List<Sequel> sequels) {
  final want = _norm(title);
  if (want.isEmpty) return const [];
  return [
    for (final s in sequels)
      if (_norm(s.from.title) == want || _norm(s.title) == want) s,
  ];
}

const _months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/// An announcement can be just a year, or a month: what AniList knows and no more.
String partialDate(ComingBackResultSequelsItemStartDate d) {
  if (d.year == null) return 'date not announced';
  if (d.month == null) return '${d.year!.toInt()}';
  return '${d.day != null ? '${d.day!.toInt()} ' : ''}${_months[d.month!.toInt() - 1]} ${d.year!.toInt()}';
}

String stageText(Sequel s, DateTime now) {
  final next = s.nextEpisode;
  final at = next == null
      ? null
      : DateTime.fromMillisecondsSinceEpoch(
          next.airingAt.toInt() * 1000,
          isUtc: true,
        ).toIso8601String();
  switch (s.stage.toJson()) {
    case 'airing':
      return next != null && next.episode > 1
          ? 'E${next.episode.toInt() - 1} out'
          : 'Airing';
    case 'scheduled':
      return at != null
          ? 'Starts ${shortDate(at, now)} (${relativeTime(at, now)})'
          : 'Scheduled';
    case 'announced':
      return 'Announced · ${partialDate(s.startDate)}';
    default:
      return 'Already out';
  }
}

bool canStart(Sequel s) =>
    s.stage.toJson() == 'airing' || s.stage.toJson() == 'released';

String malAnimeUrl(num id) => 'https://myanimelist.net/anime/${id.toInt()}';
String anilistAnimeUrl(num id) => 'https://anilist.co/anime/${id.toInt()}';

/// The collapsible section on Up Next.
class ComingBackSection extends StatefulWidget {
  const ComingBackSection({
    super.key,
    required this.controller,
    required this.now,
    required this.onStart,
    this.posters,
    this.wide = false,
  });

  final ComingBackController controller;
  final DateTime now;
  final PosterSource? posters;
  final bool wide;

  /// Opens the next-season preview for a sequel (row key `coming:<malId>`).
  final void Function(Sequel s) onStart;

  @override
  State<ComingBackSection> createState() => _ComingBackSectionState();
}

class _ComingBackSectionState extends State<ComingBackSection> {
  bool _open = false;
  bool _showDismissed = false;

  ComingBackController get c => widget.controller;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: c,
    builder: (context, _) {
      final theme = Theme.of(context);
      final muted = theme.textTheme.bodyMedium?.copyWith(
        color: theme.colorScheme.onSurfaceVariant,
      );
      final data = c.data;
      final shown = c.shown;
      final dismissed = c.dismissed;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextButton.icon(
            key: const ValueKey('coming-back-toggle'),
            onPressed: () {
              setState(() => _open = !_open);
              if (_open) c.ensure();
            },
            icon: Icon(_open ? Icons.expand_more : Icons.chevron_right),
            label: Text(
              '${_open ? 'Hide' : 'Show'} coming back${data != null ? ' (${shown.length})' : ''}',
              style: theme.textTheme.titleMedium,
            ),
          ),
          if (_open) ...[
            Text(
              'Sequels of anime you completed that are on no watching list yet.',
              style: muted,
            ),
            const SizedBox(height: 8),
            if (c.loading)
              Text('Looking up your completed anime…', style: muted)
            else if (c.error != null && data == null)
              _warning(context, [TextSpan(text: c.error)], error: true)
            else if (data != null) ...[
              if (c.error != null)
                _warning(context, [TextSpan(text: c.error)], error: true),
              if (data.mal.stale || data.mal.status.toJson() != 'ok')
                _warning(context, [
                  sourceSpan('mal'),
                  TextSpan(
                    text:
                        ' could not be read just now${data.mal.error != null ? ' (${data.mal.error})' : ''}; '
                        'showing its list from ${relativeTime(data.mal.fetchedAt, widget.now) ?? 'before'}.',
                  ),
                ]),
              if (data.anilist.missing > 0 ||
                  data.anilist.status.toJson() != 'ok')
                _warning(context, [
                  sourceSpan('anilist'),
                  TextSpan(
                    text:
                        ' did not answer for ${data.anilist.missing.toInt()} '
                        '${data.anilist.missing == 1 ? 'entry' : 'entries'}'
                        '${data.anilist.error != null ? ' (${data.anilist.error})' : ''}; they are skipped for now.',
                  ),
                ]),
              if (shown.isEmpty)
                Text('Nothing coming back right now.', style: muted)
              else
                for (final s in shown) _card(context, s),
              if (dismissed.isNotEmpty) ...[
                TextButton(
                  key: const ValueKey('coming-back-dismissed'),
                  style: TextButton.styleFrom(padding: EdgeInsets.zero),
                  onPressed: () =>
                      setState(() => _showDismissed = !_showDismissed),
                  child: Text(
                    '${_showDismissed ? 'Hide' : 'Show'} dismissed (${dismissed.length})',
                  ),
                ),
                if (_showDismissed)
                  for (final s in dismissed)
                    Row(
                      key: ValueKey('dismissed:${s.malId.toInt()}'),
                      children: [
                        Expanded(
                          child: Text(
                            '${s.title} · ${stageText(s, widget.now)}',
                            style: muted,
                          ),
                        ),
                        TextButton(
                          onPressed: () => c.setDismissed(s, false),
                          child: const Text('Undo'),
                        ),
                      ],
                    ),
              ],
            ],
          ],
        ],
      );
    },
  );

  Widget _warning(
    BuildContext context,
    List<InlineSpan> spans, {
    bool error = false,
  }) {
    final color = error
        ? Theme.of(context).colorScheme.error
        : Colors.amber.shade800;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text.rich(
        TextSpan(
          style: TextStyle(color: color),
          children: [
            WidgetSpan(
              alignment: PlaceholderAlignment.middle,
              child: Icon(
                error ? Icons.error_outline : Icons.warning_amber,
                size: 16,
                color: color,
              ),
            ),
            const TextSpan(text: ' '),
            ...spans,
          ],
        ),
      ),
    );
  }

  Widget _card(BuildContext context, Sequel s) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Card(
      key: ValueKey('sequel:${s.malId.toInt()}'),
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: theme.colorScheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Poster(
              images: [?s.cover],
              source: widget.posters,
              width: widget.wide ? 96 : 72,
              height: widget.wide ? 144 : 108,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: InkWell(
                          onTap: () => openUrl(malAnimeUrl(s.malId)),
                          child: Text(
                            s.title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                      IconButton(
                        key: ValueKey('dismiss:${s.malId.toInt()}'),
                        tooltip: 'Dismiss',
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () => c.setDismissed(s, true),
                      ),
                    ],
                  ),
                  Text(stageText(s, widget.now)),
                  Text(
                    'after ${s.from.title}',
                    style: muted,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 12,
                    children: [
                      InkWell(
                        onTap: () => openUrl(malAnimeUrl(s.malId)),
                        child: SourceName('mal', style: muted),
                      ),
                      InkWell(
                        onTap: () => openUrl(anilistAnimeUrl(s.anilistId)),
                        child: SourceName('anilist', style: muted),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (canStart(s))
                        FilledButton.icon(
                          key: ValueKey('start-sequel:${s.malId.toInt()}'),
                          onPressed: () => widget.onStart(s),
                          icon: const Icon(Icons.play_circle_outline, size: 18),
                          label: const Text('Start watching'),
                        ),
                      if (s.onPlanToWatch)
                        const Tag('Plan to Watch', tone: TagTone.neutral),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
