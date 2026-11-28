import 'dart:async';

import 'package:flutter/material.dart';

import '../api/tsuzuku_api.dart';
import '../snapshot/snapshot.dart';
import '../snapshot/snapshot_notice.dart';
import '../server/connection.dart';
import '../up_next/format.dart';
import '../up_next/poster.dart';
import '../up_next/source_ui.dart';
import '../up_next/up_next_card.dart' show Tag, TagTone, openUrl;
import '../up_next/up_next_logic.dart' show SourceHealth;
import '../up_next/up_next_screen.dart' show ErrorState, Notice, SourceStrip;
import '../writes/write_flows.dart' show writeErrorText;
import '../writes/write_sheets.dart' show showWriteSheet;
import 'movie_flows.dart';
import 'movie_logic.dart';
import 'movie_sheets.dart';
import '../theme/solid_glass.dart';
import '../screens/app_title.dart';

// Movies (#108, step 3.6; legacy `pages/movies.vue`, #17, decision #25): your movie watchlists on each source, side
// by side, one card per movie. Differences are shown, never resolved; watched everywhere drops off. Every write
// (mark watched, add) goes preview per source, then an explicit confirm.

/// The Movies tab: app bar with Add and Refresh, and the list.
class MoviesScreen extends StatefulWidget {
  const MoviesScreen({
    super.key,
    required this.api,
    this.posters,
    this.snapshots,
    this.offline = false,
  });

  final TsuzukuApi api;
  final PosterSource? posters;

  /// The saved list, shown until the live one arrives (#108, 3.7).
  final SnapshotCache? snapshots;

  /// The server cannot be reached: read-only.
  final bool offline;

  @override
  State<MoviesScreen> createState() => _MoviesScreenState();
}

class _MoviesScreenState extends State<MoviesScreen> {
  final _view = GlobalKey<MoviesViewState>();

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: tabAppBar(
      context,
      title: const AppTitle('Movies'),
      actions: [
        IconButton(
          key: const ValueKey('movie-add'),
          onPressed: widget.offline ? null : () => _view.currentState?.add(),
          icon: const Icon(Icons.add),
          tooltip: 'Add a movie',
        ),
        IconButton(
          onPressed: () => _view.currentState?.reload(),
          icon: const Icon(Icons.refresh),
          tooltip: 'Refresh',
        ),
      ],
    ),
    body: MoviesView(
      key: _view,
      api: widget.api,
      posters: widget.posters,
      snapshots: widget.snapshots,
      offline: widget.offline,
    ),
  );
}

class MoviesView extends StatefulWidget {
  const MoviesView({
    super.key,
    required this.api,
    this.posters,
    this.clock = DateTime.now,
    this.snapshots,
    this.offline = false,
  });

  final TsuzukuApi api;
  final PosterSource? posters;
  final DateTime Function() clock;
  final SnapshotCache? snapshots;
  final bool offline;

  @override
  State<MoviesView> createState() => MoviesViewState();
}

class MoviesViewState extends State<MoviesView> {
  Movies? _data;
  DateTime? _receivedAt;

  /// The fetch time of the shown list while it is the saved one; null once the live list is in.
  DateTime? _savedAt;
  Object? _error;
  bool _loading = false;
  final _open = <String>{};
  late DateTime _now = widget.clock();
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      final now = widget.clock();
      final countdown = _health.any(
        (h) => h.blockedUntil?.isAfter(now) ?? false,
      );
      if (countdown || now.minute != _now.minute) setState(() => _now = now);
    });
    _showSaved();
    reload();
  }

  /// Shows the saved list at once, unless the live one is already in.
  Future<void> _showSaved() async {
    final saved = await widget.snapshots?.read(SnapshotKey.movies);
    if (saved == null || !mounted || _data != null) return;
    try {
      final data = Movies.fromJson(saved.json);
      setState(() {
        _data = data;
        _receivedAt = saved.fetchedAt;
        _savedAt = saved.fetchedAt;
      });
    } catch (_) {
      // Unreadable: wait for the live list.
    }
  }

  /// Writes need the live list and the server.
  bool get _readOnly => widget.offline || _savedAt != null;

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  List<SourceHealth> get _health =>
      _data == null ? const [] : movieHealth(_data!, _receivedAt ?? _now);

  /// Loads the list; the last one stays on screen while the next loads.
  Future<void> reload() async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      final data = await widget.api.movies.getMovies();
      if (!mounted) return;
      final receivedAt = widget.clock();
      setState(() {
        _data = data;
        _receivedAt = receivedAt;
        _savedAt = null;
        _now = receivedAt;
        _error = null;
      });
      widget.snapshots?.write(SnapshotKey.movies, data.toJson(), receivedAt);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> add() => _addPage(MovieAddFlow(api: widget.api));

  Future<void> _fill(MovieRow row) => _addPage(
    MovieAddFlow(api: widget.api, rowKey: row.key, title: row.title),
  );

  Future<void> _addPage(MovieAddFlow flow) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => MovieAddScreen(flow: flow, posters: widget.posters),
      ),
    );
    if (flow.wrote) await reload();
    flow.dispose();
  }

  Future<void> _mark(MovieRow row) async {
    final flow = MovieMarkFlow(
      api: widget.api,
      rowKey: row.key,
      clock: widget.clock,
    );
    await showWriteSheet(context, MovieMarkSheet(flow: flow, title: row.title));
    if (flow.wrote) await reload();
    flow.dispose();
  }

  /// Undoes a link kept from a pick (a wrong pick, say). Nothing at the sources changes.
  Future<void> _unlink(num id) async {
    try {
      await widget.api.movies.deleteMoviesLinksId(id: id.toInt());
      await reload();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Could not remove the link: ${writeErrorText(e)}'),
        ),
      );
    }
  }

  void _toggle(String key) =>
      setState(() => _open.contains(key) ? _open.remove(key) : _open.add(key));

  @override
  Widget build(BuildContext context) {
    final data = _data;
    if (data == null) {
      if (_error != null) return ErrorState(error: _error!, onRetry: reload);
      return const Center(child: CircularProgressIndicator());
    }
    final width = MediaQuery.sizeOf(context).width;
    final columns = width >= 1400
        ? 3
        : width >= 840
        ? 2
        : 1;
    final wide = columns > 1;
    final pad = EdgeInsets.symmetric(
      horizontal: sidePadding(width, wide: wide),
    );
    final health = _health;
    final problems = [
      for (final h in health)
        if (!h.ok) h,
    ];
    final healthy = [
      for (final h in health)
        if (h.ok) h,
    ];
    final rows = data.rows;
    Widget card(MovieRow r) => MovieCard(
      row: r,
      open: _open.contains(r.key),
      onToggle: () => _toggle(r.key),
      posters: widget.posters,
      wide: wide,
      onMark: _readOnly ? null : () => _mark(r),
      onFill: _readOnly ? null : () => _fill(r),
      onUnlink: _readOnly ? null : _unlink,
    );
    return RefreshIndicator(
      onRefresh: reload,
      child: CustomScrollView(
        key: const PageStorageKey('movies'),
        slivers: [
          SliverToBoxAdapter(
            child: _loading
                ? const LinearProgressIndicator(minHeight: 2)
                : const SizedBox(height: 2),
          ),
          SliverPadding(
            padding: pad.copyWith(top: 8, bottom: 12),
            sliver: SliverList.list(
              children: [
                Text(
                  'Your movie watchlists on each source, side by side. Watched everywhere drops off.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
                if (problems.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  SourceStrip(health: problems, now: _now),
                ],
                if (SnapshotNotice.shows(
                  savedAt: _savedAt,
                  offline: widget.offline,
                  loading: _loading,
                ))
                  SnapshotNotice(
                    savedAt: _savedAt,
                    offline: widget.offline,
                    now: _now,
                    error: _error,
                  )
                else if (_error != null)
                  Notice(
                    icon: Icons.cloud_off,
                    warning: true,
                    text:
                        'Could not refresh: ${describeError(_error!)}. Showing the last list.',
                  ),
                if (data.errors.isNotEmpty)
                  Notice(
                    icon: Icons.error_outline,
                    warning: true,
                    title: 'Some list items could not be read',
                    spans: [
                      for (final (i, e) in data.errors.indexed) ...[
                        if (i > 0) const TextSpan(text: ' · '),
                        sourceSpan(e.source.toJson()),
                        TextSpan(text: ': ${e.error}'),
                      ],
                    ],
                  ),
                if (rows.isEmpty)
                  const Notice(
                    icon: Icons.inbox_outlined,
                    text: 'Nothing on your movie watchlists.',
                  ),
              ],
            ),
          ),
          if (columns == 1)
            SliverPadding(
              padding: pad,
              sliver: SliverList.builder(
                itemCount: rows.length,
                itemBuilder: (context, i) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: card(rows[i]),
                ),
              ),
            )
          else
            // Masonry as on Shows: dealt round-robin into columns that stack on their own.
            SliverPadding(
              padding: pad,
              sliver: SliverToBoxAdapter(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (var c = 0; c < columns; c++) ...[
                      if (c > 0) const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          children: [
                            for (var i = c; i < rows.length; i += columns)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 12),
                                child: card(rows[i]),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          SliverPadding(
            padding: pad.copyWith(
              top: 12,
              bottom: 32 + MediaQuery.paddingOf(context).bottom,
            ),
            sliver: SliverToBoxAdapter(
              child: healthy.isEmpty
                  ? const SizedBox.shrink()
                  : SourceStrip(health: healthy, now: _now),
            ),
          ),
        ],
      ),
    );
  }
}

/// One card per movie: poster, title, alt title, year, Anime and differs tags; mark watched at the bottom right.
/// Opened: each source's own view (its state, its own title where it differs, its page).
class MovieCard extends StatelessWidget {
  const MovieCard({
    super.key,
    required this.row,
    required this.open,
    required this.onToggle,
    this.posters,
    this.wide = false,
    this.onMark,
    this.onFill,
    this.onUnlink,
  });

  final MovieRow row;
  final bool open;
  final VoidCallback onToggle;
  final PosterSource? posters;
  final bool wide;
  final VoidCallback? onMark;
  final VoidCallback? onFill;
  final void Function(num linkId)? onUnlink;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: scheme.onSurfaceVariant,
    );
    final canFill = fillable(row) && onFill != null;
    final menu = canFill || (row.links.isNotEmpty && onUnlink != null);
    return PaneCard(
      key: ValueKey('movie:${row.key}'),
      edgeColor: row.differs ? Glass.of(context).warning : null,
      edgeWidth: row.differs ? 1.6 : 1,
      onTap: onToggle,
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Align(
                  alignment: Alignment.topCenter,
                  child: RepaintBoundary(
                    child: Poster(
                      images: row.images,
                      source: posters,
                      width: wide ? 96 : 72,
                      height: wide ? 144 : 108,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        row.title,
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                          height: 1.15,
                        ),
                      ),
                      if (row.altTitle != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(row.altTitle!, style: muted),
                        ),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          if (row.year != null)
                            Text('${row.year!.toInt()}', style: muted),
                          if (row.anime)
                            const Tag('Anime', tone: TagTone.outline),
                          if (row.differs)
                            const Tag('differs', tone: TagTone.warning),
                        ],
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    if (menu)
                      PopupMenuButton<String>(
                        key: ValueKey('movie-menu:${row.key}'),
                        tooltip: 'More',
                        icon: const Icon(Icons.more_horiz),
                        onSelected: (v) {
                          if (v == 'fill') {
                            onFill?.call();
                          } else if (v.startsWith('unlink:')) {
                            onUnlink?.call(num.parse(v.substring(7)));
                          }
                        },
                        itemBuilder: (_) => [
                          if (canFill)
                            const PopupMenuItem(
                              value: 'fill',
                              child: ListTile(
                                leading: Icon(Icons.playlist_add),
                                title: Text('Add to the other watchlists'),
                              ),
                            ),
                          if (onUnlink != null)
                            for (final id in row.links)
                              PopupMenuItem(
                                value: 'unlink:$id',
                                child: ListTile(
                                  leading: Icon(
                                    Icons.link_off,
                                    color: scheme.error,
                                  ),
                                  title: Text(
                                    'Remove your link',
                                    style: TextStyle(color: scheme.error),
                                  ),
                                ),
                              ),
                        ],
                      ),
                    const Spacer(),
                    IconButton.filled(
                      key: ValueKey('movie-mark:${row.key}'),
                      style: inkPaneIconStyle(context),
                      onPressed: onMark,
                      icon: const Icon(Icons.done_all),
                      tooltip: 'Mark watched',
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (open) ...[
            const SizedBox(height: 8),
            for (final s in movieSources(row)) ...[
              const Divider(height: 1),
              _SourceRow(row: row, source: s, onFill: onFill),
            ],
          ],
        ],
      ),
    );
  }
}

/// One source's own view of the movie.
class _SourceRow extends StatelessWidget {
  const _SourceRow({required this.row, required this.source, this.onFill});

  final MovieRow row;
  final String source;
  final VoidCallback? onFill;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    final cell = movieCell(row, source);
    final e = cell.entry;
    final link = e == null ? null : entryUrl(e);
    final name = FittedBox(
      fit: BoxFit.scaleDown,
      alignment: Alignment.centerLeft,
      child: SourceName(
        source,
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
    );
    final Widget body;
    if (e != null) {
      final watched = movieDate(e.watchedAt);
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Tag(
                movieStateLabel(e),
                tone: switch (movieStateTone(e)) {
                  MovieTone.primary => TagTone.primary,
                  MovieTone.success => TagTone.success,
                  MovieTone.neutral => TagTone.neutral,
                },
              ),
              if (e.watchedBefore == true)
                Text(
                  'watched before${watched != null ? ' ($watched)' : ''}',
                  style: muted,
                )
              else if (e.state.toJson() == 'watched' && watched != null)
                Text(watched, style: muted),
            ],
          ),
          if (e.title != row.title)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: InkWell(
                onTap: link == null ? null : () => openUrl(link),
                child: Text(
                  e.title,
                  style: muted,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
        ],
      );
    } else if (absentOf(cell) == 'not_linked') {
      body = Align(
        alignment: Alignment.centerLeft,
        child: TextButton.icon(
          key: ValueKey('fill:${row.key}:$source'),
          style: TextButton.styleFrom(
            padding: EdgeInsets.zero,
            visualDensity: VisualDensity.compact,
          ),
          onPressed: onFill,
          icon: const Icon(Icons.add, size: 16),
          label: Text('Add to ${sourceLabel(source)}'),
        ),
      );
    } else {
      final url = absentUrl(row, source);
      body = Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          InkWell(
            onTap: url == null ? null : () => openUrl(url),
            child: Text(
              absentLabel(cell),
              style: muted?.copyWith(
                decoration: url == null ? null : TextDecoration.underline,
                decorationStyle: TextDecorationStyle.dotted,
              ),
            ),
          ),
          if (fillable(row))
            TextButton.icon(
              style: TextButton.styleFrom(
                padding: EdgeInsets.zero,
                visualDensity: VisualDensity.compact,
              ),
              onPressed: onFill,
              icon: const Icon(Icons.add, size: 16),
              label: const Text('Add'),
            ),
        ],
      );
    }
    return Padding(
      key: ValueKey('movie-source:${row.key}:$source'),
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 88,
            child: link == null
                ? name
                : InkWell(
                    onTap: () => openUrl(link),
                    child: Tooltip(
                      message: '${e!.title} on ${sourceLabel(source)}',
                      child: name,
                    ),
                  ),
          ),
          const SizedBox(width: 12),
          Expanded(child: body),
        ],
      ),
    );
  }
}
