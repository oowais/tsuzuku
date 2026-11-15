import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../server/connection.dart';
import '../up_next/poster.dart';
import '../up_next/up_next_screen.dart';
import '../update/update_controller.dart';
import 'settings_screen.dart';
import 'update_widgets.dart';

/// The home screen: Up Next (#108, 3.4), with the version banner and the What's new sheet.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.controller, this.updates});

  final AppController controller;
  final UpdateController? updates;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _upNext = GlobalKey<UpNextViewState>();
  bool _searchOpen = false;

  @override
  Widget build(BuildContext context) {
    final config = widget.controller.config;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Shows'),
        actions: [
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
          IconButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => SettingsScreen(
                  controller: widget.controller,
                  updates: widget.updates,
                ),
              ),
            ),
            icon: SettingsIcon(updates: widget.updates),
            tooltip: 'Settings',
          ),
        ],
      ),
      body: WhatsNewOnStart(
        updates: widget.updates,
        child: Column(
          children: [
            VersionBanner(controller: widget.controller),
            Expanded(
              child: UpNextView(
                key: _upNext,
                load: () => widget.controller.api!.upNext.getUpNext(),
                posters: config == null ? null : PosterSource(config),
                searchOpen: _searchOpen,
              ),
            ),
          ],
        ),
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
