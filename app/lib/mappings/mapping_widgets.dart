import 'dart:async';

import 'package:flutter/material.dart';

import '../api/tsuzuku_api.dart';
import '../up_next/source_ui.dart';
import '../up_next/up_next_card.dart' show openUrl;
import '../writes/write_flows.dart' show writeErrorText;
import '../writes/write_sheets.dart';
import 'mapping_logic.dart';
import 'mappings_controller.dart';

// Pieces shared by the Mappings page and its sheets.

/// A source name or title linking to its page, dotted underline (legacy `SourceLinks`).
class LinkText extends StatelessWidget {
  const LinkText(this.item, {super.key, this.style});

  final LinkItem item;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final url = item.url;
    final text = Text(
      item.label,
      style: (style ?? const TextStyle()).copyWith(
        decoration: url == null ? null : TextDecoration.underline,
        decorationStyle: TextDecorationStyle.dotted,
      ),
    );
    final child = item.source == null
        ? text
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SourceIcon(item.source!),
              const SizedBox(width: 4),
              Flexible(child: text),
            ],
          );
    if (url == null) return child;
    return InkWell(onTap: () => openUrl(url), child: child);
  }
}

/// "Simkl + MAL", each linked.
class LinkList extends StatelessWidget {
  const LinkList(this.items, {super.key, this.style, this.separator = ' + '});

  final List<LinkItem> items;
  final TextStyle? style;
  final String separator;

  @override
  Widget build(BuildContext context) => Wrap(
    crossAxisAlignment: WrapCrossAlignment.center,
    children: [
      for (final (i, l) in items.indexed) ...[
        if (i > 0) Text(separator, style: style),
        LinkText(l, style: style),
      ],
    ],
  );
}

/// Picks a season of a Trakt show from Trakt's own seasons with episode counts (legacy `TraktSeasonSelect`).
class TraktSeasonSelect extends StatelessWidget {
  const TraktSeasonSelect({
    super.key,
    required this.controller,
    required this.traktId,
    required this.value,
    required this.onChanged,
    this.enabled = true,
  });

  final MappingsController controller;
  final int traktId;
  final int? value;
  final ValueChanged<int> onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) =>
      FutureBuilder<GetTraktSeasonsResponse200>(
        future: controller.seasons(traktId),
        builder: (context, snap) {
          final label = Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SourceIcon('trakt'),
              const SizedBox(width: 4),
              Text(
                'Trakt season',
                style: Theme.of(context).textTheme.labelMedium,
              ),
            ],
          );
          if (snap.hasError) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                label,
                Text(
                  'Could not load seasons: ${writeErrorText(snap.error!)}',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
            );
          }
          final data = snap.data;
          final seasons = data?.data ?? const <TraktSeason>[];
          final known = seasons.any((s) => s.number == value);
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              label,
              if (data == null)
                const Padding(
                  padding: EdgeInsets.all(8),
                  child: SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              else if (data.status.toJson() != 'ok' && seasons.isEmpty)
                Text(
                  'Trakt is not answering (${data.status.toJson()}).',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                )
              else
                DropdownButton<int>(
                  key: ValueKey('season-select:$traktId'),
                  value: known ? value : null,
                  hint: const Text('Season'),
                  onChanged: enabled
                      ? (v) => v == null ? null : onChanged(v)
                      : null,
                  items: [
                    for (final s in seasons)
                      DropdownMenuItem(
                        value: s.number.toInt(),
                        child: Text(seasonLabel(s)),
                      ),
                  ],
                ),
            ],
          );
        },
      );
}

/// Episode offset: a number, minus and plus.
class OffsetField extends StatefulWidget {
  const OffsetField({
    super.key,
    required this.value,
    required this.onChanged,
    this.enabled = true,
  });

  final int value;
  final ValueChanged<int> onChanged;
  final bool enabled;

  @override
  State<OffsetField> createState() => _OffsetFieldState();
}

class _OffsetFieldState extends State<OffsetField> {
  late final _text = TextEditingController(text: '${widget.value}');

  @override
  void didUpdateWidget(OffsetField old) {
    super.didUpdateWidget(old);
    if (int.tryParse(_text.text) != widget.value) {
      _text.text = '${widget.value}';
    }
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    mainAxisSize: MainAxisSize.min,
    children: [
      Text('Episode offset', style: Theme.of(context).textTheme.labelMedium),
      Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            onPressed: widget.enabled
                ? () => widget.onChanged(widget.value - 1)
                : null,
            icon: const Icon(Icons.remove),
            tooltip: 'Less',
            visualDensity: VisualDensity.compact,
          ),
          SizedBox(
            width: 56,
            child: TextField(
              key: const ValueKey('offset-field'),
              controller: _text,
              enabled: widget.enabled,
              textAlign: TextAlign.center,
              keyboardType: const TextInputType.numberWithOptions(signed: true),
              decoration: const InputDecoration(
                isDense: true,
                border: OutlineInputBorder(),
              ),
              onChanged: (t) {
                final v = int.tryParse(t.trim());
                if (v != null) widget.onChanged(v);
              },
            ),
          ),
          IconButton(
            onPressed: widget.enabled
                ? () => widget.onChanged(widget.value + 1)
                : null,
            icon: const Icon(Icons.add),
            tooltip: 'More',
            visualDensity: VisualDensity.compact,
          ),
        ],
      ),
    ],
  );
}

const offsetHelp = "Episode offset: Trakt episode minus this entry's episode.";

/// Edit a stored anime link's season and offset (phones; wide screens edit in the row). Saves only on Save.
class EditLinkSheet extends StatefulWidget {
  const EditLinkSheet({super.key, required this.controller, required this.row});

  final MappingsController controller;
  final LinkRow row;

  @override
  State<EditLinkSheet> createState() => _EditLinkSheetState();
}

class _EditLinkSheetState extends State<EditLinkSheet> {
  late int? _season = widget.row.traktSeason;
  late int _offset = widget.row.episodeOffset;
  String? _error;

  Future<void> _save() async {
    final season = _season;
    if (season == null) return;
    final error = await widget.controller.edit(
      widget.row,
      traktSeason: season,
      episodeOffset: _offset,
    );
    if (!mounted) return;
    if (error == null) {
      Navigator.of(context).pop();
    } else {
      setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final saving = widget.controller.busy == widget.row.key;
      final muted = Theme.of(context).textTheme.bodySmall
          ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant);
      return SheetFrame(
        title: 'Edit link',
        subtitle: '${widget.row.traktTitle} · ${widget.row.entryTitle}',
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_error != null) SheetAlert(text: _error!, error: true),
            const SizedBox(height: 8),
            Wrap(
              spacing: 16,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.end,
              children: [
                TraktSeasonSelect(
                  controller: widget.controller,
                  traktId: widget.row.traktId,
                  value: _season,
                  enabled: !saving,
                  onChanged: (v) => setState(() => _season = v),
                ),
                OffsetField(
                  value: _offset,
                  enabled: !saving,
                  onChanged: (v) => setState(() => _offset = v),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(offsetHelp, style: muted),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('edit-save'),
            onPressed: saving || _season == null ? null : _save,
            child: const Text('Save'),
          ),
        ],
      );
    },
  );
}

/// "Link to Trakt" (legacy `LinkToTraktModal.vue`): search Trakt (or paste a trakt.tv link), pick the show, pick the
/// season, confirm. Only shows Trakt returns can be picked; the server checks the ID with Trakt again on confirm.
class LinkToTraktSheet extends StatefulWidget {
  const LinkToTraktSheet({
    super.key,
    required this.controller,
    required this.row,
  });

  final MappingsController controller;
  final UnlinkedRow row;

  @override
  State<LinkToTraktSheet> createState() => _LinkToTraktSheetState();
}

class _LinkToTraktSheetState extends State<LinkToTraktSheet> {
  late final _query = TextEditingController(text: widget.row.query);
  GetTraktSearchResponse200? _results;
  bool _searching = false;
  String? _error;
  Timer? _timer;
  TraktShow? _picked;
  int? _season;
  int _offset = 0;

  @override
  void initState() {
    super.initState();
    _search(widget.row.query);
  }

  @override
  void dispose() {
    _timer?.cancel();
    _query.dispose();
    super.dispose();
  }

  /// Searches once typing pauses, not on every key.
  void _typed(String q) {
    _timer?.cancel();
    _timer = Timer(const Duration(milliseconds: 400), () => _search(q));
  }

  Future<void> _search(String q) async {
    if (q.trim().isEmpty) {
      setState(() => _results = null);
      return;
    }
    setState(() {
      _searching = true;
      _error = null;
    });
    try {
      final r = await widget.controller.api.trakt.getTraktSearch(q: q.trim());
      if (mounted && q == _query.text) setState(() => _results = r);
    } catch (e) {
      if (mounted) setState(() => _error = writeErrorText(e));
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _confirm() async {
    final p = _picked;
    final season = _season;
    if (p == null || season == null) return;
    final error = await widget.controller.link(
      animeKey: widget.row.key,
      traktId: p.trakt.toInt(),
      traktSeason: season,
      episodeOffset: _offset,
    );
    if (!mounted) return;
    if (error == null) {
      Navigator.of(context).pop();
    } else {
      setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final saving = widget.controller.busy == widget.row.key;
      return SheetFrame(
        title: 'Link to Trakt',
        subtitle: 'Find the Trakt show this entry belongs to, then the season.',
        body: _body(context, saving),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton.icon(
            key: const ValueKey('link-confirm'),
            onPressed: saving || _picked == null || _season == null
                ? null
                : _confirm,
            icon: const Icon(Icons.check),
            label: const Text('Confirm'),
          ),
        ],
      );
    },
  );

  Widget _body(BuildContext context, bool saving) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final row = widget.row;
    final entries = row.entries;
    final episodes =
        entries
            .where((e) => e.source.toJson() == 'mal')
            .firstOrNull
            ?.episodes ??
        entries.firstOrNull?.episodes;
    final format = entries.where((e) => e.format != null).firstOrNull?.format;
    final facts = [
      ?format,
      if (episodes != null) '${episodes.toInt()} episodes',
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null) SheetAlert(text: _error!, error: true),
        const SizedBox(height: 8),
        // The entry being linked: each source's title, links and progress, and its place in the series.
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            border: Border.all(color: theme.colorScheme.outlineVariant),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text('Linking, on ', style: muted),
                  LinkList(row.links, style: muted),
                ],
              ),
              Text(
                row.title,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (facts.isNotEmpty) Text(facts.join(' · '), style: muted),
                  for (final (i, g) in entryNextGroups(entries).indexed) ...[
                    Text(
                      '${i > 0 || facts.isNotEmpty ? ' · ' : ''}next ${g.label} on ',
                      style: muted,
                    ),
                    LinkList(g.links, style: muted),
                  ],
                ],
              ),
              if (row.chain.length > 1)
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text.rich(
                      TextSpan(
                        style: muted,
                        children: [
                          TextSpan(text: 'Season ${row.chain.length} on '),
                          sourceSpan('anilist', style: muted),
                          const TextSpan(text: ': '),
                        ],
                      ),
                    ),
                    for (final (i, c) in row.chain.indexed) ...[
                      if (i > 0) Text(' → ', style: muted),
                      LinkText(
                        LinkItem(c.title, malAnimeUrl(c.malId)),
                        style: muted,
                      ),
                      if (c.episodes != null)
                        Text(' (${c.episodes!.toInt()})', style: muted),
                    ],
                  ],
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        if (_picked == null)
          ..._find(context, muted)
        else
          ..._place(context, saving, muted),
      ],
    );
  }

  List<Widget> _find(BuildContext context, TextStyle? muted) {
    final results = _results;
    return [
      TextField(
        key: const ValueKey('trakt-query'),
        controller: _query,
        autofocus: true,
        onChanged: _typed,
        onSubmitted: _search,
        decoration: InputDecoration(
          hintText: 'Title or https://trakt.tv/shows/…',
          prefixIcon: const Icon(Icons.search),
          suffixIcon: _searching
              ? const Padding(
                  padding: EdgeInsets.all(12),
                  child: SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : null,
          isDense: true,
          border: const OutlineInputBorder(),
        ),
      ),
      if (results != null && results.status.toJson() != 'ok')
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            'Trakt is not answering (${results.status.toJson()}). Try again shortly.',
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
      for (final s in results?.data ?? const <TraktShow>[])
        Padding(
          key: ValueKey('trakt-result:${s.trakt}'),
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    LinkText(
                      LinkItem(s.title, traktShowUrl(s.slug), source: 'trakt'),
                    ),
                    Text(
                      [
                        if (s.year != null) '${s.year!.toInt()}',
                        ?s.originalTitle,
                        if (s.airedEpisodes != null)
                          '${s.airedEpisodes!.toInt()} episodes',
                      ].join(' · '),
                      style: muted,
                    ),
                  ],
                ),
              ),
              FilledButton.tonal(
                key: ValueKey('trakt-pick:${s.trakt}'),
                onPressed: () => setState(() {
                  _picked = s;
                  _season = null;
                  _offset = 0;
                }),
                child: const Text('Pick'),
              ),
            ],
          ),
        ),
      if (results != null && results.data.isEmpty && !_searching)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text('No shows found.', style: muted),
        ),
    ];
  }

  List<Widget> _place(BuildContext context, bool saving, TextStyle? muted) {
    final p = _picked!;
    return [
      Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 6,
        children: [
          LinkText(LinkItem(p.title, traktShowUrl(p.slug), source: 'trakt')),
          if (p.year != null) Text('${p.year!.toInt()}', style: muted),
          TextButton(
            onPressed: saving ? null : () => setState(() => _picked = null),
            child: const Text('Change'),
          ),
        ],
      ),
      const SizedBox(height: 8),
      Wrap(
        spacing: 16,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.end,
        children: [
          TraktSeasonSelect(
            controller: widget.controller,
            traktId: p.trakt.toInt(),
            value: _season,
            enabled: !saving,
            onChanged: (v) => setState(() => _season = v),
          ),
          OffsetField(
            value: _offset,
            enabled: !saving,
            onChanged: (v) => setState(() => _offset = v),
          ),
        ],
      ),
      const SizedBox(height: 4),
      Text(offsetHelp, style: muted),
      if (_season != null)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            '${widget.row.title} E1 = Trakt S${_season}E${1 + _offset}',
            key: const ValueKey('link-meaning'),
          ),
        ),
    ];
  }
}
