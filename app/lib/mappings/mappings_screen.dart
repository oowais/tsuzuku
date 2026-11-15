import 'package:flutter/material.dart';

import '../api/tsuzuku_api.dart';
import '../server/connection.dart';
import '../up_next/format.dart' show formatLabel, sidePadding;
import '../up_next/source_ui.dart';
import '../up_next/up_next_card.dart' show Tag, TagTone;
import '../up_next/up_next_screen.dart' show ErrorState, Notice;
import '../writes/write_sheets.dart' show showWriteSheet;
import 'mapping_logic.dart';
import 'mapping_widgets.dart';
import 'mappings_controller.dart';
import '../theme/solid_glass.dart';

// Mappings (#108, step 3.6; legacy `pages/mappings.vue`, `LinksTable.vue`): how your shows line up across Trakt,
// Simkl and MAL. Links proven by shared IDs are made for you; everything else waits for your confirm. Changes are to
// Tsuzuku's own links only; each waits for an explicit button, and Unlink asks twice.

/// Content width from which the stored links show as a table.
const mappingsTableWidth = 900.0;

class MappingsScreen extends StatefulWidget {
  const MappingsScreen({super.key, required this.api});

  final TsuzukuApi api;

  @override
  State<MappingsScreen> createState() => _MappingsScreenState();
}

class _MappingsScreenState extends State<MappingsScreen> {
  late final _c = MappingsController(widget.api)..load();
  String _tab = 'anime';

  /// The wide table's row being edited or about to be unlinked.
  String? _editing;
  int? _editSeason;
  int _editOffset = 0;
  String? _unlinking;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  void _say(String? error, String done) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(error == null ? done : 'Could not save: $error')),
    );
  }

  Future<void> _confirm(Proposal p) async {
    final error = await _c.confirm(p);
    _say(error, 'Linked');
  }

  Future<void> _reject(Proposal p) async {
    final error = await _c.reject(p);
    _say(error, 'Will not suggest this again');
  }

  Future<void> _unlink(LinkRow r) async {
    if (_unlinking != r.key) {
      setState(() => _unlinking = r.key);
      return;
    }
    final error = await _c.unlink(r);
    setState(() => _unlinking = null);
    _say(error, 'Unlinked');
  }

  /// Phones: Unlink asks in a dialog first.
  Future<void> _askUnlink(LinkRow r) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Unlink?'),
        content: Text(
          '${r.traktTitle} and ${r.entryTitle} stop being one show in Tsuzuku. Nothing changes on the sources.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('unlink-confirm'),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
              foregroundColor: Theme.of(context).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Confirm unlink'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final error = await _c.unlink(r);
    _say(error, 'Unlinked');
  }

  Future<void> _restore(LinkRow r) async {
    final error = await _c.restore(r);
    _say(error, 'Linked again');
  }

  Future<void> _saveRow(LinkRow r) async {
    final season = _editSeason;
    if (season == null) return;
    final error = await _c.edit(
      r,
      traktSeason: season,
      episodeOffset: _editOffset,
    );
    if (error == null) setState(() => _editing = null);
    _say(error, 'Saved');
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Mappings'),
      actions: [
        IconButton(
          onPressed: _c.load,
          icon: const Icon(Icons.refresh),
          tooltip: 'Refresh',
        ),
      ],
    ),
    body: ListenableBuilder(
      listenable: _c,
      builder: (context, _) => LayoutBuilder(
        builder: (context, box) => _body(context, box.maxWidth),
      ),
    ),
  );

  Widget _body(BuildContext context, double width) {
    final d = _c.data;
    if (d == null) {
      if (_c.loadError != null) {
        return ErrorState(error: _c.loadError!, onRetry: _c.load);
      }
      return const Center(child: CircularProgressIndicator());
    }
    final theme = Theme.of(context);
    final wide = width >= mappingsTableWidth;
    final pad = EdgeInsets.symmetric(
      horizontal: sidePadding(width, wide: wide),
    );
    final unlinked = _c.unlinked;
    final rows = _c.links;
    return RefreshIndicator(
      onRefresh: _c.load,
      child: ListView(
        key: const PageStorageKey('mappings'),
        padding: pad.copyWith(bottom: 32),
        children: [
          SizedBox(
            height: 2,
            child: _c.loading
                ? const LinearProgressIndicator(minHeight: 2)
                : null,
          ),
          const SizedBox(height: 8),
          Text(
            'How your shows line up across Trakt, Simkl and MAL. Links proven by shared IDs are made for you; '
            'everything else waits for your confirm. Every title and episode links to the source.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          if (d.sources.anilist.status != 'ok')
            Notice(
              icon: Icons.warning_amber,
              warning: true,
              spans: [
                sourceSpan('anilist'),
                const TextSpan(
                  text: ' is not answering right now. Season chains may be incomplete. Refresh in a minute.',
                ),
              ],
            ),
          if (_c.loadError != null)
            Notice(
              icon: Icons.cloud_off,
              warning: true,
              text: 'Could not refresh: ${describeError(_c.loadError!)}.',
            ),
          _heading(context, 'Needs your confirm', d.proposals.length),
          if (d.proposals.isEmpty)
            Text('Nothing to confirm.', style: theme.textTheme.bodyMedium)
          else
            for (final p in d.proposals) _proposal(context, d, p, wide),
          if (unlinked.isNotEmpty) ...[
            _heading(context, 'Not linked to Trakt', unlinked.length),
            _box(context, [for (final u in unlinked) _unlinkedRow(context, u)]),
          ],
          _heading(context, 'Linked', null),
          _tabs(rows),
          const SizedBox(height: 8),
          if (wide) _table(context, rows) else _list(context, rows),
        ],
      ),
    );
  }

  Widget _heading(BuildContext context, String title, int? count) => Padding(
    padding: const EdgeInsets.only(top: 20, bottom: 8),
    child: Row(
      children: [
        Text(
          title,
          style: Theme.of(context).textTheme.titleMedium
              ?.copyWith(fontWeight: FontWeight.w700),
        ),
        if (count != null) ...[const SizedBox(width: 8), Tag('$count')],
      ],
    ),
  );

  Widget _box(BuildContext context, List<Widget> children) => Container(
    decoration: BoxDecoration(
      border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Column(
      children: [
        for (final (i, c) in children.indexed) ...[
          if (i > 0) const Divider(height: 1),
          c,
        ],
      ],
    ),
  );

  Widget _proposal(BuildContext context, Mappings d, Proposal p, bool wide) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final edit = _c.editOf(p);
    final busy = _c.busy == p.animeKey;
    final group = groupOf(d, p.animeKey);
    final m = meaning(
      d,
      p,
      traktSeason: edit.traktSeason,
      offset: edit.episodeOffset,
    );
    final traktSide = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        LinkText(
          LinkItem('Trakt', traktShowUrl(p.trakt.slug), source: 'trakt'),
          style: muted,
        ),
        Text(
          p.trakt.title,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        if (p.trakt.onList)
          Wrap(
            children: [
              Text('next ', style: muted),
              LinkText(
                LinkItem(
                  p.trakt.next == null
                      ? 'caught up'
                      : labelOf(p.trakt.next!.season, p.trakt.next!.number)!,
                  p.trakt.next == null || p.trakt.next!.season == null
                      ? null
                      : traktEpisodeUrl(
                          p.trakt.slug,
                          p.trakt.next!.season!,
                          p.trakt.next!.number,
                        ),
                ),
                style: muted,
              ),
            ],
          )
        else
          Text('not in your Trakt up next', style: muted),
      ],
    );
    final animeSide = group.isEmpty
        ? const SizedBox.shrink()
        : Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              LinkList(entrySourceLinks(group), style: muted),
              Text(
                entryTitles(group),
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  for (final (i, g) in entryNextGroups(group).indexed) ...[
                    Text(
                      '${i > 0 ? ' · ' : ''}next ${g.label} on ',
                      style: muted,
                    ),
                    LinkList(g.links, style: muted),
                  ],
                ],
              ),
            ],
          );
    return Padding(
      key: ValueKey('proposal:${p.animeKey}'),
      padding: const EdgeInsets.only(bottom: 12),
      child: PaneCard(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (wide)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: traktSide),
                  const SizedBox(width: 12),
                  Expanded(child: animeSide),
                ],
              )
            else ...[
              traktSide,
              const SizedBox(height: 8),
              animeSide,
            ],
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (p.via.toJson() == 'ids')
                  const Tag('Same show by ID', tone: TagTone.success)
                else
                  Tag(
                    'Title match ${(p.score * 100).round()}%',
                    tone: TagTone.warning,
                  ),
                if (p.chain.length > 1) ...[
                  Text.rich(
                    TextSpan(
                      style: muted,
                      children: [
                        TextSpan(text: 'Season ${p.chain.length} on '),
                        sourceSpan('anilist', style: muted),
                        const TextSpan(text: ':'),
                      ],
                    ),
                  ),
                  for (final (i, c) in p.chain.indexed) ...[
                    if (i > 0) Text('→', style: muted),
                    LinkText(
                      LinkItem(c.title, malAnimeUrl(c.malId)),
                      style: muted,
                    ),
                  ],
                ],
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 16,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.end,
              children: [
                TraktSeasonSelect(
                  controller: _c,
                  traktId: p.trakt.trakt.toInt(),
                  value: edit.traktSeason,
                  enabled: !busy,
                  onChanged: (v) => _c.setEdit(p, season: v),
                ),
                OffsetField(
                  value: edit.episodeOffset,
                  enabled: !busy,
                  onChanged: (v) => _c.setEdit(p, offset: v),
                ),
              ],
            ),
            if (m != null)
              Padding(
                key: ValueKey('meaning:${p.animeKey}'),
                padding: const EdgeInsets.only(top: 6),
                child: Wrap(
                  spacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    LinkText(m.trakt),
                    const Text('='),
                    LinkList(m.anime, separator: ', '),
                    if (!p.placement.fromProgress)
                      const Tag('check this', tone: TagTone.warning),
                  ],
                ),
              ),
            const SizedBox(height: 4),
            Text(offsetHelp, style: muted),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                FilledButton.icon(
                  key: ValueKey('proposal-confirm:${p.animeKey}'),
                  onPressed: busy ? null : () => _confirm(p),
                  icon: busy
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.check),
                  label: const Text('Confirm'),
                ),
                OutlinedButton.icon(
                  key: ValueKey('proposal-reject:${p.animeKey}'),
                  onPressed: busy ? null : () => _reject(p),
                  icon: const Icon(Icons.close),
                  label: const Text('Not this show'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _unlinkedRow(BuildContext context, UnlinkedRow u) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Padding(
      key: ValueKey('unlinked:${u.key}'),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: Wrap(
              spacing: 6,
              runSpacing: 2,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  u.title,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                Text('on', style: muted),
                LinkList(u.links, style: muted),
                if (u.format != null && u.format!.toLowerCase() != 'tv')
                  Tag(formatLabel(u.format!)),
                if (u.sideStory)
                  Text(
                    'specials, OVAs and movies are not linked yet',
                    style: muted,
                  ),
              ],
            ),
          ),
          if (!u.sideStory)
            FilledButton.tonalIcon(
              key: ValueKey('link-to-trakt:${u.key}'),
              onPressed: () => showWriteSheet(
                context,
                LinkToTraktSheet(controller: _c, row: u),
              ),
              icon: const Icon(Icons.search, size: 16),
              label: const Text('Link to Trakt'),
            ),
        ],
      ),
    );
  }

  Widget _tabs(List<LinkRow> rows) {
    final anime = rowsForTab(rows, 'anime').length;
    final show = rowsForTab(rows, 'show').length;
    final rejected = rowsForTab(rows, 'rejected').length;
    if (_tab == 'rejected' && rejected == 0) _tab = 'anime';
    return Align(
      alignment: Alignment.centerLeft,
      child: SegmentedButton<String>(
        key: const ValueKey('links-tabs'),
        showSelectedIcon: false,
        segments: [
          ButtonSegment(value: 'anime', label: Text('Anime ($anime)')),
          ButtonSegment(value: 'show', label: Text('Shows ($show)')),
          if (rejected > 0)
            ButtonSegment(
              value: 'rejected',
              label: Text('Unlinked shows ($rejected)'),
            ),
        ],
        selected: {_tab},
        onSelectionChanged: (s) => setState(() {
          _tab = s.first;
          _editing = null;
          _unlinking = null;
        }),
      ),
    );
  }

  Tag _how(LinkRow r) => Tag(
    r.how,
    tone: r.status == 'confirmed' ? TagTone.success : TagTone.neutral,
  );

  Widget _list(BuildContext context, List<LinkRow> all) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final rows = rowsForTab(all, _tab);
    if (rows.isEmpty) {
      return Text(
        _tab == 'anime' ? 'No anime linked yet.' : 'No shows linked yet.',
        style: theme.textTheme.bodyMedium,
      );
    }
    return _box(context, [
      for (final r in rows)
        Padding(
          key: ValueKey('link:${r.key}'),
          padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        LinkText(
                          LinkItem(r.traktTitle, r.traktUrl, source: 'trakt'),
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        if (r.kind == 'anime')
                          Text(
                            r.traktSeason == null
                                ? 'not placed'
                                : 'S${r.traktSeason} · offset ${r.episodeOffset}',
                            style: muted,
                          ),
                      ],
                    ),
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text('${r.entryTitle} on ', style: muted),
                        LinkList(r.entryLinks, style: muted),
                      ],
                    ),
                  ],
                ),
              ),
              _how(r),
              if (r.status == 'rejected')
                TextButton(
                  key: ValueKey('restore:${r.key}'),
                  onPressed: _c.busy != null ? null : () => _restore(r),
                  child: const Text('Link again'),
                )
              else
                PopupMenuButton<String>(
                  key: ValueKey('link-menu:${r.key}'),
                  tooltip: 'More',
                  onSelected: (v) {
                    if (v == 'edit') {
                      showWriteSheet(
                        context,
                        EditLinkSheet(controller: _c, row: r),
                      );
                    } else {
                      _askUnlink(r);
                    }
                  },
                  itemBuilder: (_) => [
                    if (r.seasonId != null)
                      const PopupMenuItem(value: 'edit', child: Text('Edit')),
                    const PopupMenuItem(value: 'unlink', child: Text('Unlink')),
                  ],
                ),
            ],
          ),
        ),
    ]);
  }

  Widget _table(BuildContext context, List<LinkRow> all) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final rows = rowsForTab(all, _tab);
    final anime = _tab == 'anime';
    Widget head(Widget child) => Padding(
      padding: const EdgeInsets.all(8),
      child: DefaultTextStyle.merge(
        style: theme.textTheme.labelMedium?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
        child: child,
      ),
    );
    Widget cell(Widget child) =>
        Padding(padding: const EdgeInsets.all(8), child: child);
    Widget labelWith(List<String> sources, String text) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final s in sources) ...[SourceIcon(s), const SizedBox(width: 3)],
        Flexible(child: Text(text)),
      ],
    );
    if (rows.isEmpty) {
      return Text(
        anime ? 'No anime linked yet.' : 'No shows linked yet.',
        style: theme.textTheme.bodyMedium,
      );
    }
    final line = BorderSide(color: theme.colorScheme.outlineVariant);
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        border: Border.fromBorderSide(line),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Table(
        defaultVerticalAlignment: TableCellVerticalAlignment.middle,
        columnWidths: anime
            ? const {
                0: FlexColumnWidth(3),
                1: FlexColumnWidth(2.2),
                2: FlexColumnWidth(2),
                3: FlexColumnWidth(3.5),
                4: FlexColumnWidth(1.4),
                5: FlexColumnWidth(2.4),
              }
            : const {
                0: FlexColumnWidth(3),
                1: FlexColumnWidth(3.5),
                2: FlexColumnWidth(1.4),
                3: FlexColumnWidth(2.4),
              },
        border: TableBorder(horizontalInside: line),
        children: [
          TableRow(
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerLow,
            ),
            children: [
              head(labelWith(['trakt'], 'Trakt show')),
              if (anime) ...[
                head(labelWith(['trakt'], 'Trakt season')),
                head(const Text('Offset')),
              ],
              head(
                labelWith(
                  anime ? ['simkl', 'mal'] : ['simkl'],
                  anime ? 'Simkl / MAL entry' : 'Simkl show',
                ),
              ),
              head(const Text('How')),
              head(const SizedBox.shrink()),
            ],
          ),
          for (final r in rows) _tableRow(context, r, anime, cell, muted),
        ],
      ),
    );
  }

  TableRow _tableRow(
    BuildContext context,
    LinkRow r,
    bool anime,
    Widget Function(Widget) cell,
    TextStyle? muted,
  ) {
    final editing = _editing == r.key;
    final busy = _c.busy == r.key;
    return TableRow(
      key: ValueKey('link:${r.key}'),
      children: [
        cell(
          LinkText(
            LinkItem(r.traktTitle, r.traktUrl, source: 'trakt'),
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        ),
        if (anime) ...[
          cell(
            editing
                ? TraktSeasonSelect(
                    controller: _c,
                    traktId: r.traktId,
                    value: _editSeason,
                    enabled: !busy,
                    onChanged: (v) => setState(() => _editSeason = v),
                  )
                : r.traktSeason != null
                ? LinkText(LinkItem('S${r.traktSeason}', r.traktSeasonUrl))
                : Text('not placed', style: muted),
          ),
          cell(
            editing
                ? OffsetField(
                    value: _editOffset,
                    enabled: !busy,
                    onChanged: (v) => setState(() => _editOffset = v),
                  )
                : Text(r.traktSeason != null ? '${r.episodeOffset}' : ''),
          ),
        ],
        cell(
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(r.entryTitle),
              if (r.entryLinks.isNotEmpty)
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text('on ', style: muted),
                    LinkList(r.entryLinks, style: muted),
                  ],
                ),
            ],
          ),
        ),
        cell(Align(alignment: Alignment.centerLeft, child: _how(r))),
        cell(
          Wrap(
            alignment: WrapAlignment.end,
            spacing: 4,
            children: [
              if (r.status == 'rejected')
                TextButton(
                  key: ValueKey('restore:${r.key}'),
                  onPressed: _c.busy != null ? null : () => _restore(r),
                  child: const Text('Link again'),
                )
              else if (editing) ...[
                FilledButton(
                  key: ValueKey('row-save:${r.key}'),
                  onPressed: busy || _editSeason == null
                      ? null
                      : () => _saveRow(r),
                  child: const Text('Save'),
                ),
                TextButton(
                  onPressed: () => setState(() => _editing = null),
                  child: const Text('Cancel'),
                ),
              ] else ...[
                if (r.seasonId != null)
                  TextButton(
                    key: ValueKey('row-edit:${r.key}'),
                    onPressed: () => setState(() {
                      _editing = r.key;
                      _editSeason = r.traktSeason;
                      _editOffset = r.episodeOffset;
                      _unlinking = null;
                    }),
                    child: const Text('Edit'),
                  ),
                _unlinking == r.key
                    ? FilledButton(
                        key: ValueKey('row-unlink:${r.key}'),
                        style: FilledButton.styleFrom(
                          backgroundColor: Theme.of(context).colorScheme.error,
                          foregroundColor: Theme.of(context)
                              .colorScheme
                              .onError,
                        ),
                        onPressed: busy ? null : () => _unlink(r),
                        child: const Text('Confirm unlink'),
                      )
                    : TextButton(
                        key: ValueKey('row-unlink:${r.key}'),
                        onPressed: () => _unlink(r),
                        child: const Text('Unlink'),
                      ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
