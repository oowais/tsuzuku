import 'package:flutter/material.dart';

import '../update/release.dart';
import '../update/update_controller.dart';
import '../update/whats_new.dart';

/// Settings → About: the version, "Check for updates", and "Update" with its progress (#108, 3.3).
class UpdateSection extends StatelessWidget {
  const UpdateSection({super.key, required this.updates});

  final UpdateController updates;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: updates,
      builder: (context, _) {
        final u = updates;
        final theme = Theme.of(context);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ListTile(
              title: const Text('Version'),
              subtitle: Text(u.current?.toString() ?? 'unknown'),
            ),
            if (u.supported) ...[
              ListTile(
                leading: u.available != null
                    ? Badge(
                        smallSize: 10,
                        backgroundColor: theme.colorScheme.primary,
                        child: const Icon(Icons.system_update_outlined),
                      )
                    : const Icon(Icons.system_update_outlined),
                title: Text(_title(u)),
                subtitle: _subtitle(u) == null ? null : Text(_subtitle(u)!),
                trailing: _action(u),
              ),
              if (u.installing)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: LinearProgressIndicator(value: u.progress),
                ),
              if (u.installError != null)
                _Message(u.installError!, error: true),
              if (u.needsPermission)
                const _Message(
                  'Allow "Install unknown apps" for Tsuzuku, then tap Update again.',
                ),
              if (u.checkError != null) _Message(u.checkError!, error: true),
            ],
            ListTile(
              leading: const Icon(Icons.new_releases_outlined),
              title: const Text("What's new"),
              onTap: () async {
                final notes = await loadReleaseNotes();
                if (context.mounted) await showWhatsNew(context, notes);
              },
            ),
          ],
        );
      },
    );
  }

  String _title(UpdateController u) {
    if (u.installing) {
      final p = u.progress;
      return p == null
          ? 'Downloading ${u.available}…'
          : 'Downloading ${u.available}… ${(p * 100).round()}%';
    }
    if (u.available != null) {
      return u.canInstall
          ? 'Version ${u.available} is ready'
          : 'Version ${u.available} is available';
    }
    if (u.building != null) return 'Version ${u.building} is being built';
    if (u.checking) return 'Checking for updates…';
    return u.latest == null ? 'Not checked yet' : 'Up to date';
  }

  String? _subtitle(UpdateController u) {
    if (u.available != null && u.platform == UpdatePlatform.linux) {
      return 'Shelly updates the AppImage.';
    }
    if (u.building != null) return 'Checked again every 5 minutes.';
    final at = u.latest?.checkedAt;
    if (at == null) return null;
    final local = at.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return 'Checked ${local.year}-${two(local.month)}-${two(local.day)} '
        '${two(local.hour)}:${two(local.minute)}';
  }

  Widget? _action(UpdateController u) {
    if (u.installing) return null;
    if (u.failedInstall != null && u.installError != null) {
      return FilledButton(
        onPressed: u.retryWindowsInstall,
        child: const Text('Try again'),
      );
    }
    if (u.canInstall) {
      return FilledButton(onPressed: u.install, child: const Text('Update'));
    }
    return TextButton(
      onPressed: u.checking ? null : () => u.check(force: true),
      child: const Text('Check for updates'),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message(this.text, {this.error = false});

  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: SelectableText(
        text,
        style: TextStyle(color: error ? scheme.error : null),
      ),
    );
  }
}

/// The settings icon with a dot while an update is ready.
class SettingsIcon extends StatelessWidget {
  const SettingsIcon({super.key, this.updates});

  final UpdateController? updates;

  @override
  Widget build(BuildContext context) {
    final u = updates;
    if (u == null) return const Icon(Icons.settings_outlined);
    return ListenableBuilder(
      listenable: u,
      builder: (context, _) => Badge(
        isLabelVisible: u.available != null,
        smallSize: 10,
        backgroundColor: Theme.of(context).colorScheme.primary,
        child: const Icon(Icons.settings_outlined),
      ),
    );
  }
}

/// Shows "What's new" once after an update (the first start of a newer version).
class WhatsNewOnStart extends StatefulWidget {
  const WhatsNewOnStart({super.key, required this.child, this.updates});

  final Widget child;
  final UpdateController? updates;

  @override
  State<WhatsNewOnStart> createState() => _WhatsNewOnStartState();
}

class _WhatsNewOnStartState extends State<WhatsNewOnStart> {
  @override
  void initState() {
    super.initState();
    widget.updates?.addListener(_maybeShow);
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeShow());
  }

  @override
  void dispose() {
    widget.updates?.removeListener(_maybeShow);
    super.dispose();
  }

  void _maybeShow() {
    final u = widget.updates;
    if (u == null || u.whatsNew.isEmpty || !mounted) return;
    final notes = u.whatsNew;
    u.clearWhatsNew();
    showWhatsNew(context, notes);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

Future<void> showWhatsNew(BuildContext context, List<ReleaseNotes> releases) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) {
      final theme = Theme.of(context);
      return DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        maxChildSize: 0.9,
        builder: (context, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          children: [
            Text("What's new", style: theme.textTheme.titleLarge),
            if (releases.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 16),
                child: Text('No release notes in this build.'),
              ),
            for (final r in releases) ...[
              Padding(
                padding: const EdgeInsets.only(top: 20, bottom: 4),
                child: Text(
                  r.date.isEmpty ? '${r.version}' : '${r.version} · ${r.date}',
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: theme.colorScheme.primary,
                  ),
                ),
              ),
              for (final n in r.notes)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Text('• $n'),
                ),
            ],
            const SizedBox(height: 16),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Got it'),
              ),
            ),
          ],
        ),
      );
    },
  );
}
