import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../server/connection.dart';
import '../server/server_config.dart';
import '../calendar/calendar_screen.dart';
import '../movies/movies_screen.dart';
import '../up_next/poster.dart';
import '../up_next/up_next_screen.dart';
import '../update/update_controller.dart';
import '../writes/anime_add.dart';
import '../writes/write_log_screen.dart';
import '../writes/write_sheets.dart' show showWriteSheet;
import 'settings_screen.dart';
import 'update_widgets.dart';

/// The home screen (#108, 3.6): the tabs of legacy's tab bar (Shows, Movies, Calendar, Stats, Log, Settings) in a
/// bottom bar on phones and a side rail on wide screens, with the version banner and the What's new sheet. A tab is
/// built the first time it is opened and then kept, so switching back does not reload it.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.controller, this.updates});

  final AppController controller;
  final UpdateController? updates;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

/// Width from which the tabs sit in a side rail.
const railWidth = 840.0;

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
      1 => MoviesScreen(api: controller.api!, posters: posters),
      2 => CalendarScreen(api: controller.api!),
      4 => WriteLogScreen(
        load: () => controller.api!.writeLog.getWriteLog(),
        posters: posters,
      ),
      5 => SettingsScreen(controller: controller, updates: widget.updates),
      _ => _NotYet(title: _tabs[i].label),
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

  @override
  Widget build(BuildContext context) {
    final rail = MediaQuery.sizeOf(context).width >= railWidth;
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
    if (rail) {
      return Scaffold(
        body: Row(
          children: [
            NavigationRail(
              key: const ValueKey('nav-rail'),
              selectedIndex: _tab,
              onDestinationSelected: _select,
              labelType: NavigationRailLabelType.all,
              // Part of the page, not a panel beside it: the page's background, no divider, items centred.
              backgroundColor: Colors.transparent,
              groupAlignment: 0,
              destinations: [
                for (var i = 0; i < _tabs.length; i++)
                  NavigationRailDestination(
                    icon: _icon(i, selected: false),
                    selectedIcon: _icon(i, selected: true),
                    label: Text(_tabs[i].label),
                  ),
              ],
            ),
            Expanded(child: body),
          ],
        ),
      );
    }
    return Scaffold(
      body: body,
      bottomNavigationBar: NavigationBar(
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
      ),
    );
  }
}

/// A tab still to come in this step.
class _NotYet extends StatelessWidget {
  const _NotYet({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(title)),
    body: const Center(child: Text('Not built yet.')),
  );
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
      appBar: AppBar(
        title: devServerUrl.isEmpty
            ? const Text('Shows')
            : Text('Shows · dev: ${config?.baseUrl}'),
        actions: [
          IconButton(
            key: const ValueKey('anime-add'),
            onPressed: _addAnime,
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
