import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../mappings/mappings_screen.dart';
import '../server/connection.dart';
import '../settings/appearance.dart';
import '../settings/backups_section.dart';
import '../settings/sources_section.dart';
import '../up_next/format.dart' show sidePadding;
import '../up_next/source_ui.dart';
import '../update/update_controller.dart';
import 'server_form.dart';
import 'update_widgets.dart';
import '../theme/solid_glass.dart';
import 'app_title.dart';

// Settings (#108, step 3.6; legacy `SettingsPanel.vue`): sources and Mappings, appearance, backups, the server and
// About. Progress has one style only (Aired vs upcoming, decided in 3.4), so there is no progress picker.

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({
    super.key,
    required this.controller,
    this.updates,
    this.appearance,
  });

  final AppController controller;
  final UpdateController? updates;
  final AppearanceController? appearance;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const AppTitle('Settings')),
      body: ListenableBuilder(
        listenable: controller,
        builder: (context, _) => LayoutBuilder(
          builder: (context, box) {
            final config = controller.config;
            final api = controller.api;
            final server = controller.serverApiVersion;
            final pad = sidePadding(box.maxWidth, wide: box.maxWidth >= 840);
            Widget inset(Widget child) => Padding(
              padding: EdgeInsets.symmetric(horizontal: pad),
              child: child,
            );
            return ListView(
              padding: EdgeInsets.only(
                bottom: 32 + MediaQuery.paddingOf(context).bottom,
              ),
              children: [
                if (appearance != null) ...[
                  inset(const _Header('Appearance')),
                  inset(_ModePicker(appearance: appearance!)),
                ],
                if (api != null && config != null) ...[
                  inset(const _Header('Sources')),
                  inset(SourcesSection(api: api, config: config)),
                  const SizedBox(height: 8),
                  inset(
                    _MappingsTile(
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => MappingsScreen(api: api),
                        ),
                      ),
                    ),
                  ),
                ],
                if (api != null) ...[
                  inset(const _Header('Backups')),
                  inset(BackupsSection(api: api)),
                ],
                // The web build is served by the server itself: nothing to set.
                if (!controller.web && config != null) ...[
                  inset(const _Header('Server')),
                  inset(
                    ListTile(
                      contentPadding: EdgeInsets.zero,
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
                  ),
                ],
                inset(const _Header('About')),
                if (updates != null) inset(UpdateSection(updates: updates!)),
                inset(
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('API version'),
                    subtitle: Text(
                      'App $appApiVersion, server ${server ?? 'unknown'}',
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _MappingsTile extends StatelessWidget {
  const _MappingsTile({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return PaneCard(
      key: const ValueKey('open-mappings'),
      radius: Glass.controlRadius,
      onTap: onTap,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          Icon(Icons.link, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Mappings',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                Text.rich(
                  TextSpan(
                    style: muted,
                    children: [
                      const TextSpan(
                        text: 'Confirm, fix or undo links between ',
                      ),
                      sourceSpan('trakt', style: muted),
                      const TextSpan(text: ', '),
                      sourceSpan('simkl', style: muted),
                      const TextSpan(text: ' and '),
                      sourceSpan('mal', style: muted),
                      const TextSpan(text: '.'),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right, color: theme.colorScheme.onSurfaceVariant),
        ],
      ),
    );
  }
}

/// Light, dark or the device's own setting.
class _ModePicker extends StatelessWidget {
  const _ModePicker({required this.appearance});

  final AppearanceController appearance;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: appearance,
    builder: (context, _) => Align(
      alignment: Alignment.centerLeft,
      child: SegmentedButton<ThemeMode>(
        key: const ValueKey('theme-mode'),
        segments: const [
          ButtonSegment(
            value: ThemeMode.system,
            icon: Icon(Icons.brightness_auto_outlined),
            label: Text('System'),
          ),
          ButtonSegment(
            value: ThemeMode.light,
            icon: Icon(Icons.light_mode_outlined),
            label: Text('Light'),
          ),
          ButtonSegment(
            value: ThemeMode.dark,
            icon: Icon(Icons.dark_mode_outlined),
            label: Text('Dark'),
          ),
        ],
        selected: {appearance.mode},
        onSelectionChanged: (s) => appearance.setMode(s.first),
      ),
    ),
  );
}

class _Header extends StatelessWidget {
  const _Header(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 24, bottom: 8),
      child: Text(
        text,
        style: Theme.of(context).textTheme.titleSmall
            ?.copyWith(color: Theme.of(context).colorScheme.primary),
      ),
    );
  }
}
