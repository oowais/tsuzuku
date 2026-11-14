import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../server/connection.dart';
import 'server_form.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key, required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListenableBuilder(
        listenable: controller,
        builder: (context, _) {
          final config = controller.config;
          final server = controller.serverApiVersion;
          return ListView(
            children: [
              // The web build is served by the server itself: nothing to set.
              if (!controller.web && config != null) ...[
                const _Header('Server'),
                ListTile(
                  title: Text(config.baseUrl),
                  subtitle: Text(
                    config.hasToken
                        ? 'Service token ${config.clientId}'
                        : 'No Cloudflare Access token',
                  ),
                  trailing: const Icon(Icons.edit_outlined),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) =>
                          ServerSettingsScreen(controller: controller),
                    ),
                  ),
                ),
              ],
              const _Header('About'),
              ListTile(
                title: const Text('API version'),
                subtitle: Text(
                  'App $appApiVersion, server ${server ?? 'unknown'}',
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
      child: Text(
        text,
        style: Theme.of(context).textTheme.titleSmall
            ?.copyWith(color: Theme.of(context).colorScheme.primary),
      ),
    );
  }
}
