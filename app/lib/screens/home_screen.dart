import 'package:flutter/material.dart';

import '../api/tsuzuku_api.dart';
import '../app_controller.dart';
import '../server/connection.dart';
import 'settings_screen.dart';

/// The skeleton's only screen (#108, 3.1): the per-source status, proving the connection. Up Next
/// replaces it at 3.4.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Future<List<SourceStatusInfo>> _status = _load();

  Future<List<SourceStatusInfo>> _load() =>
      widget.controller.api!.sources.getSourcesStatus();

  void _refresh() => setState(() => _status = _load());

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Tsuzuku'),
        actions: [
          IconButton(
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
          IconButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => SettingsScreen(controller: widget.controller),
              ),
            ),
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'Settings',
          ),
        ],
      ),
      body: Column(
        children: [
          VersionBanner(controller: widget.controller),
          Expanded(
            child: FutureBuilder(
              future: _status,
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(describeError(snapshot.error!)),
                    ),
                  );
                }
                final sources = snapshot.data;
                if (sources == null) {
                  return const Center(child: CircularProgressIndicator());
                }
                return ListView(
                  children: [
                    for (final s in sources)
                      ListTile(
                        title: Text(s.source.toJson()),
                        subtitle: Text(
                          [
                            s.connected ? 'connected' : 'not connected',
                            if (s.status != null) s.status!.toJson(),
                            if (s.lastError != null) s.lastError!,
                          ].join(' · '),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        ],
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
