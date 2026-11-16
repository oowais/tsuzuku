import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../server/connection.dart';
import '../settings/appearance.dart';
import '../theme/solid_glass.dart';
import '../server/server_config.dart';
import '../calendar/calendar_screen.dart';
import '../mappings/mappings_screen.dart';
import '../movies/movies_screen.dart';
import '../stats/stats_screen.dart';
import '../up_next/poster.dart';
import '../up_next/up_next_screen.dart';
import '../update/update_controller.dart';
import '../writes/anime_add.dart';
import '../writes/write_log_screen.dart';
import '../writes/write_sheets.dart' show showWriteSheet;
import 'settings_screen.dart';
import 'update_widgets.dart';
import 'app_title.dart';

/// The home screen (#108, 3.6): the tabs of legacy's tab bar (Shows, Movies, Calendar, Stats, Log, Settings) in a
/// bottom bar on every screen size, as legacy's `AppTabBar`: full width on phones, a floating bar of its own width on
/// wider screens; with the version banner and the What's new sheet. A tab is
/// built the first time it is opened and then kept, so switching back does not reload it.
class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.controller,
    this.updates,
    this.appearance,
  });

  final AppController controller;
  final UpdateController? updates;
  final AppearanceController? appearance;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

/// Width from which the tab bar floats: its own width, centred, off the bottom edge (legacy's `sm`, 640 px).
const floatingBarWidth = 640.0;

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;
  final _visited = <int>{0};

  List<({String label, IconData icon, IconData selected})> get _tabs => const [
    (label: 'Shows', icon: Icons.tv_outlined, selected: Icons.tv),
    (label: 'Movies', icon: Icons.movie_outlined, selected: Icons.movie),
    (
      label: 'Calendar',
      icon: Icons.calendar_month_outlined,
      selected: Icons.calendar_month,
    ),
    (label: 'Stats', icon: Icons.bar_chart_outlined, selected: Icons.bar_chart),
    (label: 'Log', icon: Icons.history_outlined, selected: Icons.history),
    (
      label: 'Settings',
      icon: Icons.settings_outlined,
      selected: Icons.settings,
    ),
  ];

  void _select(int i) => setState(() {
    _tab = i;
    _visited.add(i);
  });

  Widget _page(int i) {
    final controller = widget.controller;
    final config = controller.config;
    final posters = config == null ? null : PosterSource(config);
    return switch (i) {
      0 => ShowsScreen(controller: controller, onOpenMovies: () => _select(1)),
      1 => MoviesScreen(
        api: controller.api!,
        posters: posters,
        snapshots: controller.snapshots,
        offline: controller.offline,
      ),
      2 => CalendarScreen(
        api: controller.api!,
        snapshots: controller.snapshots,
        offline: controller.offline,
      ),
      3 => StatsScreen(
        api: controller.api!,
        snapshots: controller.snapshots,
        offline: controller.offline,
      ),
      4 => WriteLogScreen(
        load: () => controller.api!.writeLog.getWriteLog(),
        posters: posters,
      ),
      _ => SettingsScreen(
        controller: controller,
        updates: widget.updates,
        appearance: widget.appearance,
      ),
    };
  }

  Widget _icon(int i, {required bool selected}) {
    final t = _tabs[i];
    final icon = Icon(selected ? t.selected : t.icon);
    if (i != 5 || widget.updates == null) return icon;
    final u = widget.updates!;
    // The dot when an update is ready, as on the old Settings button.
    return ListenableBuilder(
      listenable: u,
      builder: (context, _) => Badge(
        isLabelVisible: u.available != null,
        smallSize: 10,
        backgroundColor: Theme.of(context).colorScheme.primary,
        child: icon,
      ),
    );
  }

  /// Phones: full width along the bottom edge, square corners.
  Widget _phoneBar(Widget bar) =>
      FloatPane(borderRadius: BorderRadius.zero, child: bar);

  /// Wider screens: legacy's floating bar, at most 512 px wide (`max-w-lg`), centred, 16 px above the bottom edge
  /// (plus the safe area), with Solid Glass's tab bar radius (1.225rem).
  Widget _floatingBar(Widget bar) => SafeArea(
    top: false,
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Center(
        heightFactor: 1,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 512),
          child: FloatPane(
            borderRadius: const BorderRadius.all(Radius.circular(19.6)),
            child: bar,
          ),
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final floating = MediaQuery.sizeOf(context).width >= floatingBarWidth;
    final pages = IndexedStack(
      index: _tab,
      children: [
        for (var i = 0; i < _tabs.length; i++)
          _visited.contains(i) ? _page(i) : const SizedBox.shrink(),
      ],
    );
    final body = WhatsNewOnStart(
      updates: widget.updates,
      child: Column(
        children: [
          VersionBanner(controller: widget.controller),
          Expanded(child: pages),
        ],
      ),
    );
    final bar = NavigationBar(
      backgroundColor: Colors.transparent,
      key: const ValueKey('nav-bar'),
      selectedIndex: _tab,
      onDestinationSelected: _select,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      destinations: [
        for (var i = 0; i < _tabs.length; i++)
          NavigationDestination(
            icon: _icon(i, selected: false),
            selectedIcon: _icon(i, selected: true),
            label: _tabs[i].label,
          ),
      ],
    );
    return Scaffold(
      body: body,
      // The tab bar is a pane of the floating layer: content scrolls under its glass.
      extendBody: true,
      bottomNavigationBar: floating ? _floatingBar(bar) : _phoneBar(bar),
    );
  }
}

/// Shows: Up Next (#108, 3.4) with its writes (3.5).
class ShowsScreen extends StatefulWidget {
  const ShowsScreen({super.key, required this.controller, this.onOpenMovies});

  final AppController controller;

  /// Switches to the Movies tab (anime movies are added there).
  final VoidCallback? onOpenMovies;

  @override
  State<ShowsScreen> createState() => _ShowsScreenState();
}

class _ShowsScreenState extends State<ShowsScreen> {
  final _upNext = GlobalKey<UpNextViewState>();
  bool _searchOpen = false;

  /// "Add an anime": search, pick, the per-source preview; Shows reloads when something was written.
  Future<void> _addAnime() async {
    final api = widget.controller.api;
    if (api == null) return;
    final config = widget.controller.config;
    final flow = AnimeAddFlow(api: api);
    await showWriteSheet(
      context,
      AnimeAddSheet(
        flow: flow,
        posters: config == null ? null : PosterSource(config),
        onOpenMovies: widget.onOpenMovies,
      ),
    );
    if (flow.wrote) await _upNext.currentState?.reload();
    flow.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final config = widget.controller.config;
    return Scaffold(
      appBar: tabAppBar(
        context,
        title: AppTitle(
          devServerUrl.isEmpty ? 'Shows' : 'Shows · dev: ${config?.baseUrl}',
        ),
        actions: [
          IconButton(
            key: const ValueKey('anime-add'),
            // Offline: read-only (#108, 3.7).
            onPressed: widget.controller.offline ? null : _addAnime,
            icon: const Icon(Icons.add),
            tooltip: 'Add an anime',
          ),
          IconButton(
            onPressed: () => setState(() => _searchOpen = !_searchOpen),
            icon: Icon(_searchOpen ? Icons.search_off : Icons.search),
            tooltip: _searchOpen ? 'Close search' : 'Search',
          ),
          IconButton(
            onPressed: () => _upNext.currentState?.reload(),
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: UpNextView(
        key: _upNext,
        load: () => widget.controller.api!.upNext.getUpNext(),
        posters: config == null ? null : PosterSource(config),
        searchOpen: _searchOpen,
        api: widget.controller.api,
        snapshots: widget.controller.snapshots,
        offline: widget.controller.offline,
        onOpenMappings: widget.controller.api == null
            ? null
            : () async {
                await Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => MappingsScreen(api: widget.controller.api!),
                  ),
                );
                // Confirming links changes Up Next.
                await _upNext.currentState?.reload();
              },
      ),
    );
  }
}

/// The server speaks a different `apiVersion` than this app was built for.
class VersionBanner extends StatelessWidget {
  const VersionBanner({super.key, required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final server = controller.serverApiVersion;
        if (!controller.versionMismatch || server == null) {
          return const SizedBox.shrink();
        }
        final message = server > appApiVersion
            ? 'The server is newer than this app (API $server, app $appApiVersion). '
                  'Update the app.'
            : 'This app is newer than the server (API $server, app $appApiVersion). '
                  'Update the server.';
        return MaterialBanner(
          content: Text(message),
          leading: const Icon(Icons.system_update_outlined),
          actions: [
            TextButton(
              onPressed: controller.checkVersion,
              child: const Text('Check again'),
            ),
          ],
        );
      },
    );
  }
}
