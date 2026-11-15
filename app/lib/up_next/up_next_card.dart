import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/tsuzuku_api.dart';
import '../writes/coming_back.dart' show Sequel;
import 'format.dart';
import 'poster.dart';
import 'source_ui.dart';
import 'up_next_logic.dart';

/// The writes a card offers (step 3.5): each source write opens the per-source preview, and only its
/// confirm writes. Null means not available: the button shows, disabled.
class UpNextActions {
  const UpNextActions({
    this.mark,
    this.setAccepted,
    this.startSeason,
    this.startSequel,
    this.sequelsFor,
  });

  /// Mark the next episode watched: on every source (null) or on one.
  final void Function(UpRow row, String? source)? mark;
  final void Function(UpRow row, bool accepted)? setAccepted;

  /// Start the next season on Simkl / MAL; [search] when nothing links it yet.
  final void Function(UpRow row, bool search)? startSeason;

  /// Start a Coming back sequel offered on the card (a show nothing links): still the preview first.
  final void Function(UpRow row, int malId)? startSequel;

  /// The Coming back sequels named like the row (only for a show nothing links).
  final List<Sequel> Function(UpRow row)? sequelsFor;
}

const _notYet = 'Not available yet';

Future<void> openUrl(String url) =>
    launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);

/// One card per show. Collapsed: poster, title, badges, the next episode (shared when the sources
/// agree, else each source's own on its own line), why they differ, upcoming episodes and progress.
/// Expanded: every source's own view.
class UpNextCard extends StatelessWidget {
  const UpNextCard({
    super.key,
    required this.row,
    required this.now,
    required this.expanded,
    required this.onToggle,
    this.posters,
    this.actions = const UpNextActions(),
    this.wide = false,
  });

  final UpRow row;
  final DateTime now;
  final bool expanded;
  final VoidCallback onToggle;
  final PosterSource? posters;
  final UpNextActions actions;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final edge = flaggedDiffers(row)
        ? Colors.amber.shade600
        : row.accepted
        ? scheme.outline
        : scheme.outlineVariant;
    final p = progress(row);
    return Card(
      key: ValueKey('card:${row.key}'),
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: edge, width: flaggedDiffers(row) ? 1.6 : 1),
      ),
      child: InkWell(
        onTap: onToggle,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  RepaintBoundary(
                    child: Poster(
                      images: row.images,
                      source: posters,
                      width: wide ? 120 : 96,
                      height: wide ? 180 : 144,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _Summary(row: row, now: now, actions: actions),
                  ),
                ],
              ),
              if (p != null) ...[
                const SizedBox(height: 10),
                ProgressSegments(progress: p, now: now),
              ],
              if (expanded) ...[
                const SizedBox(height: 8),
                const Divider(height: 1),
                for (final c in cellsOf(row))
                  SourceView(
                    cell: c,
                    row: row,
                    now: now,
                    hideActivity: lastWatched(row) != null,
                    markable: !row.agrees,
                    onMark: actions.mark == null
                        ? null
                        : () => actions.mark!(row, c.source.toJson()),
                  ),
                if (row.start.search)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Tooltip(
                        message: actions.startSeason == null ? _notYet : '',
                        child: TextButton(
                          onPressed: actions.startSeason == null
                              ? null
                              : () => actions.startSeason!(row, true),
                          child: Text(
                            '${(actions.sequelsFor?.call(row) ?? const []).isNotEmpty ? 'Something else?' : 'An anime?'} '
                            'Find it and start it on Simkl / MAL',
                          ),
                        ),
                      ),
                    ),
                  ),
                if (row.differs)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: _AcceptButton(row: row, actions: actions),
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _AcceptButton extends StatelessWidget {
  const _AcceptButton({required this.row, required this.actions});

  final UpRow row;
  final UpNextActions actions;

  @override
  Widget build(BuildContext context) {
    final set = actions.setAccepted;
    if (!row.accepted) {
      return Tooltip(
        message: set == null ? _notYet : '',
        child: OutlinedButton.icon(
          onPressed: set == null ? null : () => set(row, true),
          icon: const Icon(Icons.check, size: 18),
          label: const Text('Accept difference'),
        ),
      );
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          'Difference accepted',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        Tooltip(
          message: set == null ? _notYet : '',
          child: TextButton(
            onPressed: set == null ? null : () => set(row, false),
            child: const Text('Undo'),
          ),
        ),
      ],
    );
  }
}

class _Summary extends StatelessWidget {
  const _Summary({required this.row, required this.now, required this.actions});

  final UpRow row;
  final DateTime now;
  final UpNextActions actions;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final last = lastWatched(row);
    final side = sideStory(row);
    final rowFlags = flags(row);
    final l = lead(row);
    final mark = markAction(row);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          row.title,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: theme.textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w800,
            height: 1.15,
          ),
        ),
        if (last != null)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Row(
              children: [
                Icon(Icons.history, size: 14, color: muted?.color),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    '${last.updated ? 'Updated' : 'Watched'} ${relativeTime(last.at, now)}',
                    style: muted,
                  ),
                ),
              ],
            ),
          ),
        if (row.differs ||
            side != null ||
            notPlaced(row) ||
            rowFlags.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Wrap(
              spacing: 4,
              runSpacing: 4,
              children: [
                if (row.differs)
                  Tag(
                    row.accepted ? 'differs, accepted' : 'differs',
                    tone: row.accepted ? TagTone.neutral : TagTone.warning,
                  ),
                if (side != null) Tag(formatLabel(side), tone: TagTone.outline),
                if (notPlaced(row))
                  const Tag('season not set', tone: TagTone.primary),
                for (final f in rowFlags)
                  Tag(
                    f.label,
                    source: f.source,
                    tone: f.kind == FlagKind.blocked
                        ? TagTone.warningOutline
                        : TagTone.outline,
                  ),
              ],
            ),
          ),
        const SizedBox(height: 6),
        if (l != null)
          _Lead(lead: l, now: now)
        else
          Wrap(
            key: const ValueKey('per-source-next'),
            spacing: 12,
            runSpacing: 2,
            children: [
              for (final n in perSourceNext(row))
                Tooltip(
                  message: n.traktLabel != null ? 'Trakt ${n.traktLabel}' : '',
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SourceIcon(n.source),
                      const SizedBox(width: 4),
                      Text(
                        n.label,
                        style: n.differs
                            ? theme.textTheme.bodyMedium?.copyWith(
                                fontWeight: FontWeight.w600,
                              )
                            : theme.textTheme.bodyMedium?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        if (flaggedDiffers(row) && row.reasons.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: DiffReasons(
              reasons: row.reasons,
              now: now,
              onMark: actions.mark == null
                  ? null
                  : (s) => actions.mark!(row, s),
            ),
          ),
        if (row.upcoming.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final u in row.upcoming) _UpcomingLine(u: u, now: now),
              ],
            ),
          ),
        if (row.start.search)
          for (final q in actions.sequelsFor?.call(row) ?? const <Sequel>[])
            _SequelOffer(row: row, sequel: q, actions: actions),
        if (row.start.sources.isNotEmpty || mark.show)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Wrap(
              alignment: WrapAlignment.end,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              runSpacing: 6,
              children: [
                if (row.start.sources.isNotEmpty)
                  Tooltip(
                    message: actions.startSeason == null
                        ? _notYet
                        : 'Not on your ${row.start.sources.map((s) => sourceLabel(s.toJson())).join(' or ')} watching list yet',
                    child: FilledButton.tonalIcon(
                      onPressed: actions.startSeason == null
                          ? null
                          : () => actions.startSeason!(row, false),
                      icon: const Icon(Icons.play_circle_outline, size: 18),
                      label: const Text('Start next season'),
                    ),
                  ),
                if (mark.show)
                  Tooltip(
                    message: actions.mark == null
                        ? _notYet
                        : mark.source == null
                        ? 'Mark watched on every source'
                        : 'Mark watched on ${sourceLabel(mark.source!)}',
                    child: IconButton.filled(
                      key: const ValueKey('mark'),
                      onPressed: actions.mark == null
                          ? null
                          : () => actions.mark!(row, mark.source),
                      icon: mark.source == null
                          ? const Icon(Icons.done_all)
                          : SourceIcon(mark.source!, size: 22),
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

/// A Coming back sequel for a show nothing links, offered before a search (legacy `UpNextCards`).
class _SequelOffer extends StatelessWidget {
  const _SequelOffer({
    required this.row,
    required this.sequel,
    required this.actions,
  });

  final UpRow row;
  final Sequel sequel;
  final UpNextActions actions;

  /// The sequel's name without the show's own: "Show Season 2" on the Show card reads "Season 2".
  String get _name {
    final t = sequel.title;
    if (t.toLowerCase().startsWith(row.title.toLowerCase())) {
      final rest = t
          .substring(row.title.length)
          .replaceFirst(RegExp(r'^[\s:\-–]+'), '');
      if (rest.isNotEmpty) return rest;
    }
    return t;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final info = theme.colorScheme.primary;
    final start = actions.startSequel;
    return Container(
      key: ValueKey('sequel-offer:${sequel.malId.toInt()}'),
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Icon(Icons.event_repeat, size: 16, color: info),
              Text(
                'Coming back',
                style: TextStyle(color: info, fontWeight: FontWeight.w600),
              ),
              if (sequel.onPlanToWatch)
                const Tag('Plan to Watch', tone: TagTone.outline),
            ],
          ),
          Row(
            children: [
              Expanded(
                child: InkWell(
                  onTap: () => openUrl(
                    'https://myanimelist.net/anime/${sequel.malId.toInt()}',
                  ),
                  child: Text(
                    _name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
              ),
              Tooltip(
                message: start == null
                    ? _notYet
                    : 'Start ${sequel.title} on Simkl / MAL',
                child: FilledButton.tonalIcon(
                  onPressed: start == null
                      ? null
                      : () => start(row, sequel.malId.toInt()),
                  icon: const Icon(Icons.play_arrow, size: 18),
                  label: const Text('Start'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Lead extends StatelessWidget {
  const _Lead({required this.lead, required this.now});

  final LeadEpisode lead;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final date = shortDate(lead.airedAt, now);
    final future = isFuture(lead.airedAt, now);
    return Column(
      key: const ValueKey('lead'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 6,
          runSpacing: 4,
          children: [
            Tag(lead.episode ?? 'caught up', tone: TagTone.primary, bold: true),
            if (date != null)
              Tag(
                future ? '$date · ${relativeTime(lead.airedAt, now)}' : date,
                icon: future ? Icons.schedule : Icons.calendar_today,
                tone: future ? TagTone.warning : TagTone.neutral,
              ),
          ],
        ),
        if (lead.name != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              lead.name!,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodyMedium,
            ),
          ),
      ],
    );
  }
}

class _UpcomingLine extends StatelessWidget {
  const _UpcomingLine({required this.u, required this.now});

  final Upcoming u;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final future = isFuture(u.airsAt, now);
    final style = theme.textTheme.bodyMedium?.copyWith(
      color: future ? null : theme.colorScheme.onSurfaceVariant,
    );
    return Text.rich(
      TextSpan(
        style: style,
        children: [
          WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: SourceIcon(u.source.toJson()),
          ),
          const TextSpan(text: ' '),
          WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: InkWell(
              onTap: () => openUrl(u.url),
              child: Text(
                u.episode,
                style: style?.copyWith(
                  fontWeight: FontWeight.w600,
                  decoration: TextDecoration.underline,
                  decorationStyle: TextDecorationStyle.dotted,
                ),
              ),
            ),
          ),
          TextSpan(
            text:
                ' ${future ? 'airs' : 'aired'} ${airTime(u.airsAt) ?? u.airsAt}',
          ),
          TextSpan(
            text: ' (${relativeTime(u.airsAt, now)})',
            style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

/// The "Why?" lines of a differing card (#78): likely causes, most specific first. Only hints;
/// nothing is changed from here.
class DiffReasons extends StatelessWidget {
  const DiffReasons({
    super.key,
    required this.reasons,
    required this.now,
    this.onMark,
  });

  final List<GetUpNextResponse200RowsItemReasonsItem> reasons;
  final DateTime now;
  final void Function(String source)? onMark;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final (i, r) in reasons.indexed)
          Padding(
            padding: const EdgeInsets.only(bottom: 2),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 2, right: 6),
                  child: Icon(
                    i == 0 ? Icons.lightbulb_outline : Icons.circle,
                    size: i == 0 ? 16 : 6,
                    color: muted,
                  ),
                ),
                Expanded(
                  child: Text.rich(
                    TextSpan(
                      style: theme.textTheme.bodyMedium,
                      children: _spans(context, r.toJson()),
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  List<InlineSpan> _spans(BuildContext context, Object? json) {
    if (json is! Map) return const [];
    String s(String k) => '${json[k]}';
    final muted = TextStyle(
      color: Theme.of(context).colorScheme.onSurfaceVariant,
    );
    switch (json['kind']) {
      case 'partial_mark':
        final reached = (json['reached'] as List).cast<String>();
        return [
          TextSpan(text: '${shortDate(s('at'), now) ?? s('at')} mark went to '),
          for (final (j, src) in reached.indexed) ...[
            sourceSpan(src),
            if (j < reached.length - 1) const TextSpan(text: ', '),
          ],
          const TextSpan(text: ' only; '),
          sourceSpan(s('behind')),
          const TextSpan(text: ' is 1 behind. '),
          WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: Tooltip(
              message: onMark == null ? _notYet : '',
              child: TextButton(
                style: TextButton.styleFrom(
                  padding: EdgeInsets.zero,
                  minimumSize: const Size(0, 24),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                onPressed: onMark == null ? null : () => onMark!(s('behind')),
                child: Text('Mark on ${sourceLabel(s('behind'))}'),
              ),
            ),
          ),
        ];
      case 'offset':
        final suggested = (json['suggested'] as num).toInt();
        return [
          sourceSpan(s('source')),
          TextSpan(
            text:
                ' lines up with offset $suggested, not ${(json['current'] as num).toInt()} ',
          ),
          TextSpan(
            text: suggested != 0
                ? '($suggested episodes in the seasons before it).'
                : '(the entry starts Trakt S${(json['traktSeason'] as num).toInt()}).',
            style: muted,
          ),
        ];
      case 'link':
        return [
          sourceSpan('trakt'),
          TextSpan(text: ' ${s('traktEpisode')} is outside the linked '),
          sourceSpan(s('source')),
          TextSpan(
            text:
                ' entry (${(json['episodes'] as num).toInt()} episodes): the link may be another season.',
          ),
        ];
      case 'not_listed_yet':
        return [
          sourceSpan(s('source')),
          TextSpan(text: " doesn't list ${s('episode')} yet; "),
          sourceSpan(s('listedBy')),
          const TextSpan(text: ' does.'),
        ];
      case 'not_aired':
        return [
          sourceSpan(s('source')),
          TextSpan(
            text:
                ' already lists ${s('episode')}, which airs ${relativeTime(s('airsAt'), now) ?? s('airsAt')}.',
          ),
        ];
      case 'outside':
        return [
          sourceSpan(s('source')),
          TextSpan(text: ' is ${(json['by'] as num).toInt()} ahead of '),
          sourceSpan(s('than')),
          const TextSpan(text: ': watched outside Tsuzuku.'),
        ];
    }
    return const [];
  }
}

const _states = {
  'in_sync': ('in sync', TagTone.success),
  'differs': ('differs', TagTone.warning),
  'caught_up': ('caught up', TagTone.neutral),
  'not_placed': ('season not set', TagTone.primary),
};

/// One source's view of a show (decision #19): its own progress and next episode, and how it compares.
class SourceView extends StatelessWidget {
  const SourceView({
    super.key,
    required this.cell,
    required this.row,
    required this.now,
    this.hideActivity = false,
    this.markable = false,
    this.onMark,
  });

  final Cell cell;
  final UpRow row;
  final DateTime now;
  final bool hideActivity;
  final bool markable;
  final VoidCallback? onMark;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final small = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final source = cell.source.toJson();
    final state = stateOf(cell);
    final stateBadge = state == 'differs' && row.accepted
        ? ('differs, accepted', TagTone.neutral)
        : _states[state];
    final e = cell.entry;
    final url = e != null ? entryUrl(e) : null;

    return Padding(
      key: ValueKey('source:${row.key}:$source'),
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 96,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                InkWell(
                  onTap: url == null ? null : () => openUrl(url),
                  child: SourceName(
                    source,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 4,
                  runSpacing: 4,
                  children: [
                    if (stateBadge != null)
                      Tag(stateBadge.$1, tone: stateBadge.$2),
                    if (isSideStory(e?.format))
                      Tag(formatLabel(e!.format!), tone: TagTone.outline),
                    if (cell.blocked)
                      const Tag('rate limited', tone: TagTone.warningOutline)
                    else if (cell.stale)
                      const Tag('stale', tone: TagTone.outline),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(child: _body(context, e, muted, small, source)),
        ],
      ),
    );
  }

  Widget _body(
    BuildContext context,
    CellEntry? e,
    TextStyle? muted,
    TextStyle? small,
    String source,
  ) {
    final theme = Theme.of(context);
    final state = stateOf(cell);
    if (e == null) {
      final ref = refUrl(cell, row.kind.toJson());
      if (state == 'not_in_list' && source == 'trakt') {
        // Trakt's list is its up next, which leaves out shows you are caught up on until the next one airs.
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _linkText(
              "off Trakt's up next${cell.ref != null ? ' · ${cell.ref!.title}' : ''}",
              ref,
              muted,
            ),
            Text(
              "Trakt hides shows you're caught up on until the next episode airs.",
              style: small,
            ),
          ],
        );
      }
      if (state == 'not_in_list') {
        return _linkText(
          'not on your ${sourceLabel(source)} list'
          '${cell.ref != null ? ' (${cell.ref!.title})' : ''}',
          ref,
          muted,
        );
      }
      if (state == 'unmapped') return Text('not linked', style: muted);
      return Text('—', style: muted);
    }

    final next = e.next;
    final date = shortDate(next?.airedAt, now);
    final future = isFuture(next?.airedAt, now);
    final activity = relativeTime(e.lastActivityAt, now);
    final details = [
      if (e.airing != null) airingLabel(e.airing!),
      if (activity != null && !hideActivity)
        '${source == 'mal' ? 'updated' : 'watched'} $activity',
    ];
    final epUrl = next != null ? episodeUrl(e, next) : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text.rich(
          TextSpan(
            style: theme.textTheme.bodyMedium,
            children: [
              if (next == null)
                const TextSpan(
                  text: 'caught up',
                  style: TextStyle(fontWeight: FontWeight.w600),
                )
              else ...[
                WidgetSpan(
                  alignment: PlaceholderAlignment.middle,
                  child: _linkText(
                    episodeLabel(next.season, next.number),
                    epUrl,
                    const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                // In Trakt's numbering, only where it says something: in sync, it is Trakt's own next.
                if (cell.traktNext != null &&
                    source != 'trakt' &&
                    state != 'in_sync') ...[
                  const TextSpan(text: '  '),
                  WidgetSpan(
                    alignment: PlaceholderAlignment.middle,
                    child: SourceIcon('trakt'),
                  ),
                  TextSpan(
                    text:
                        ' ${episodeLabel(cell.traktNext!.season, cell.traktNext!.number)}',
                    style: muted,
                  ),
                ],
                if (next.title != null) TextSpan(text: ' · “${next.title}”'),
              ],
            ],
          ),
        ),
        Text.rich(
          TextSpan(
            style: muted,
            children: [
              if (date != null)
                TextSpan(
                  text: future
                      ? 'airs $date (${relativeTime(next!.airedAt, now)}) · '
                      : 'aired $date · ',
                  style: future
                      ? TextStyle(color: Colors.amber.shade800)
                      : null,
                ),
              TextSpan(
                text:
                    '${e.watched.toInt()}/${e.episodes?.toInt() ?? '?'} watched',
              ),
            ],
          ),
        ),
        if (details.isNotEmpty) Text(details.join(' · '), style: small),
        if (e.title != row.title)
          _linkText(e.title, entryUrl(e), small, maxLines: 2),
        if (markable && next != null && !cell.blocked)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Tooltip(
              message: onMark == null
                  ? _notYet
                  : cell.stale
                  ? 'Showing cached data; refresh first'
                  : '',
              child: OutlinedButton.icon(
                onPressed: onMark == null || cell.stale ? null : onMark,
                icon: const Icon(Icons.check, size: 18),
                label: Text(
                  'Mark ${episodeLabel(next.season, next.number)} watched',
                ),
              ),
            ),
          ),
        if (state == 'not_placed')
          Text('Trakt season not set (Mappings)', style: small),
      ],
    );
  }

  Widget _linkText(
    String text,
    String? url,
    TextStyle? style, {
    int? maxLines,
  }) {
    final t = Text(
      text,
      style: style,
      maxLines: maxLines,
      overflow: maxLines != null ? TextOverflow.ellipsis : null,
    );
    if (url == null) return t;
    return InkWell(onTap: () => openUrl(url), child: t);
  }
}

/// One segment per episode, the next one highlighted; a bar when the episodes don't fit. Counts are
/// always written out, with the source they come from.
class ProgressSegments extends StatelessWidget {
  const ProgressSegments({
    super.key,
    required this.progress,
    required this.now,
  });

  final Progress progress;
  final DateTime now;

  static const _minSegment = 6.0;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final p = progress;
    final style = Theme.of(context).textTheme.bodySmall?.copyWith(
      color: scheme.onSurfaceVariant,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    return Semantics(
      label:
          '${p.watched} of ${p.episodes} episodes watched on ${sourceLabel(p.source)}',
      excludeSemantics: true,
      child: Row(
        children: [
          Expanded(
            child: LayoutBuilder(
              builder: (context, box) {
                if (box.maxWidth / p.episodes >= _minSegment) {
                  return Row(
                    children: [
                      for (var i = 1; i <= p.episodes; i++)
                        Expanded(
                          child: Container(
                            height: 8,
                            margin: const EdgeInsets.symmetric(horizontal: 1),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(2),
                              color: i <= p.watched
                                  ? scheme.primary.withValues(alpha: 0.45)
                                  : i == p.watched + 1
                                  ? scheme.primary
                                  : scheme.surfaceContainerHighest,
                            ),
                          ),
                        ),
                    ],
                  );
                }
                return ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: p.watched / p.episodes,
                    minHeight: 8,
                  ),
                );
              },
            ),
          ),
          const SizedBox(width: 10),
          SourceIcon(p.source, size: 13),
          const SizedBox(width: 4),
          Text(
            '${p.watched}/${p.episodes}${p.left > 0 ? ' · ${p.left} left' : ''}',
            style: style,
          ),
        ],
      ),
    );
  }
}

enum TagTone { primary, success, warning, warningOutline, neutral, outline }

/// A small label, optionally with a source logo.
class Tag extends StatelessWidget {
  const Tag(
    this.label, {
    super.key,
    this.tone = TagTone.neutral,
    this.source,
    this.icon,
    this.bold = false,
  });

  final String label;
  final TagTone tone;
  final String? source;
  final IconData? icon;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final amber = dark ? Colors.amber.shade300 : Colors.amber.shade900;
    final (Color? bg, Color fg, Color? border) = switch (tone) {
      TagTone.primary => (
        scheme.primaryContainer,
        scheme.onPrimaryContainer,
        null,
      ),
      TagTone.success => (
        Colors.green.withValues(alpha: 0.15),
        dark ? Colors.green.shade300 : Colors.green.shade800,
        null,
      ),
      TagTone.warning => (Colors.amber.withValues(alpha: 0.18), amber, null),
      TagTone.warningOutline => (null, amber, amber),
      TagTone.neutral => (
        scheme.surfaceContainerHighest,
        scheme.onSurfaceVariant,
        null,
      ),
      TagTone.outline => (null, scheme.onSurfaceVariant, scheme.outlineVariant),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
        border: border != null ? Border.all(color: border) : null,
      ),
      child: DefaultTextStyle.merge(
        style: TextStyle(
          color: fg,
          fontSize: 12,
          fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (source != null) ...[
              SourceIcon(source!, size: 13),
              const SizedBox(width: 4),
            ],
            if (icon != null) ...[
              Icon(icon, size: 13, color: fg),
              const SizedBox(width: 4),
            ],
            Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
          ],
        ),
      ),
    );
  }
}
